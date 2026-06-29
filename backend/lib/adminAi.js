const { pool } = require('../db');
const { loadCommissionSettings } = require('./commission');
const { normalizeText } = require('./rbac');
const { COMPLETED_STATUSES, buildDateFilter } = require('./reporting');
const { createHttpError } = require('./util');
const { aiChatCompletion, isAiConfigured } = require('./aiProvider');

const GROK_API_URL = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';

const GROK_MODEL = process.env.GROK_MODEL || 'grok-2-latest';

const ADMIN_AI_SENSITIVE_FIELDS = [
  'customer_name',
  'customer_phone',
  'alternative_name',
  'alternative_phone',
  'shipping_notes'
];

const formatAnalyticsRowsMarkdown = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return '_Sin resultados_';
  const columns = Object.keys(rows[0] || {});
  if (columns.length === 0) return '_Sin resultados_';
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .slice(0, 30)
    .map((row) => `| ${columns.map((col) => String(row?.[col] ?? '')).join(' | ')} |`)
    .join('\n');
  return `${header}\n${divider}\n${body}`;
};

const isAdminAiSchemaOptionalError = (err) => ['42P01', '42703', '42883'].includes(String(err?.code || '').trim());

const runAdminAiSafeQuery = async (queryText, params = []) => {
  try {
    const result = await pool.query(queryText, params);
    return result.rows || [];
  } catch (err) {
    if (isAdminAiSchemaOptionalError(err)) {
      console.warn('Admin AI dataset skipped:', err.message || err);
      return [];
    }
    throw err;
  }
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildAdminAiExpandedDataset = async ({ month, year }) => {
  const dateFilter = buildDateFilter(month, year, 'q', 1);
  if (dateFilter.error) throw createHttpError(400, dateFilter.error);
  const dateFilterWithStatus = buildDateFilter(month, year, 'q', 2);
  if (dateFilterWithStatus.error) throw createHttpError(400, dateFilterWithStatus.error);
  const taskDateFilter = buildDateFilter(month, year, 't', 1);
  if (taskDateFilter.error) throw createHttpError(400, taskDateFilter.error);
  const qcDateFilter = buildDateFilter(month, year, 'r', 1);
  if (qcDateFilter.error) throw createHttpError(400, qcDateFilter.error);
  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;
  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    throw createHttpError(400, 'Mes inválido. Debe estar entre 1 y 12');
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    throw createHttpError(400, 'Año inválido');
  }

  const expenseParams = [];
  const expenseWhereParts = [];
  if (Number.isInteger(monthNum)) {
    expenseParams.push(monthNum);
    expenseWhereParts.push(`EXTRACT(MONTH FROM e.expense_date) = $${expenseParams.length}`);
  }
  if (Number.isInteger(yearNum)) {
    expenseParams.push(yearNum);
    expenseWhereParts.push(`EXTRACT(YEAR FROM e.expense_date) = $${expenseParams.length}`);
  }
  const expenseWhere = expenseWhereParts.length > 0 ? `WHERE ${expenseWhereParts.join(' AND ')}` : '';
  const recurringWhere = expenseWhereParts.length > 0
    ? `WHERE e.is_recurring = TRUE AND ${expenseWhereParts.join(' AND ')}`
    : 'WHERE e.is_recurring = TRUE';

  const [
    salesByStatusRows,
    salesByDayRows,
    topProductsRows,
    topSellersRows,
    topLocationsRows,
    warehouseRows,
    discountUsageRows,
    userByRoleRows,
    userByCityRows,
    inventorySummaryRows,
    lowStockRows,
    priceSummaryRows,
    expensesByDepartmentRows,
    expensesByCategoryRows,
    recurringExpenseRows,
    projectsByAreaRows,
    tasksByStatusRows,
    qcByResultRows,
    qcBySkuRows,
    combosSummaryRows,
    comboItemsRows,
    couponsSummaryRows,
    shippedSalesByRoleRows
  ] = await Promise.all([
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(q.status), ''), 'Sin estado') AS status,
         COUNT(*) AS order_count,
         COALESCE(SUM(q.total), 0) AS total_sales_bs
       FROM quotes q
       WHERE 1 = 1${dateFilter.sql}
       GROUP BY status
       ORDER BY total_sales_bs DESC, order_count DESC`,
      dateFilter.params
    ),
    runAdminAiSafeQuery(
      `SELECT
         TO_CHAR(DATE_TRUNC('day', q.created_at), 'YYYY-MM-DD') AS period_day,
         COUNT(*) AS order_count,
         COALESCE(SUM(q.total), 0) AS total_sales_bs
       FROM quotes q
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}
       GROUP BY period_day
       ORDER BY period_day ASC
       LIMIT 31`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(li->>'sku'), ''), 'Sin SKU') AS sku,
         COALESCE(NULLIF(TRIM(li->>'displayName'), ''), COALESCE(NULLIF(TRIM(li->>'sku'), ''), 'Producto')) AS product_name,
         COALESCE(SUM(CASE
           WHEN (li->>'qty') ~ '^-?[0-9]+$' THEN (li->>'qty')::INTEGER
           ELSE 0
         END), 0) AS total_qty
       FROM quotes q,
       LATERAL jsonb_array_elements(q.line_items) li
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}
       GROUP BY sku, product_name
       ORDER BY total_qty DESC
       LIMIT 20`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(COALESCE(q.vendor, u.display_name, u.email)), ''), 'Sin vendedor') AS seller,
         COUNT(*) AS order_count,
         COALESCE(SUM(q.total), 0) AS total_sales_bs
       FROM quotes q
       LEFT JOIN users u ON u.id = q.user_id
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}
       GROUP BY seller
       ORDER BY total_sales_bs DESC
       LIMIT 20`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(COALESCE(q.provincia, q.department)), ''), 'Sin ubicación') AS location,
         COUNT(*) AS order_count,
         COALESCE(SUM(q.total), 0) AS total_sales_bs
       FROM quotes q
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}
       GROUP BY location
       ORDER BY total_sales_bs DESC
       LIMIT 20`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(q.store_location), ''), 'Sin almacén') AS warehouse,
         COUNT(*) AS order_count,
         COALESCE(SUM(q.total), 0) AS total_sales_bs
       FROM quotes q
       WHERE q.status = 'Enviado'${dateFilter.sql}
       GROUP BY warehouse
       ORDER BY order_count DESC`,
      dateFilter.params
    ),
    runAdminAiSafeQuery(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(q.discount_percent, 0) > 0) AS discount_orders,
         COALESCE(SUM(GREATEST(COALESCE(q.subtotal, 0) - COALESCE(q.total, 0), 0)), 0) AS discount_amount_bs,
         COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(q.coupon_code), ''), '') <> '') AS coupon_orders,
         COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(q.gift_name), ''), '') <> '') AS gift_orders
       FROM quotes q
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    ),
    runAdminAiSafeQuery(
      `SELECT
         LOWER(COALESCE(NULLIF(TRIM(u.role), ''), 'sin_rol')) AS role,
         COUNT(*) AS user_count
       FROM users u
       WHERE u.is_active = TRUE
       GROUP BY role
       ORDER BY user_count DESC, role ASC`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(u.city), ''), 'Sin ciudad') AS city,
         COUNT(*) AS user_count
       FROM users u
       WHERE u.is_active = TRUE
       GROUP BY city
       ORDER BY user_count DESC, city ASC
       LIMIT 12`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COUNT(*) AS product_count,
         COALESCE(SUM(COALESCE(stock_cochabamba, 0) + COALESCE(stock_santacruz, 0) + COALESCE(stock_lima, 0)), 0) AS total_stock_units,
         COUNT(*) FILTER (
           WHERE COALESCE(stock_cochabamba, 0) < COALESCE(min_stock_cochabamba, 0)
             OR COALESCE(stock_santacruz, 0) < COALESCE(min_stock_santacruz, 0)
             OR COALESCE(stock_lima, 0) < COALESCE(min_stock_lima, 0)
         ) AS low_stock_products
       FROM products
       WHERE is_active = TRUE`
    ),
    runAdminAiSafeQuery(
      `SELECT
         sku,
         name,
         LEAST(
           COALESCE(stock_cochabamba, 0) - COALESCE(min_stock_cochabamba, 0),
           COALESCE(stock_santacruz, 0) - COALESCE(min_stock_santacruz, 0),
           COALESCE(stock_lima, 0) - COALESCE(min_stock_lima, 0)
         ) AS worst_gap
       FROM products
       WHERE is_active = TRUE
         AND (
           COALESCE(stock_cochabamba, 0) < COALESCE(min_stock_cochabamba, 0)
           OR COALESCE(stock_santacruz, 0) < COALESCE(min_stock_santacruz, 0)
           OR COALESCE(stock_lima, 0) < COALESCE(min_stock_lima, 0)
         )
       ORDER BY worst_gap ASC, sku ASC
       LIMIT 20`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COUNT(*) AS product_count,
         COALESCE(AVG(COALESCE(sf_price, 0)), 0) AS avg_sf_price,
         COALESCE(AVG(COALESCE(cf_price, 0)), 0) AS avg_cf_price
       FROM products
       WHERE is_active = TRUE`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(e.department), ''), 'Sin departamento') AS department,
         COUNT(*) AS expense_count,
         COALESCE(SUM(e.amount), 0) AS total_expense_bs
       FROM department_expenses e
       ${expenseWhere}
       GROUP BY department
       ORDER BY total_expense_bs DESC
       LIMIT 12`,
      expenseParams
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(e.category), ''), 'Sin categoría') AS category,
         COUNT(*) AS expense_count,
         COALESCE(SUM(e.amount), 0) AS total_expense_bs
       FROM department_expenses e
       ${expenseWhere}
       GROUP BY category
       ORDER BY total_expense_bs DESC
       LIMIT 12`,
      expenseParams
    ),
    runAdminAiSafeQuery(
      `SELECT
         COUNT(*) AS recurring_count,
         COALESCE(SUM(e.amount), 0) AS recurring_amount_bs
       FROM department_expenses e
       ${recurringWhere}`,
      expenseParams
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(p.area), ''), 'Sin área') AS area,
         COUNT(*) AS project_count
       FROM projects p
       WHERE p.is_active = TRUE
       GROUP BY area
       ORDER BY project_count DESC, area ASC`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(t.status), ''), 'sin_estado') AS status,
         COUNT(*) AS task_count,
         COALESCE(SUM(COALESCE(t.cost, 0)), 0) AS total_cost_bs
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE p.is_active = TRUE${taskDateFilter.sql}
       GROUP BY status
       ORDER BY task_count DESC, status ASC`,
      taskDateFilter.params
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(r.result), ''), 'sin_resultado') AS qc_result,
         COUNT(*) AS record_count,
         COALESCE(SUM(r.quantity), 0) AS total_units
       FROM quality_control_records r
       WHERE 1 = 1${qcDateFilter.sql}
       GROUP BY qc_result
       ORDER BY total_units DESC`,
      qcDateFilter.params
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(r.sku), ''), 'Sin SKU') AS sku,
         COALESCE(NULLIF(TRIM(r.product_name), ''), COALESCE(NULLIF(TRIM(r.sku), ''), 'Producto')) AS product_name,
         COALESCE(SUM(r.quantity), 0) AS total_units
       FROM quality_control_records r
       WHERE 1 = 1${qcDateFilter.sql}
       GROUP BY sku, product_name
       ORDER BY total_units DESC
       LIMIT 15`,
      qcDateFilter.params
    ),
    runAdminAiSafeQuery(
      `SELECT
         COUNT(*) AS combo_count,
         COALESCE(AVG(COALESCE(sf_price, 0)), 0) AS avg_sf_price,
         COALESCE(AVG(COALESCE(cf_price, 0)), 0) AS avg_cf_price
       FROM combos`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COALESCE(NULLIF(TRIM(sku), ''), 'Sin SKU') AS sku,
         COALESCE(SUM(quantity), 0) AS total_qty
       FROM combo_items
       GROUP BY sku
       ORDER BY total_qty DESC
       LIMIT 12`
    ),
    runAdminAiSafeQuery(
      `SELECT
         COUNT(*) AS total_coupons,
         COUNT(*) FILTER (WHERE valid_until >= CURRENT_DATE) AS active_coupons,
         COALESCE(AVG(COALESCE(discount_percent, 0)), 0) AS avg_discount_percent
       FROM cupones`
    ),
    runAdminAiSafeQuery(
      `SELECT
         LOWER(COALESCE(NULLIF(TRIM(u.role), ''), 'sin_rol')) AS role,
         COUNT(DISTINCT u.id) AS active_users,
         COALESCE(SUM(q.total), 0) AS shipped_sales_bs
       FROM users u
       LEFT JOIN quotes q
         ON q.user_id = u.id
         AND q.status = 'Enviado'${dateFilter.sql}
       WHERE u.is_active = TRUE
       GROUP BY role
       ORDER BY shipped_sales_bs DESC, role ASC`,
      dateFilter.params
    )
  ]);

  const rows = [];
  const pushRow = (section, metric, dimension, value, amountBs = 0, note = '') => {
    rows.push({
      section,
      metric,
      dimension: String(dimension || '').trim() || 'n/a',
      value: toSafeNumber(value),
      amount_bs: toSafeNumber(amountBs),
      note: String(note || '').trim()
    });
  };

  for (const row of salesByStatusRows) {
    pushRow('ventas', 'estado', row.status, row.order_count, row.total_sales_bs, 'Pedidos y monto por estado');
  }
  for (const row of salesByDayRows) {
    pushRow('ventas', 'tendencia_dia', row.period_day, row.order_count, row.total_sales_bs, 'Ventas finalizadas por día');
  }
  for (const row of topProductsRows) {
    pushRow('ventas', 'top_producto', `${row.sku} · ${row.product_name}`, row.total_qty, 0, 'Cantidad vendida');
  }
  for (const row of topSellersRows) {
    pushRow('ventas', 'top_vendedor', row.seller, row.order_count, row.total_sales_bs, 'Pedidos y monto');
  }
  for (const row of topLocationsRows) {
    pushRow('ventas', 'ubicacion', row.location, row.order_count, row.total_sales_bs, 'Pedidos y monto');
  }
  for (const row of warehouseRows) {
    pushRow('almacen', 'rendimiento', row.warehouse, row.order_count, row.total_sales_bs, 'Pedidos enviados y monto');
  }

  if (discountUsageRows[0]) {
    const discountRow = discountUsageRows[0];
    pushRow('ventas', 'descuentos', 'pedidos_con_descuento', discountRow.discount_orders, discountRow.discount_amount_bs, 'Monto total descontado');
    pushRow('marketing', 'promociones', 'pedidos_con_cupon', discountRow.coupon_orders, 0, 'Uso de cupón');
    pushRow('marketing', 'promociones', 'pedidos_con_regalo', discountRow.gift_orders, 0, 'Uso de regalo');
  }

  for (const row of userByRoleRows) {
    pushRow('usuarios', 'rol_activo', row.role, row.user_count, 0, 'Usuarios activos por rol');
  }
  for (const row of userByCityRows) {
    pushRow('usuarios', 'ciudad_activa', row.city, row.user_count, 0, 'Usuarios activos por ciudad');
  }

  if (inventorySummaryRows[0]) {
    const inventoryRow = inventorySummaryRows[0];
    pushRow('inventario', 'resumen', 'productos_activos', inventoryRow.product_count, inventoryRow.total_stock_units, 'value=productos, amount_bs=unidades en stock');
    pushRow('inventario', 'resumen', 'productos_bajo_minimo', inventoryRow.low_stock_products, 0, 'SKUs con stock por debajo del mínimo');
  }
  for (const row of lowStockRows) {
    pushRow('inventario', 'bajo_stock', `${row.sku} · ${row.name}`, row.worst_gap, 0, 'Gap negativo vs mínimo (más negativo = más crítico)');
  }
  if (priceSummaryRows[0]) {
    const priceRow = priceSummaryRows[0];
    pushRow('inventario', 'precios', 'promedio_sf', priceRow.avg_sf_price, 0, 'Precio SF promedio');
    pushRow('inventario', 'precios', 'promedio_cf', priceRow.avg_cf_price, 0, 'Precio CF promedio');
  }

  for (const row of expensesByDepartmentRows) {
    pushRow('finanzas', 'gastos_departamento', row.department, row.expense_count, row.total_expense_bs, 'Cantidad de registros y total');
  }
  for (const row of expensesByCategoryRows) {
    pushRow('finanzas', 'gastos_categoria', row.category, row.expense_count, row.total_expense_bs, 'Cantidad de registros y total');
  }
  if (recurringExpenseRows[0]) {
    const recurringRow = recurringExpenseRows[0];
    pushRow('finanzas', 'gasto_recurrente', 'total_recurrente', recurringRow.recurring_count, recurringRow.recurring_amount_bs, 'Registros y monto recurrente');
  }

  for (const row of projectsByAreaRows) {
    pushRow('proyectos', 'proyectos_por_area', row.area, row.project_count, 0, 'Proyectos activos');
  }
  for (const row of tasksByStatusRows) {
    pushRow('proyectos', 'tareas_por_estado', row.status, row.task_count, row.total_cost_bs, 'Cantidad y costo estimado');
  }

  for (const row of qcByResultRows) {
    pushRow('calidad', 'resultado_qc', row.qc_result, row.record_count, row.total_units, 'value=registros, amount_bs=unidades inspeccionadas');
  }
  for (const row of qcBySkuRows) {
    pushRow('calidad', 'top_sku_qc', `${row.sku} · ${row.product_name}`, row.total_units, 0, 'Unidades inspeccionadas');
  }

  if (combosSummaryRows[0]) {
    const combosRow = combosSummaryRows[0];
    pushRow('marketing', 'combos', 'combos_totales', combosRow.combo_count, 0, 'Cantidad total de combos');
    pushRow('marketing', 'combos', 'precio_sf_promedio', combosRow.avg_sf_price, 0, 'Precio SF promedio en combos');
    pushRow('marketing', 'combos', 'precio_cf_promedio', combosRow.avg_cf_price, 0, 'Precio CF promedio en combos');
  }
  for (const row of comboItemsRows) {
    pushRow('marketing', 'componentes_combo', row.sku, row.total_qty, 0, 'Cantidad de uso en combos');
  }
  if (couponsSummaryRows[0]) {
    const couponRow = couponsSummaryRows[0];
    pushRow('marketing', 'cupones', 'cupones_totales', couponRow.total_coupons, 0, 'Cantidad total de cupones');
    pushRow('marketing', 'cupones', 'cupones_activos', couponRow.active_coupons, 0, 'Vigentes a la fecha');
    pushRow('marketing', 'cupones', 'descuento_promedio_pct', couponRow.avg_discount_percent, 0, 'Porcentaje promedio');
  }

  for (const row of shippedSalesByRoleRows) {
    pushRow('comisiones', 'ventas_enviadas_por_rol', row.role, row.active_users, row.shipped_sales_bs, 'value=usuarios activos, amount_bs=ventas enviadas');
  }

  try {
    const settings = await loadCommissionSettings();
    pushRow('comisiones', 'configuracion_pct', 'ventas_lider_percent', settings.ventas_lider_percent, 0, 'Porcentaje configurado');
    pushRow('comisiones', 'configuracion_pct', 'ventas_top_percent', settings.ventas_top_percent, 0, 'Porcentaje configurado');
    pushRow('comisiones', 'configuracion_pct', 'ventas_regular_percent', settings.ventas_regular_percent, 0, 'Porcentaje configurado');
    pushRow('comisiones', 'configuracion_pct', 'almacen_percent', settings.almacen_percent, 0, 'Porcentaje configurado');
    pushRow('comisiones', 'configuracion_pct', 'marketing_lider_percent', settings.marketing_lider_percent, 0, 'Porcentaje configurado');
  } catch (err) {
    if (!isAdminAiSchemaOptionalError(err)) throw err;
  }

  return {
    title: 'Panorama integral (sin datos sensibles de clientes)',
    rows: rows.slice(0, 220)
  };
};

const ADMIN_AI_INTENTS = [
  {
    key: 'full_business_snapshot',
    label: 'Panorama integral',
    keywords: ['todo', 'completo', 'integral', '360', 'dataset', 'datos', 'global', 'panorama', 'negocio']
  },
  {
    key: 'sales_summary',
    label: 'Resumen general',
    keywords: ['resumen', 'general', 'total', 'ventas']
  },
  {
    key: 'top_products',
    label: 'Top productos',
    keywords: ['producto', 'productos', 'sku', 'mas vendido', 'top productos']
  },
  {
    key: 'top_sellers',
    label: 'Ranking vendedores',
    keywords: ['vendedor', 'vendedores', 'asesor', 'ranking vendedor']
  },
  {
    key: 'warehouse_throughput',
    label: 'Rendimiento almacén',
    keywords: ['almacen', 'almacenes', 'warehouse', 'despacho', 'enviado']
  },
  {
    key: 'commission_projection',
    label: 'Comisiones',
    keywords: ['comision', 'comisiones', 'pagar', 'payout', 'proyeccion']
  },
  {
    key: 'leader_team_sales',
    label: 'Líderes de ventas',
    keywords: ['lider', 'líder', 'equipo ventas', 'ventas lider']
  }
];

const detectAdminAiIntent = (questionText = '') => {
  const normalizedQuestion = normalizeText(questionText);
  const scored = ADMIN_AI_INTENTS.map((intent) => {
    const score = intent.keywords.reduce((sum, keyword) => (
      normalizedQuestion.includes(normalizeText(keyword)) ? sum + 1 : sum
    ), 0);
    return { intent, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].intent : ADMIN_AI_INTENTS[0];
};

const buildFallbackAdminAiSummary = ({ intentLabel, periodLabel, datasetTitle, rows }) => {
  const safeIntent = String(intentLabel || 'Análisis').trim();
  const safePeriod = String(periodLabel || 'Periodo actual').trim();
  const safeDataset = String(datasetTitle || 'dataset').trim();
  if (!Array.isArray(rows) || rows.length === 0) {
    return `${safeIntent} (${safePeriod}): no se encontraron registros en ${safeDataset}.`;
  }

  const topRows = rows.slice(0, 3);
  const columns = Object.keys(topRows[0] || {});
  const topPreview = topRows.map((row, index) => {
    const principal = columns
      .slice(0, 3)
      .map((col) => `${col}: ${String(row?.[col] ?? '')}`)
      .join(' · ');
    return `${index + 1}) ${principal}`;
  }).join('\n');

  return [
    `${safeIntent} (${safePeriod}) basado en ${safeDataset}.`,
    `Registros analizados: ${rows.length}.`,
    'Top resultados:',
    topPreview
  ].join('\n');
};

const generateAdminAiSummary = async ({
  question,
  intentLabel,
  periodLabel,
  datasetTitle,
  rows,
  expandedContextTitle,
  expandedContextRows
}) => {
  if (!isAiConfigured()) {
    return {
      summary: buildFallbackAdminAiSummary({ intentLabel, periodLabel, datasetTitle, rows }),
      provider: 'fallback'
    };
  }

  const prompt = [
    `Pregunta del usuario: ${String(question || '').trim()}`,
    `Intent detectado: ${String(intentLabel || '').trim() || 'General'}`,
    `Periodo: ${String(periodLabel || '').trim() || 'Periodo actual'}`,
    `Dataset principal: ${String(datasetTitle || '').trim() || 'Sin título'}`,
    'Datos agregados (tabla markdown):',
    formatAnalyticsRowsMarkdown(rows),
    '',
    `Contexto ampliado del negocio: ${String(expandedContextTitle || '').trim() || 'Sin contexto ampliado'}`,
    'Datos ampliados (tabla markdown):',
    formatAnalyticsRowsMarkdown(expandedContextRows),
    '',
    `Campos sensibles de cliente excluidos: ${ADMIN_AI_SENSITIVE_FIELDS.join(', ')}`,
    '',
    'Responde en español con: (1) resumen ejecutivo, (2) hallazgos clave, (3) 3 acciones sugeridas.'
  ].join('\n');

  try {
    const { content, provider } = await aiChatCompletion({
      system: 'Eres un analista senior de negocio. Usa solo los datos proporcionados y no inventes cifras.',
      user: prompt,
      temperature: 0.2,
      maxTokens: 650
    });
    if (!content) {
      throw new Error('Respuesta de IA vacía');
    }
    return { summary: content, provider };
  } catch (err) {
    console.error('AI analytics fallback:', err.message || err);
    return {
      summary: buildFallbackAdminAiSummary({ intentLabel, periodLabel, datasetTitle, rows }),
      provider: 'fallback'
    };
  }
};

module.exports = {
  ADMIN_AI_INTENTS,
  ADMIN_AI_SENSITIVE_FIELDS,
  GROK_API_URL,
  GROK_MODEL,
  buildAdminAiExpandedDataset,
  buildFallbackAdminAiSummary,
  detectAdminAiIntent,
  formatAnalyticsRowsMarkdown,
  generateAdminAiSummary,
  isAdminAiSchemaOptionalError,
  runAdminAiSafeQuery,
  toSafeNumber
};
