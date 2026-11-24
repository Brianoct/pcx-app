// Incentivos de ventas por esfuerzo — SIMULACIÓN (ver migración
// 20261125_sales_incentives.sql).
//
// Cada regla mide algo que la app registra sola y, si la persona pasa el
// umbral, sumaría unos puntos a su comisión del mes. Aquí solo se calcula
// "cuánto habría ganado": nada de esto entra a Comisiones ni a Pagos.
const { pool } = require('../db');
const { areaForRole } = require('./areas');
const { buildDateFilter, REPORTING_TIMEZONE } = require('./reporting');
const { computeTeamCommissions } = require('./commissionTeam');
const { KIND_SALE, PAID_STATUSES } = require('./commissionLedger');
const { createHttpError } = require('./util');

const NOW_UTC = "(NOW() AT TIME ZONE 'UTC')";
const digits8 = (expr) => `RIGHT(regexp_replace(COALESCE(${expr}, ''), '\\D', '', 'g'), 8)`;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const loadRules = async () => {
  const res = await pool.query('SELECT * FROM sales_incentive_rules ORDER BY position, key');
  return res.rows.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description || '',
    threshold: Number(row.threshold),
    param: row.param === null ? null : Number(row.param),
    param_unit: row.param_unit || '',
    bump_pct: Number(row.bump_pct),
    enabled: Boolean(row.enabled)
  }));
};

const loadSettings = async () => {
  const res = await pool.query('SELECT cap_pct, min_cases FROM sales_incentive_settings WHERE id = 1');
  return { cap_pct: Number(res.rows[0]?.cap_pct ?? 1.5), min_cases: Number(res.rows[0]?.min_cases ?? 3) };
};

