// Analista nocturno — el "Resumen de la mañana".
//
// Diseño (a propósito):
//  1. Los NÚMEROS se calculan aquí con SQL — la IA nunca hace la matemática.
//  2. Las ALERTAS (flags) son deterministas: mismas reglas, mismo resultado.
//  3. La IA (si está configurada) solo REDACTA un resumen ejecutivo a partir de
//     los números y las alertas ya calculadas. Si no hay IA, un texto plantilla
//     igual de útil se arma con las mismas alertas.
//  4. Solo agregados y etiquetas (producto/sede/color/vendedor) llegan al modelo;
//     nunca nombres/teléfonos de clientes.
//
// Cada consulta va envuelta en safeQuery: una tabla o columna faltante degrada
// esa métrica a null en vez de tumbar todo el resumen (corre desatendido).
const { pool } = require('../db');
const { REPORTING_TIMEZONE } = require('./reporting');
const { aiChatCompletion, isAiConfigured, getActiveAiProviderInfo } = require('./aiProvider');
const { parseVariantSku } = require('./kanban');

const PAID_STATUSES = ['Pagado', 'Embalado', 'Enviado'];
const COLOR_TRACKED_BASES = ['T6195', 'T9495'];
const STALE_QUOTE_DAYS = 3; // una cotización sin avanzar tras 3 días necesita seguimiento
const SEDES = [
  { key: 'cochabamba', label: 'Cochabamba', stock: 'stock_cochabamba', min: 'min_stock_cochabamba' },
  { key: 'santacruz', label: 'Santa Cruz', stock: 'stock_santacruz', min: 'min_stock_santacruz' },
  { key: 'lima', label: 'Lima', stock: 'stock_lima', min: 'min_stock_lima' }
];

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;

// Fecha "de negocio" en hora Bolivia; day=0 hoy, 1 ayer, 7 hace una semana.
const boliviaDateExpr = (offsetDays = 0) =>
  `((NOW() AT TIME ZONE '${REPORTING_TIMEZONE}')::date - ${Number.parseInt(offsetDays, 10) || 0})`;
const createdAtBoliviaDate = (alias = 'q') =>
  `((${alias}.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${REPORTING_TIMEZONE}')::date`;

const safeQuery = async (text, params = []) => {
  try {
    const res = await pool.query(text, params);
    return res.rows || [];
  } catch (err) {
    // Esquema opcional (tabla/columna/función ausente) → degradar, no romper.
    if (['42P01', '42703', '42883'].includes(String(err?.code || ''))) return null;
    console.error('daily-brief query failed:', err.message);
    return null;
  }
};

