// Ventas por línea de producto (Acero vs Armonía): ingresos y unidades del
// mes elegido + serie de los últimos 6 meses, para la tarjeta comparativa de
// Estadísticas. Cada ítem vendido se clasifica por products.product_line
// (COMBO_<id> por combos.product_line); sin línea asignada cuenta como Acero,
// que es la línea histórica.
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { COMPLETED_STATUSES, REPORTING_TIMEZONE, buildReportingCreatedAtExpr } = require('../lib/reporting');
const { createHttpError } = require('../lib/util');

const router = express.Router();

const LINES = ['acero', 'armonia'];
const MONTHS_BACK = 5; // mes elegido + 5 anteriores = 6 barras

const emptyLine = () => ({ revenue: 0, units: 0 });

const round2 = (n) => Number(Number(n || 0).toFixed(2));

const computeLineStats = async ({ month, year } = {}) => {
  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;
  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    throw createHttpError(400, 'Mes inválido. Debe estar entre 1 y 12');
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    throw createHttpError(400, 'Año inválido');
  }

  // Mes por defecto: el actual en hora de Bolivia.
  let selMonth = monthNum;
  let selYear = yearNum;
  if (selMonth === null || selYear === null) {
    const nowRes = await pool.query(
      `SELECT EXTRACT(MONTH FROM NOW() AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS m,
              EXTRACT(YEAR FROM NOW() AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS y`
    );
    if (selMonth === null) selMonth = nowRes.rows[0].m;
    if (selYear === null) selYear = nowRes.rows[0].y;
  }

  // Ventana [primer día del mes-5, primer día del mes siguiente) en hora local.
  const monthStart = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;
  const shiftMonth = (y, m, delta) => {
    const idx = y * 12 + (m - 1) + delta;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  };
  const first = shiftMonth(selYear, selMonth, -MONTHS_BACK);
  const next = shiftMonth(selYear, selMonth, 1);
  const createdAtExpr = buildReportingCreatedAtExpr('q');

  const [salesRes, productsRes, combosRes] = await Promise.all([
    pool.query(
      `SELECT to_char(date_trunc('month', ${createdAtExpr}), 'YYYY-MM') AS ym,
              UPPER(TRIM(li->>'sku')) AS sku,
              SUM(COALESCE((li->>'qty')::numeric, 0))::numeric AS units,
              SUM(COALESCE((li->>'lineTotal')::numeric, 0))::numeric AS revenue
       FROM quotes q, LATERAL jsonb_array_elements(q.line_items) li
       WHERE q.status IN (${COMPLETED_STATUSES.map((s) => `'${s}'`).join(', ')})
         AND q.line_items IS NOT NULL
         AND ${createdAtExpr} >= $1::timestamp
         AND ${createdAtExpr} < $2::timestamp
       GROUP BY 1, 2`,
      [monthStart(first.y, first.m), monthStart(next.y, next.m)]
    ),
    pool.query('SELECT UPPER(sku) AS sku, name, product_line FROM products'),
    pool.query('SELECT id, name, product_line FROM combos')
  ]);

  // Clave de venta → { line, name }. Lo no clasificable cae en Acero (línea
  // histórica: el backfill dejó todo lo previo como acero).
  const catalog = new Map();
  for (const p of productsRes.rows) {
    catalog.set(p.sku, { line: LINES.includes(p.product_line) ? p.product_line : 'acero', name: p.name });
  }
  for (const c of combosRes.rows) {
    catalog.set(`COMBO_${c.id}`, { line: LINES.includes(c.product_line) ? c.product_line : 'acero', name: `${c.name} (Combo)` });
  }
  const classify = (sku) => catalog.get(sku) || { line: 'acero', name: sku };

  // Serie mensual: los 6 meses SIEMPRE presentes aunque no haya ventas.
  const months = [];
  const byYm = new Map();
  for (let i = 0; i <= MONTHS_BACK; i += 1) {
    const { y, m } = shiftMonth(first.y, first.m, i);
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const row = { ym, acero: emptyLine(), armonia: emptyLine() };
    months.push(row);
    byYm.set(ym, row);
  }

  const selYm = `${selYear}-${String(selMonth).padStart(2, '0')}`;
  const topByLine = { acero: new Map(), armonia: new Map() };
  for (const row of salesRes.rows) {
    const bucket = byYm.get(row.ym);
    if (!bucket) continue;
    const { line, name } = classify(row.sku);
    const units = Number(row.units || 0);
    const revenue = Number(row.revenue || 0);
    bucket[line].revenue += revenue;
    bucket[line].units += units;
    if (row.ym === selYm) {
      const top = topByLine[line];
      const prev = top.get(row.sku) || { key: row.sku, name, units: 0, revenue: 0 };
      prev.units += units;
      prev.revenue += revenue;
      top.set(row.sku, prev);
    }
  }
  for (const row of months) {
    for (const line of LINES) {
      row[line].revenue = round2(row[line].revenue);
      row[line].units = round2(row[line].units);
    }
  }

  const selected = byYm.get(selYm) || { acero: emptyLine(), armonia: emptyLine() };
  const totalRevenue = selected.acero.revenue + selected.armonia.revenue;
  const sharePct = (line) => (totalRevenue > 0 ? Number(((selected[line].revenue / totalRevenue) * 100).toFixed(1)) : null);
  const topOf = (line) => [...topByLine[line].values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)
    .map((p) => ({ ...p, units: round2(p.units), revenue: round2(p.revenue) }));

  return {
    month: selMonth,
    year: selYear,
    months,
    selected: {
      ym: selYm,
      total_revenue: round2(totalRevenue),
      acero: { ...selected.acero, share_pct: sharePct('acero'), top: topOf('acero') },
      armonia: { ...selected.armonia, share_pct: sharePct('armonia'), top: topOf('armonia') }
    }
  };
};

router.get('/api/admin/line-stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const data = await computeLineStats({ month: req.query.month, year: req.query.year });
    res.json(data);
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error en ventas por línea:', err);
    res.status(500).json({ error: 'No se pudo calcular las ventas por línea' });
  }
});

module.exports = router;
