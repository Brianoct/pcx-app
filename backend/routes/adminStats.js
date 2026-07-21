const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { answerAdminAiQuestion } = require('../lib/aiAssistant');
const { computeTeamCommissions } = require('../lib/commissionTeam');
const { COMPLETED_STATUSES, REPORTING_TIMEZONE, buildDateFilter, buildReportingCreatedAtExpr } = require('../lib/reporting');

const router = express.Router();

// ─── ADMIN DASHBOARD STATISTICS ─────────────────────────────────────────────
router.get('/api/admin/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { month, year } = req.query;
  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;

  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    return res.status(400).json({ error: 'Año inválido' });
  }

  const dateFilter = buildDateFilter(month, year, 'q', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    // 1. Most popular products
    const popularRes = await pool.query(`
      SELECT 
        li->>'sku' as sku,
        li->>'displayName' as name,
        SUM(CAST(li->>'qty' AS INTEGER)) as total_quantity
      FROM quotes q,
      LATERAL jsonb_array_elements(q.line_items) li
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY sku, name
      ORDER BY total_quantity DESC
      LIMIT 10
    `, dateFilter.params);

    // 2. Top salespeople
    const salesRes = await pool.query(`
      SELECT 
        (array_agg(q.vendor ORDER BY q.created_at DESC))[1] as vendor,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY LOWER(TRIM(q.vendor))
      ORDER BY total_sales DESC
      LIMIT 10
    `, dateFilter.params);

    // 3. Top locations (departamento/provincia)
    const locRes = await pool.query(`
      SELECT 
        COALESCE(q.provincia, q.department, 'Sin ubicación') as location,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY location
      ORDER BY total_sales DESC
    `, dateFilter.params);

    // 4. Top almacenes by traffic (order count)
    const whRes = await pool.query(`
      SELECT 
        q.store_location,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY q.store_location
      ORDER BY order_count DESC
    `, dateFilter.params);

    // 5. Sales by department for Bolivia map
    const departmentSalesRes = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(q.department), ''), 'Sin departamento') AS department,
        COUNT(*) AS order_count,
        SUM(q.total) AS total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY department
      ORDER BY total_sales DESC
    `, dateFilter.params);

    // 6. Daily sales for selected month (line chart)
    const reportingCreatedAtExpr = buildReportingCreatedAtExpr('q');
    const dailySalesRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM ${reportingCreatedAtExpr})::INT AS day_num,
        TO_CHAR(DATE_TRUNC('day', ${reportingCreatedAtExpr}), 'YYYY-MM-DD') AS period_day,
        COUNT(*) AS order_count,
        SUM(q.total) AS total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY day_num, period_day
      ORDER BY day_num ASC
    `, dateFilter.params);
    const targetMonth = Number.isInteger(monthNum) ? monthNum : (new Date().getMonth() + 1);
    const targetYear = Number.isInteger(yearNum) ? yearNum : new Date().getFullYear();
    const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
    const dailyRowsByDay = new Map(
      (dailySalesRes.rows || []).map((row) => [Number(row.day_num), row])
    );
    const dailySalesSeries = Array.from({ length: daysInTargetMonth }, (_, index) => {
      const day = index + 1;
      const row = dailyRowsByDay.get(day);
      return {
        day,
        period_day: row?.period_day || `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        order_count: Number(row?.order_count || 0),
        total_sales: Number(row?.total_sales || 0)
      };
    });

    // ── Comparison vs previous month + conversion funnel ─────────────────────
    const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1;
    const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear;
    const prevFilter = buildDateFilter(prevMonth, prevYear, 'q', 1);

    const periodSummarySql = `
      SELECT
        COUNT(*) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado'))::int AS sold_count,
        COALESCE(SUM(q.total) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')), 0) AS sold_total,
        COUNT(*)::int AS quotes_count
      FROM quotes q
      WHERE TRUE`;
    const [currentSummaryRes, prevSummaryRes] = await Promise.all([
      pool.query(`${periodSummarySql} ${dateFilter.sql}`, dateFilter.params),
      pool.query(`${periodSummarySql} ${prevFilter.sql}`, prevFilter.params)
    ]);
    const buildPeriodSummary = (row) => {
      const soldCount = Number(row?.sold_count || 0);
      const soldTotal = Number(row?.sold_total || 0);
      const quotesCount = Number(row?.quotes_count || 0);
      return {
        quotes_count: quotesCount,
        sold_count: soldCount,
        sold_total: soldTotal,
        avg_ticket: soldCount > 0 ? soldTotal / soldCount : 0,
        conversion_pct: quotesCount > 0 ? (soldCount / quotesCount) * 100 : 0
      };
    };
    const periodSummary = buildPeriodSummary(currentSummaryRes.rows[0]);
    const previousSummary = {
      ...buildPeriodSummary(prevSummaryRes.rows[0]),
      month: prevMonth,
      year: prevYear
    };

    // Funnel by stage reached (each status implies the previous ones).
    const funnelRes = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE q.status IN ('Confirmado', 'Pagado', 'Embalado', 'Enviado'))::int AS confirmado,
        COUNT(*) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado'))::int AS pagado,
        COUNT(*) FILTER (WHERE q.status = 'Enviado')::int AS enviado
      FROM quotes q
      WHERE TRUE ${dateFilter.sql}
    `, dateFilter.params);

    // Per-seller conversion (grouped case-insensitively, latest spelling).
    const sellerConversionRes = await pool.query(`
      SELECT
        (array_agg(q.vendor ORDER BY q.created_at DESC))[1] AS vendor,
        COUNT(*)::int AS quotes_count,
        COUNT(*) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado'))::int AS sold_count,
        COALESCE(SUM(q.total) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')), 0) AS sold_total
      FROM quotes q
      WHERE q.vendor IS NOT NULL AND TRIM(q.vendor) <> '' ${dateFilter.sql}
      GROUP BY LOWER(TRIM(q.vendor))
      ORDER BY sold_total DESC
      LIMIT 10
    `, dateFilter.params);

    // Previous month's daily curve (ghost line behind the current one).
    const prevDailyRes = await pool.query(`
      SELECT
        EXTRACT(DAY FROM ${reportingCreatedAtExpr})::INT AS day_num,
        SUM(q.total) AS total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${prevFilter.sql}
      GROUP BY day_num
      ORDER BY day_num ASC
    `, prevFilter.params);

    // Period matcher for non-quote tables (targetMonth/Year are validated ints).
    const tzCol = (col) => `timezone('${REPORTING_TIMEZONE}', ${col} AT TIME ZONE 'UTC')`;
    const inPeriod = (col) =>
      `EXTRACT(MONTH FROM ${tzCol(col)}) = ${targetMonth} AND EXTRACT(YEAR FROM ${tzCol(col)}) = ${targetYear}`;

    // ── Customer analytics: new vs repeat revenue + top customers ────────────
    const customerMixRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE prior.id IS NOT NULL)::int AS repeat_count,
        COALESCE(SUM(q.total) FILTER (WHERE prior.id IS NOT NULL), 0) AS repeat_total,
        COUNT(*) FILTER (WHERE prior.id IS NULL)::int AS new_count,
        COALESCE(SUM(q.total) FILTER (WHERE prior.id IS NULL), 0) AS new_total
      FROM quotes q
      LEFT JOIN LATERAL (
        SELECT p.id FROM quotes p
        WHERE regexp_replace(COALESCE(p.customer_phone, ''), '\\D', '', 'g') <> ''
          AND regexp_replace(COALESCE(p.customer_phone, ''), '\\D', '', 'g')
              = regexp_replace(COALESCE(q.customer_phone, ''), '\\D', '', 'g')
          AND p.created_at < q.created_at
        LIMIT 1
      ) prior ON TRUE
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado') ${dateFilter.sql}
    `, dateFilter.params);
    const newCustomersRes = await pool.query(
      `SELECT COUNT(*)::int AS new_customers FROM customers c WHERE ${inPeriod('c.created_at')}`
    );
    const topCustomersRes = await pool.query(`
      SELECT
        (array_agg(q.customer_name ORDER BY q.created_at DESC))[1] AS name,
        COUNT(*)::int AS orders_count,
        SUM(q.total) AS total_spent
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        AND regexp_replace(COALESCE(q.customer_phone, ''), '\\D', '', 'g') <> ''
        ${dateFilter.sql}
      GROUP BY regexp_replace(COALESCE(q.customer_phone, ''), '\\D', '', 'g')
      ORDER BY total_spent DESC
      LIMIT 5
    `, dateFilter.params);

    // ── Production quality: QC gate + warehouse reception (new kanban flow) ──
    const qcPeriodRes = await pool.query(`
      SELECT
        COALESCE(SUM(quantity) FILTER (WHERE result = 'passed'), 0)::int AS qc_passed,
        COALESCE(SUM(quantity) FILTER (WHERE result = 'rejected'), 0)::int AS qc_rejected
      FROM quality_control_records
      WHERE ${inPeriod('created_at')}
    `);
    const receptionPeriodRes = await pool.query(`
      SELECT
        COALESCE(SUM(qty) FILTER (WHERE to_stage = 'recibido'), 0)::int AS received,
        COALESCE(SUM(qty) FILTER (WHERE to_stage = 'danado_transito'), 0)::int AS damaged
      FROM production_stage_events
      WHERE to_stage IN ('recibido', 'danado_transito')
        AND EXTRACT(MONTH FROM timezone('${REPORTING_TIMEZONE}', moved_at)) = ${targetMonth}
        AND EXTRACT(YEAR FROM timezone('${REPORTING_TIMEZONE}', moved_at)) = ${targetYear}
    `);

    // Per-user commissions come from the shared team calculation — the same
    // rules as /api/commission/current and the Pagos view (single source of truth).
    const teamCommissions = await computeTeamCommissions(month, year);
    if (teamCommissions?.error) {
      return res.status(400).json({ error: teamCommissions.error });
    }
    const commissionByUser = (teamCommissions.users || []).map((row) => ({
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      user_id: row.user_id,
      user_label: row.display_name || row.email || 'Usuario',
      role: row.role,
      city: row.city,
      commission: Number(row.commission || 0),
      source: row.source || '',
      is_top_seller: Boolean(row.is_top_seller)
    }));
    const totalCommissionToDate = commissionByUser.reduce((sum, row) => sum + Number(row.commission || 0), 0);

    res.json({
      popularProducts: popularRes.rows,
      topSalespeople: salesRes.rows,
      topLocations: locRes.rows,
      topWarehouses: whRes.rows,
      salesByDepartment: departmentSalesRes.rows,
      dailySalesSeries,
      activeUserCommissions: commissionByUser,
      totalCommissionToDate,
      periodSummary,
      previousSummary,
      funnel: funnelRes.rows[0],
      sellerConversion: sellerConversionRes.rows.map((row) => ({
        vendor: row.vendor,
        quotes_count: Number(row.quotes_count || 0),
        sold_count: Number(row.sold_count || 0),
        sold_total: Number(row.sold_total || 0),
        conversion_pct: Number(row.quotes_count) > 0 ? (Number(row.sold_count) / Number(row.quotes_count)) * 100 : 0
      })),
      prevDailySalesSeries: prevDailyRes.rows.map((row) => ({
        day_num: Number(row.day_num),
        total_sales: Number(row.total_sales || 0)
      })),
      customerMix: {
        ...customerMixRes.rows[0],
        repeat_total: Number(customerMixRes.rows[0]?.repeat_total || 0),
        new_total: Number(customerMixRes.rows[0]?.new_total || 0),
        new_customers: Number(newCustomersRes.rows[0]?.new_customers || 0)
      },
      topCustomers: topCustomersRes.rows.map((row) => ({
        name: row.name,
        orders_count: Number(row.orders_count || 0),
        total_spent: Number(row.total_spent || 0)
      })),
      productionQuality: {
        qc_passed: Number(qcPeriodRes.rows[0]?.qc_passed || 0),
        qc_rejected: Number(qcPeriodRes.rows[0]?.qc_rejected || 0),
        received: Number(receptionPeriodRes.rows[0]?.received || 0),
        damaged: Number(receptionPeriodRes.rows[0]?.damaged || 0)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

router.post('/api/admin/ai-analytics', authenticateToken, requireRole(['admin']), async (req, res) => {
  const question = String(req.body?.question || req.body?.prompt || '').trim();
  const month = req.body?.month;
  const year = req.body?.year;
  if (!question) {
    return res.status(400).json({ error: 'Pregunta requerida para análisis IA' });
  }

  try {
    const payload = await answerAdminAiQuestion({ question, month, year });
    return res.json(payload);
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Admin AI analytics error:', err);
    return res.status(500).json({ error: 'No se pudo ejecutar el análisis IA' });
  }
});

module.exports = router;