// ─── Recolección de métricas ─────────────────────────────────────────────────
const collectDailyMetrics = async () => {
  const metrics = {};

  // 1. Ventas de ayer vs. mismo día de la semana previa + promedio 7 días.
  const salesRows = await safeQuery(`
    SELECT
      COUNT(*) FILTER (WHERE ${createdAtBoliviaDate()} = ${boliviaDateExpr(1)})::int AS yday_count,
      COALESCE(SUM(q.total) FILTER (WHERE ${createdAtBoliviaDate()} = ${boliviaDateExpr(1)}), 0) AS yday_total,
      COUNT(*) FILTER (WHERE ${createdAtBoliviaDate()} = ${boliviaDateExpr(8)})::int AS prev_count,
      COALESCE(SUM(q.total) FILTER (WHERE ${createdAtBoliviaDate()} = ${boliviaDateExpr(8)}), 0) AS prev_total,
      COALESCE(SUM(q.total) FILTER (WHERE ${createdAtBoliviaDate()} BETWEEN ${boliviaDateExpr(7)} AND ${boliviaDateExpr(1)}), 0) AS week_total,
      COUNT(*) FILTER (WHERE ${createdAtBoliviaDate()} BETWEEN ${boliviaDateExpr(7)} AND ${boliviaDateExpr(1)})::int AS week_count
    FROM quotes q
    WHERE q.status = ANY($1)
  `, [PAID_STATUSES]);
  if (salesRows && salesRows[0]) {
    const r = salesRows[0];
    metrics.sales = {
      yesterday_count: Number(r.yday_count || 0),
      yesterday_total: Number(r.yday_total || 0),
      prev_week_count: Number(r.prev_count || 0),
      prev_week_total: Number(r.prev_total || 0),
      avg_daily_total_7d: Number(r.week_total || 0) / 7,
      week_count: Number(r.week_count || 0)
    };
  }

  // 2. Pedidos pagados esperando preparación (status = Pagado, aún no embalado).
  const prepRows = await safeQuery(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total FROM quotes WHERE status = 'Pagado'`
  );
  if (prepRows && prepRows[0]) {
    metrics.awaiting_prep = { count: Number(prepRows[0].n || 0), total: Number(prepRows[0].total || 0) };
  }

  // 3. Cotizaciones estancadas: en 'Cotizado' hace más de N días, sin avanzar.
  const staleRows = await safeQuery(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS total
    FROM quotes
    WHERE status = 'Cotizado'
      AND ${createdAtBoliviaDate('quotes')} <= ${boliviaDateExpr(STALE_QUOTE_DAYS)}
  `);
  if (staleRows && staleRows[0]) {
    metrics.stale_quotes = { count: Number(staleRows[0].n || 0), total: Number(staleRows[0].total || 0), days: STALE_QUOTE_DAYS };
  }

  // 4. Stock bajo mínimo por sede (una fila por producto/sede en falta).
  const lowStockClauses = SEDES
    .map((s) => `SELECT sku, name, '${s.label}' AS sede, ${s.stock} AS stock, ${s.min} AS min_stock
                 FROM products WHERE ${s.min} IS NOT NULL AND ${s.min} > 0 AND ${s.stock} < ${s.min}`)
    .join('\n      UNION ALL\n      ');
  const lowStockRows = await safeQuery(`
    SELECT * FROM (
      ${lowStockClauses}
    ) low ORDER BY (min_stock - stock) DESC LIMIT 12
  `);
  if (lowStockRows) {
    metrics.low_stock = {
      count: lowStockRows.length,
      items: lowStockRows.map((row) => ({
        sku: row.sku,
        name: row.name,
        sede: row.sede,
        stock: Number(row.stock || 0),
        min: Number(row.min_stock || 0),
        deficit: Number(row.min_stock || 0) - Number(row.stock || 0)
      }))
    };
  }

  // 5. Colores más vendidos ayer para T6195 / T9495 (mismo criterio que Estadísticas).
  const colorRows = await safeQuery(`
    SELECT UPPER(TRIM(li->>'sku')) AS sku, SUM(CAST(li->>'qty' AS INTEGER)) AS qty
    FROM quotes q, LATERAL jsonb_array_elements(q.line_items) li
    WHERE q.status = ANY($1) AND ${createdAtBoliviaDate()} = ${boliviaDateExpr(1)}
    GROUP BY UPPER(TRIM(li->>'sku'))
  `, [PAID_STATUSES]);
  if (colorRows) {
    const byBase = new Map(COLOR_TRACKED_BASES.map((b) => [b, { base: b, total: 0, top: null, colors: {} }]));
    for (const row of colorRows) {
      const v = parseVariantSku(row.sku);
      if (!v) continue;
      const bucket = byBase.get(v.base);
      if (!bucket) continue;
      const qty = Number(row.qty || 0);
      bucket.total += qty;
      bucket.colors[v.colorLabel] = (bucket.colors[v.colorLabel] || 0) + qty;
    }
    metrics.colors = COLOR_TRACKED_BASES.map((base) => {
      const b = byBase.get(base);
      const top = Object.entries(b.colors).sort((a, c) => c[1] - a[1])[0] || null;
      return { base, total: b.total, top_color: top ? top[0] : null, top_qty: top ? top[1] : 0 };
    }).filter((c) => c.total > 0);
  }

  // 6. Promos: herramientas activas + códigos emitidos ayer.
  const promoActiveRows = await safeQuery(`
    SELECT tool, name FROM promo_tools
    WHERE active = TRUE
      AND (starts_on IS NULL OR starts_on <= ${boliviaDateExpr(0)})
      AND (ends_on IS NULL OR ends_on >= ${boliviaDateExpr(0)})
  `);
  const promoCodeRows = await safeQuery(`
    SELECT pt.tool, COUNT(*)::int AS n
    FROM promo_codes pc JOIN promo_tools pt ON pt.id = pc.tool_id
    WHERE ${createdAtBoliviaDate('pc')} = ${boliviaDateExpr(1)}
    GROUP BY pt.tool
  `);
  if (promoActiveRows) {
    const issued = {};
    for (const row of (promoCodeRows || [])) issued[row.tool] = Number(row.n || 0);
    metrics.promos = {
      active: promoActiveRows.map((r) => ({ tool: r.tool, name: r.name })),
      issued_yesterday: issued
    };
  }

  // 7. Seguimientos de clientes vencidos (solo el conteo — sin datos personales).
  const crmRows = await safeQuery(`
    SELECT COUNT(*)::int AS n FROM customers
    WHERE follow_up_at IS NOT NULL
      AND ((follow_up_at AT TIME ZONE 'UTC') AT TIME ZONE '${REPORTING_TIMEZONE}')::date <= ${boliviaDateExpr(0)}
  `);
  if (crmRows && crmRows[0]) {
    metrics.crm_due = { count: Number(crmRows[0].n || 0) };
  }

  return metrics;
};

