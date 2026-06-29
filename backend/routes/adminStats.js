const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { answerAdminAiQuestion } = require('../lib/aiAssistant');
const { computeQualityControlCommissionTotal, loadCommissionSettings } = require('../lib/commission');
const { resolveInventoryScopeByCity } = require('../lib/inventory');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { COMPLETED_STATUSES, buildDateFilter, buildReportingCreatedAtExpr } = require('../lib/reporting');

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
  // Queries below use different leading params ($1 status, $2 role, etc),
  // so they need matching filter placeholder offsets.
  const dateFilterWithStatus = buildDateFilter(month, year, 'q', 2);
  if (dateFilterWithStatus.error) return res.status(400).json({ error: dateFilterWithStatus.error });
  const dateFilterWithStatusAndRole = buildDateFilter(month, year, 'q', 3);
  if (dateFilterWithStatusAndRole.error) return res.status(400).json({ error: dateFilterWithStatusAndRole.error });

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
        q.vendor,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter.sql}
      GROUP BY q.vendor
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

    const activeUsersRes = await pool.query(
      `SELECT id, email, display_name, role, city
       FROM users
       WHERE is_active = TRUE
       ORDER BY display_name NULLS LAST, email ASC`
    );
    const activeUsers = activeUsersRes.rows || [];
    const commissionSettings = await loadCommissionSettings();
    const rateVentasLider = Number(commissionSettings.ventas_lider_percent || 0) / 100;
    const rateVentasTop = Number(commissionSettings.ventas_top_percent || 0) / 100;
    const rateVentasRegular = Number(commissionSettings.ventas_regular_percent || 0) / 100;
    const rateAlmacen = Number(commissionSettings.almacen_percent || 0) / 100;
    const rateMarketingLider = Number(commissionSettings.marketing_lider_percent || 0) / 100;

    const allSalesRes = await pool.query(
      `SELECT COALESCE(SUM(q.total), 0) AS total_sales
       FROM quotes q
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    );
    const allSales = Number(allSalesRes.rows[0]?.total_sales || 0);

    const salesRankingRes = await pool.query(
      `SELECT
         u.id AS user_id,
         COALESCE(SUM(q.total), 0) AS total_sales
       FROM users u
       LEFT JOIN quotes q
         ON q.user_id = u.id
         AND q.status = ANY($1::text[])${dateFilterWithStatus.sql}
       WHERE LOWER(u.role) IN ('ventas', 'sales', 'vendedor')
         AND u.is_active = TRUE
       GROUP BY u.id
       ORDER BY total_sales DESC, u.id ASC`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    );
    const topSalesUserId = Number(salesRankingRes.rows[0]?.user_id || 0) || null;
    const salesTotalsByUserId = new Map(
      salesRankingRes.rows.map((row) => [Number(row.user_id), Number(row.total_sales || 0)])
    );

    const ownSalesByUserRes = await pool.query(
      `SELECT
         q.user_id,
         COALESCE(SUM(q.total), 0) AS total_sales
       FROM quotes q
       WHERE q.status = ANY($1::text[])${dateFilterWithStatus.sql}
       GROUP BY q.user_id`,
      [COMPLETED_STATUSES, ...dateFilterWithStatus.params]
    );
    const ownSalesByUserId = new Map(
      ownSalesByUserRes.rows.map((row) => [Number(row.user_id), Number(row.total_sales || 0)])
    );

    const salesRoleOnlyRes = await pool.query(
      `SELECT COALESCE(SUM(q.total), 0) AS total_sales
       FROM quotes q
       JOIN users u ON u.id = q.user_id
       WHERE q.status = ANY($1::text[])
         AND u.is_active = TRUE
         AND LOWER(u.role) = $2${dateFilterWithStatusAndRole.sql}`,
      [COMPLETED_STATUSES, ROLE_KEYS.ventas, ...dateFilterWithStatusAndRole.params]
    );
    const salesRoleOnlyTotal = Number(salesRoleOnlyRes.rows[0]?.total_sales || 0);

    const warehouseSalesByUserIdRes = await pool.query(
      `SELECT
         u.id AS user_id,
         COALESCE(SUM(q.total), 0) AS total_sales
       FROM users u
       LEFT JOIN quotes q
         ON q.status = $1
         AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
             LIKE '%' || LOWER(REGEXP_REPLACE((CASE
               WHEN LOWER(REGEXP_REPLACE(COALESCE(u.city, ''), '[^a-z0-9]+', '', 'g')) LIKE '%santacruz%'
                 OR LOWER(REGEXP_REPLACE(COALESCE(u.city, ''), '[^a-z0-9]+', '', 'g')) LIKE '%santacruzde%lasierra%'
                 OR LOWER(REGEXP_REPLACE(COALESCE(u.city, ''), '[^a-z0-9]+', '', 'g')) LIKE '%scz%'
               THEN 'Santa Cruz'
               WHEN LOWER(REGEXP_REPLACE(COALESCE(u.city, ''), '[^a-z0-9]+', '', 'g')) LIKE '%cochabamba%'
                 OR LOWER(REGEXP_REPLACE(COALESCE(u.city, ''), '[^a-z0-9]+', '', 'g')) LIKE '%cbba%'
               THEN 'Cochabamba'
               WHEN LOWER(REGEXP_REPLACE(COALESCE(u.city, ''), '[^a-z0-9]+', '', 'g')) LIKE '%lima%'
               THEN 'Lima'
               ELSE COALESCE(u.city, '')
             END), '[^a-z0-9]+', '', 'g')) || '%'
         AND q.user_id IS NOT NULL${dateFilterWithStatusAndRole.sql}
       WHERE u.is_active = TRUE
         AND LOWER(u.role) = $2
       GROUP BY u.id`,
      ['Enviado', ROLE_KEYS.almacen, ...dateFilterWithStatusAndRole.params]
    );
    const warehouseSalesByUserId = new Map(
      warehouseSalesByUserIdRes.rows.map((row) => [Number(row.user_id), Number(row.total_sales || 0)])
    );

    const qcCommissionResult = await computeQualityControlCommissionTotal(month, year);
    if (qcCommissionResult?.error) {
      return res.status(400).json({ error: qcCommissionResult.error });
    }
    const qcCommissionTotal = Number(qcCommissionResult?.total || 0);

    const commissionByUser = activeUsers.map((userRow) => {
      const userId = Number(userRow.id);
      const roleNormalized = normalizeRole(userRow.role || '');
      const label = String(userRow.display_name || '').trim() || String(userRow.email || '').trim();
      const cityScope = resolveInventoryScopeByCity(userRow.city || '');
      const localStore = cityScope?.canonical || userRow.city || '';
      let commission = 0;

      const ownSales = Number(ownSalesByUserId.get(userId) || 0);
      if (
        roleNormalized === ROLE_KEYS.admin
        || roleNormalized === ROLE_KEYS.almacenLider
        || roleNormalized === ROLE_KEYS.microfabrica
        || roleNormalized === ROLE_KEYS.microfabricaLider
      ) {
        commission = qcCommissionTotal;
      } else if (roleNormalized === ROLE_KEYS.marketingLider) {
        commission = allSales * rateMarketingLider;
      } else if (roleNormalized === ROLE_KEYS.ventasLider) {
        commission = (salesRoleOnlyTotal + ownSales) * rateVentasLider;
      } else if (roleNormalized === ROLE_KEYS.ventas || roleNormalized === 'sales' || roleNormalized === 'vendedor') {
        const salesOwnTotal = Number(salesTotalsByUserId.get(userId) || ownSales);
        const rate = topSalesUserId === userId && ownSales > 0 ? rateVentasTop : rateVentasRegular;
        commission = salesOwnTotal * rate;
      } else if (roleNormalized === ROLE_KEYS.almacen) {
        const localSales = Number(warehouseSalesByUserId.get(userId) || 0);
        commission = localSales * rateAlmacen;
      } else if (roleNormalized === ROLE_KEYS.marketing) {
        commission = 0;
      } else {
        commission = 0;
      }

      return {
        id: userId,
        email: String(userRow.email || '').trim(),
        display_name: String(userRow.display_name || '').trim(),
        user_id: userId,
        user_label: label || 'Usuario',
        role: String(userRow.role || '').trim() || 'Sin rol',
        city: String(userRow.city || '').trim() || '',
        commission: Number(commission || 0)
      };
    });
    const totalCommissionToDate = commissionByUser.reduce((sum, row) => sum + Number(row.commission || 0), 0);

    res.json({
      popularProducts: popularRes.rows,
      topSalespeople: salesRes.rows,
      topLocations: locRes.rows,
      topWarehouses: whRes.rows,
      salesByDepartment: departmentSalesRes.rows,
      dailySalesSeries,
      activeUserCommissions: commissionByUser,
      totalCommissionToDate
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