// Solo Admin. Cambia umbral, plazo, puntos y activación de cada regla, y el tope.
const saveConfig = async ({ rules = [], cap_pct, min_cases }, userId) => {
  const current = new Map((await loadRules()).map((r) => [r.key, r]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of Array.isArray(rules) ? rules : []) {
      const rule = current.get(String(item?.key || ''));
      if (!rule) throw createHttpError(400, `Regla desconocida: ${item?.key}`);
      const threshold = item.threshold === undefined ? rule.threshold : Number(item.threshold);
      const bump = item.bump_pct === undefined ? rule.bump_pct : Number(item.bump_pct);
      const param = rule.param === null || item.param === undefined ? rule.param : Number(item.param);
      const enabled = item.enabled === undefined ? rule.enabled : Boolean(item.enabled);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw createHttpError(400, `${rule.label}: el umbral debe estar entre 0 y 100`);
      if (!Number.isFinite(bump) || bump < 0 || bump > 20) throw createHttpError(400, `${rule.label}: los puntos deben estar entre 0 y 20`);
      if (param !== null && (!Number.isFinite(param) || param <= 0 || param > 10000)) throw createHttpError(400, `${rule.label}: plazo inválido`);
      await client.query(
        `UPDATE sales_incentive_rules
         SET threshold = $2, bump_pct = $3, param = $4, enabled = $5, updated_by = $6, updated_at = NOW()
         WHERE key = $1`,
        [rule.key, threshold, bump, param, enabled, userId || null]
      );
    }
    if (cap_pct !== undefined || min_cases !== undefined) {
      const prev = await loadSettings();
      const cap = cap_pct === undefined ? prev.cap_pct : Number(cap_pct);
      const min = min_cases === undefined ? prev.min_cases : Number.parseInt(min_cases, 10);
      if (!Number.isFinite(cap) || cap < 0 || cap > 50) throw createHttpError(400, 'El tope debe estar entre 0 y 50');
      if (!Number.isInteger(min) || min < 1 || min > 100) throw createHttpError(400, 'El mínimo de casos debe estar entre 1 y 100');
      await client.query(
        `INSERT INTO sales_incentive_settings (id, cap_pct, min_cases, updated_by, updated_at) VALUES (1, $1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET cap_pct = EXCLUDED.cap_pct, min_cases = EXCLUDED.min_cases,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [cap, min, userId || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Mes de Bolivia expresado en UTC, que es como se guardan las fechas.
const monthBoundsUtc = async (month, year) => {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const res = await pool.query(
    `SELECT (make_timestamp($1, $2, 1, 0, 0, 0) AT TIME ZONE '${REPORTING_TIMEZONE}' AT TIME ZONE 'UTC')::text AS start,
            (make_timestamp($3, $4, 1, 0, 0, 0) AT TIME ZONE '${REPORTING_TIMEZONE}' AT TIME ZONE 'UTC')::text AS next`,
    [year, month, nextYear, nextMonth]
  );
  return res.rows[0];
};

const byUser = (rows, shape) => new Map(rows.map((row) => [Number(row.user_id), shape(row)]));

// ── Métricas: cada una devuelve Map(user_id → { done, total, detail }) ──────

// Cotizaciones que no se cobraron enseguida: ¿se les volvió a escribir (o se
// cobraron) dentro del plazo? El primer tramo no cuenta como seguimiento: es
// la misma conversación en la que se envió la cotización.
const metricSeguimiento = async ({ start, next }, rule) => {
  const windowHours = rule.param || 72;
  const gapHours = Math.min(12, windowHours / 4);
  const res = await pool.query(
    `SELECT q.user_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE fu.ok IS TRUE OR (q.paid_at IS NOT NULL AND q.paid_at <= q.created_at + $3::interval))::int AS done,
            COUNT(*) FILTER (WHERE fu.ok IS TRUE)::int AS messaged
     FROM quotes q
     LEFT JOIN LATERAL (
       SELECT TRUE AS ok
       FROM whatsapp_messages m
       JOIN whatsapp_conversations c ON c.id = m.conversation_id
       JOIN whatsapp_contacts ct ON ct.id = c.contact_id
       WHERE m.direction = 'outbound'
         AND ${digits8('ct.wa_phone')} = ${digits8('q.customer_phone')}
         AND m.created_at > q.created_at + $4::interval
         AND m.created_at <= q.created_at + $3::interval
       LIMIT 1
     ) fu ON TRUE
     WHERE q.created_at >= $1::timestamp AND q.created_at < $2::timestamp
       AND q.created_at + $3::interval <= ${NOW_UTC}
       AND q.user_id IS NOT NULL
       AND LENGTH(${digits8('q.customer_phone')}) >= 7
       AND NOT (q.paid_at IS NOT NULL AND q.paid_at <= q.created_at + $4::interval)
     GROUP BY q.user_id`,
    [start, next, `${windowHours} hours`, `${gapHours} hours`]
  );
  return byUser(res.rows, (r) => ({
    done: r.done, total: r.total,
    detail: `${r.done} de ${r.total} cotizaciones abiertas (${r.messaged} con mensaje de seguimiento)`
  }));
};

// Cada vez que el cliente queda esperando (escribe después de un mensaje
// nuestro, o por primera vez) en horario de atención.
const metricRespuesta = async ({ start, next }, rule) => {
  const minutes = rule.param || 15;
  const res = await pool.query(
    `WITH msgs AS (
       SELECT m.conversation_id, m.direction, m.created_at,
              LAG(m.direction) OVER w AS prev_dir,
              MIN(m.created_at) FILTER (WHERE m.direction = 'outbound')
                OVER (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id
                      ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS next_out
       FROM whatsapp_messages m
       WHERE m.created_at >= $1::timestamp - INTERVAL '1 day' AND m.created_at < $2::timestamp + INTERVAL '2 days'
       WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id)
     ),
     waits AS (
       SELECT c.assigned_user_id AS user_id, x.created_at, x.next_out,
              timezone('${REPORTING_TIMEZONE}', x.created_at AT TIME ZONE 'UTC') AS local_at
       FROM msgs x JOIN whatsapp_conversations c ON c.id = x.conversation_id
       WHERE x.direction = 'inbound' AND (x.prev_dir IS NULL OR x.prev_dir = 'outbound')
         AND x.created_at >= $1::timestamp AND x.created_at < $2::timestamp
         AND x.created_at + $3::interval <= ${NOW_UTC}
         AND c.assigned_user_id IS NOT NULL
     )
     SELECT user_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE next_out IS NOT NULL AND next_out <= created_at + $3::interval)::int AS done,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (next_out - created_at)) / 60.0)
                   FILTER (WHERE next_out IS NOT NULL))::numeric, 0) AS median_min
     FROM waits
     WHERE EXTRACT(ISODOW FROM local_at) BETWEEN 1 AND 6
       AND EXTRACT(HOUR FROM local_at) >= 9 AND EXTRACT(HOUR FROM local_at) < 18
     GROUP BY user_id`,
    [start, next, `${minutes} minutes`]
  );
  return byUser(res.rows, (r) => ({
    done: r.done, total: r.total,
    detail: `${r.done} de ${r.total} respuestas dentro de ${minutes} min${r.median_min !== null ? ` · mediana ${Number(r.median_min)} min` : ''}`
  }));
};

const metricTareas = async ({ start, next }, rule) => {
  const tolerance = rule.param || 24;
  const res = await pool.query(
    `SELECT assigned_user_id AS user_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'done' AND completed_at <= due_at + $3::interval)::int AS done
     FROM whatsapp_followup_tasks
     WHERE due_at >= $1::timestamp AND due_at < $2::timestamp
       AND due_at + $3::interval <= ${NOW_UTC}
       AND status <> 'cancelled' AND assigned_user_id IS NOT NULL
     GROUP BY assigned_user_id`,
    [start, next, `${tolerance} hours`]
  );
  return byUser(res.rows, (r) => ({ done: r.done, total: r.total, detail: `${r.done} de ${r.total} tareas hechas a tiempo` }));
};

// Ventas cobradas en el mes. Se excluye lo anterior al libro de comisiones:
// de esas ventas no se conoce la fecha real de cobro.
const metricCobro = async ({ start, next }, rule) => {
  const days = rule.param || 7;
  const res = await pool.query(
    `SELECT q.user_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE q.paid_at <= q.created_at + $3::interval)::int AS done
     FROM quotes q
     WHERE q.paid_at >= $1::timestamp AND q.paid_at < $2::timestamp
       AND q.status = ANY($4::text[]) AND q.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM commission_entries e WHERE e.quote_id = q.id AND e.reason = 'historico')
     GROUP BY q.user_id`,
    [start, next, `${days} days`, PAID_STATUSES]
  );
  return byUser(res.rows, (r) => ({ done: r.done, total: r.total, detail: `${r.done} de ${r.total} ventas cobradas en ${days} días o menos` }));
};

// El origen se pregunta una vez por cliente: vale el de la cotización o el
// que ya tiene la ficha del cliente.
const metricDatos = async ({ start, next }) => {
  const res = await pool.query(
    `SELECT q.user_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE NULLIF(TRIM(q.uso), '') IS NOT NULL
                AND (NULLIF(TRIM(q.origen), '') IS NOT NULL OR EXISTS (
                  SELECT 1 FROM customers cu
                  WHERE NULLIF(TRIM(cu.origen), '') IS NOT NULL
                    AND ${digits8('cu.phone_normalized')} = ${digits8('q.customer_phone')}
                    AND LENGTH(${digits8('q.customer_phone')}) >= 7
                ))
            )::int AS done
     FROM quotes q
     WHERE q.created_at >= $1::timestamp AND q.created_at < $2::timestamp AND q.user_id IS NOT NULL
     GROUP BY q.user_id`,
    [start, next]
  );
  return byUser(res.rows, (r) => ({ done: r.done, total: r.total, detail: `${r.done} de ${r.total} cotizaciones con uso y origen` }));
};

const METRICS = {
  seguimiento: metricSeguimiento,
  respuesta: metricRespuesta,
  tareas: metricTareas,
  cobro: metricCobro,
  datos: metricDatos
};

// ── Simulación del mes ──────────────────────────────────────────────────────
const buildSimulation = async ({ month, year }) => {
  const bounds = await monthBoundsUtc(month, year);
  const [rules, settings, usersRes, team] = await Promise.all([
    loadRules(),
    loadSettings(),
    pool.query(
      `SELECT id, email, display_name, role FROM users WHERE is_active = TRUE
       ORDER BY LOWER(COALESCE(NULLIF(TRIM(display_name), ''), email))`
    ),
    computeTeamCommissions(month, year, { live: true })
  ]);
  if (team.error) throw createHttpError(400, team.error);

  const dateFilter = buildDateFilter(month, year, 'q', 2);
  const salesRes = await pool.query(
    `SELECT q.user_id, COALESCE(SUM(q.total), 0) AS sales
     FROM commission_entries q WHERE q.kind = $1${dateFilter.sql} GROUP BY q.user_id`,
    [KIND_SALE, ...dateFilter.params]
  );
  const salesByUser = new Map(salesRes.rows.map((r) => [Number(r.user_id), Number(r.sales || 0)]));
  const commissionByUser = new Map((team.users || []).map((u) => [Number(u.user_id), u]));

  const active = rules.filter((r) => r.enabled && METRICS[r.key]);
  const metricMaps = new Map(await Promise.all(
    active.map(async (rule) => [rule.key, await METRICS[rule.key](bounds, rule)])
  ));

  const people = usersRes.rows
    .filter((row) => areaForRole(row.role) === 'ventas')
    .map((row) => {
      const userId = Number(row.id);
      const sales = round2(salesByUser.get(userId) || 0);
      const base = commissionByUser.get(userId);
      const baseCommission = round2(base?.commission || 0);
      const items = active.map((rule) => {
        const m = metricMaps.get(rule.key).get(userId) || { done: 0, total: 0, detail: 'Sin casos este mes' };
        const enough = m.total >= settings.min_cases;
        const value = m.total > 0 ? Math.round((m.done / m.total) * 100) : null;
        const status = !enough ? 'nodata' : value >= rule.threshold ? 'green' : 'red';
        return {
          key: rule.key, label: rule.label, threshold: rule.threshold, value,
          done: m.done, total: m.total,
          detail: enough || m.total === 0 ? m.detail : `${m.detail} · pocos casos para juzgar`,
          status, bump_pct: status === 'green' ? rule.bump_pct : 0
        };
      });
      const earned = round2(items.reduce((sum, i) => sum + i.bump_pct, 0));
      const bump = Math.min(earned, settings.cap_pct);
      // Los puntos extra se aplican sobre las ventas propias cobradas del mes.
      const extra = round2(sales * (bump / 100));
      return {
        user_id: userId,
        name: String(row.display_name || '').trim() || String(row.email || '').split('@')[0],
        role: row.role || '',
        sales,
        base_commission: baseCommission,
        base_source: base?.source || '',
        items,
        earned_pct: earned,
        bump_pct: round2(bump),
        capped: earned > settings.cap_pct,
        extra,
        simulated_commission: round2(baseCommission + extra)
      };
    });

  const sum = (key) => round2(people.reduce((acc, p) => acc + p[key], 0));
  const totals = { sales: sum('sales'), base_commission: sum('base_commission'), extra: sum('extra') };
  totals.extra_pct_of_sales = totals.sales > 0 ? round2((totals.extra / totals.sales) * 100) : 0;

  return { month, year, shadow: true, settings, rules, people, totals };
};

module.exports = { buildSimulation, loadRules, loadSettings, saveConfig };