// ─── Alertas deterministas (con severidad) ───────────────────────────────────
const computeFlags = (metrics) => {
  const flags = [];
  const push = (severity, text) => flags.push({ severity, text });

  const s = metrics.sales;
  if (s) {
    const base = s.avg_daily_total_7d > 0 ? s.avg_daily_total_7d : s.prev_week_total;
    if (base > 0) {
      const deltaPct = ((s.yesterday_total - base) / base) * 100;
      if (deltaPct <= -30) {
        push('alta', `Ventas de ayer ${money(s.yesterday_total)}: ${Math.abs(deltaPct).toFixed(0)}% por debajo del ritmo de la semana.`);
      } else if (deltaPct >= 30) {
        push('buena', `Ventas de ayer ${money(s.yesterday_total)}: ${deltaPct.toFixed(0)}% por encima del ritmo de la semana.`);
      }
    } else if (s.yesterday_total === 0) {
      push('media', 'No hubo ventas cobradas ayer.');
    }
  }

  if (metrics.awaiting_prep && metrics.awaiting_prep.count > 0) {
    const sev = metrics.awaiting_prep.count >= 5 ? 'alta' : 'media';
    push(sev, `${metrics.awaiting_prep.count} pedido(s) pagado(s) esperando preparación (${money(metrics.awaiting_prep.total)}).`);
  }

  if (metrics.stale_quotes && metrics.stale_quotes.count > 0) {
    const sev = metrics.stale_quotes.count >= 5 ? 'alta' : 'media';
    push(sev, `${metrics.stale_quotes.count} cotización(es) estancada(s) +${metrics.stale_quotes.days} días sin avanzar (${money(metrics.stale_quotes.total)} en juego).`);
  }

  if (metrics.low_stock && metrics.low_stock.count > 0) {
    const worst = metrics.low_stock.items.slice(0, 3)
      .map((i) => `${i.name || i.sku} en ${i.sede} (${i.stock}/${i.min})`).join('; ');
    push('alta', `${metrics.low_stock.count} producto(s) bajo el mínimo. Los más críticos: ${worst}.`);
  }

  if (metrics.crm_due && metrics.crm_due.count > 0) {
    push('media', `${metrics.crm_due.count} seguimiento(s) de cliente vencido(s) hoy o antes.`);
  }

  if (Array.isArray(metrics.colors) && metrics.colors.length > 0) {
    const parts = metrics.colors
      .filter((c) => c.top_color)
      .map((c) => `${c.base}: ${c.top_color} (${c.top_qty})`);
    if (parts.length > 0) push('info', `Colores más vendidos ayer — ${parts.join(' · ')}.`);
  }

  const issued = metrics.promos?.issued_yesterday || {};
  const totalIssued = Object.values(issued).reduce((a, b) => a + b, 0);
  if ((metrics.promos?.active?.length || 0) > 0 && totalIssued > 0) {
    const bits = [];
    if (issued.sorteo) bits.push(`${issued.sorteo} código(s) de sorteo`);
    if (issued.cupon) bits.push(`${issued.cupon} cupón(es)`);
    if (bits.length > 0) push('info', `Promos activas generaron ayer: ${bits.join(', ')}.`);
  }

  return flags;
};

const SEVERITY_ORDER = { alta: 0, media: 1, buena: 2, info: 3 };
const SEVERITY_ICON = { alta: '🔴', media: '🟡', buena: '🟢', info: '🔵' };

const sortFlags = (flags) =>
  [...flags].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

// ─── Resumen plantilla (fallback y siempre la fuente de los datos) ───────────
const renderTemplateBrief = (metrics, flags) => {
  const sorted = sortFlags(flags);
  const urgent = sorted.filter((f) => f.severity === 'alta').length;
  const headline = urgent > 0
    ? `${urgent} punto(s) que necesitan tu atención hoy`
    : (sorted.length > 0 ? 'Todo en orden — algunos apuntes del día' : 'Día tranquilo, sin alertas');

  // El cuerpo NO repite las alertas (la tarjeta ya las lista como chips): solo
  // el cierre de contexto de ventas, o una nota cuando no hay nada que reportar.
  const lines = [];
  if (sorted.length === 0) {
    lines.push('No hay alertas para hoy. El negocio marcha dentro de lo normal.');
  }
  const s = metrics.sales;
  if (s) {
    lines.push(`Ventas de ayer: ${money(s.yesterday_total)} en ${s.yesterday_count} pedido(s). Promedio diario de la semana: ${money(s.avg_daily_total_7d)}.`);
  }
  return { headline, body_md: lines.join('\n') };
};

// ─── Redacción con IA (opcional): solo agrega prosa sobre los mismos datos ────
const generateAiNarrative = async (metrics, flags) => {
  const sorted = sortFlags(flags);
  const system = [
    'Eres el analista de PCX, una fábrica boliviana de tableros y accesorios.',
    'Escribes en español un resumen ejecutivo BREVE para el dueño cada mañana.',
    'Reglas: usa SOLO los datos que te doy (no inventes cifras), prioriza lo urgente,',
    'sé directo y accionable, máximo ~6 líneas. No repitas todas las cifras: destaca',
    'lo que importa y qué hacer al respecto.'
  ].join(' ');
  const payload = {
    alertas: sorted.map((f) => ({ severidad: f.severity, texto: f.text })),
    ventas: metrics.sales || null,
    pedidos_por_preparar: metrics.awaiting_prep || null,
    cotizaciones_estancadas: metrics.stale_quotes || null,
    stock_bajo_minimo: metrics.low_stock || null,
    colores: metrics.colors || null,
    promos: metrics.promos || null,
    seguimientos_vencidos: metrics.crm_due || null
  };
  const user = [
    'Datos del negocio (cifras ya calculadas; no las recalcules):',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    'Devuelve un objeto JSON con: "headline" (una frase corta) y "body_md"',
    '(el resumen en texto, con saltos de línea, priorizando lo urgente primero).'
  ].join('\n');

  const { content, provider, model } = await aiChatCompletion({ system, user, maxTokens: 700, json: true });
  const parsed = JSON.parse(content);
  const headline = String(parsed.headline || '').trim();
  const body = String(parsed.body_md || parsed.body || '').trim();
  if (!headline && !body) throw new Error('IA devolvió un resumen vacío');
  return { headline: headline || 'Resumen del día', body_md: body, provider, model };
};

// ─── Generación + persistencia (idempotente por fecha) ───────────────────────
const generateDailyBrief = async () => {
  const metrics = await collectDailyMetrics();
  const flags = computeFlags(metrics);

  const template = renderTemplateBrief(metrics, flags);
  let brief = { ...template, provider: 'template', model: null };

  if (isAiConfigured()) {
    try {
      const ai = await generateAiNarrative(metrics, flags);
      brief = { headline: ai.headline, body_md: ai.body_md, provider: ai.provider, model: ai.model };
    } catch (err) {
      // La IA falló → seguimos con la plantilla (el valor está en las alertas).
      console.error('daily-brief AI narrative failed, using template:', err.message);
    }
  }

  const stored = await pool.query(`
    INSERT INTO daily_briefs (brief_date, generated_at, headline, body_md, flags, metrics, provider, model)
    VALUES (${boliviaDateExpr(0)}, NOW(), $1, $2, $3, $4, $5, $6)
    ON CONFLICT (brief_date) DO UPDATE SET
      generated_at = NOW(), headline = EXCLUDED.headline, body_md = EXCLUDED.body_md,
      flags = EXCLUDED.flags, metrics = EXCLUDED.metrics, provider = EXCLUDED.provider, model = EXCLUDED.model
    RETURNING id, brief_date::text AS brief_date, generated_at, headline, body_md, flags, provider, model
  `, [brief.headline, brief.body_md, JSON.stringify(sortFlags(flags)), JSON.stringify(metrics), brief.provider, brief.model]);

  return stored.rows[0];
};

const getLatestBrief = async () => {
  const res = await pool.query(`
    SELECT id, brief_date::text AS brief_date, generated_at, headline, body_md, flags, provider, model
    FROM daily_briefs ORDER BY brief_date DESC LIMIT 1
  `);
  return res.rows[0] || null;
};

module.exports = {
  collectDailyMetrics,
  computeFlags,
  generateDailyBrief,
  getLatestBrief,
  getAiStatus: getActiveAiProviderInfo
};
