const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { loadCommissionSettings } = require('../lib/commission');
const { computeTeamCommissions } = require('../lib/commissionTeam');
const { resolveInventoryScopeByCity } = require('../lib/inventory');
const { ROLE_KEYS, normalizeRole, sanitizePanelAccess } = require('../lib/rbac');
const { COMPLETED_STATUSES, buildDateFilter, buildReportingCreatedAtExpr } = require('../lib/reporting');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// ─── Performance ────────────────────────────────────────────────────────────
router.get('/api/performance', authenticateToken, async (req, res) => {
  const { team, month, year } = req.query;
  const isTeamView = team === 'true';
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);

  if (isTeamView && !access.rendimiento_global) {
    return res.status(403).json({ error: 'No tienes permiso para rendimiento global' });
  }
  if (!isTeamView && !access.rendimiento_individual) {
    return res.status(403).json({ error: 'No tienes permiso para rendimiento individual' });
  }
  const dateFilter = buildDateFilter(month, year, 'q', 2);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    if (isTeamView) {
      const queryText = `
        SELECT 
          u.id as user_id,
          u.email as usuario,
          u.role as rol,
          COUNT(q.id) FILTER (WHERE q.status = ANY($1::text[])) as cotizaciones_confirmadas,
          COALESCE(SUM(q.total) FILTER (WHERE q.status = ANY($1::text[])), 0) as ventas_totales
        FROM users u
        LEFT JOIN quotes q ON u.id = q.user_id${dateFilter.sql}
        WHERE u.is_active = TRUE
          AND (u.role ILIKE '%ventas%' OR u.role ILIKE '%sales%' OR u.role ILIKE '%vendedor%')
        GROUP BY u.id, u.email, u.role
        ORDER BY ventas_totales DESC
      `;
      const result = await pool.query(queryText, [COMPLETED_STATUSES, ...dateFilter.params]);
      res.json(result.rows || []);
    } else {
      const personalDateFilter = buildDateFilter(month, year, 'q', 3);
      if (personalDateFilter.error) return res.status(400).json({ error: personalDateFilter.error });
      const personalParams = [req.user.id, COMPLETED_STATUSES, ...personalDateFilter.params];
      const result = await pool.query(
        `SELECT 
          COUNT(id) FILTER (WHERE status = ANY($2::text[])) as cotizaciones_confirmadas,
          COALESCE(SUM(total) FILTER (WHERE status = ANY($2::text[])), 0) as ventas_totales
        FROM quotes q
        WHERE user_id = $1${personalDateFilter.sql}`,
        personalParams
      );
      res.json(result.rows[0] || { cotizaciones_confirmadas: 0, ventas_totales: 0 });
    }
  } catch (err) {
    console.error('Performance endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener rendimiento: ' + err.message });
  }
});

// ─── Current user commission (nav box) ──────────────────────────────────────
router.get('/api/commission/current', authenticateToken, async (req, res) => {
  const { month, year } = req.query;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === ROLE_KEYS.admin;
  const isVentasLider = userRoleNormalized === ROLE_KEYS.ventasLider;
  const isMarketingLider = userRoleNormalized === ROLE_KEYS.marketingLider;
  const isSalesSeller = userRoleNormalized === ROLE_KEYS.ventas || userRoleNormalized === 'sales' || userRoleNormalized === 'vendedor';
  const isAlmacen = userRoleNormalized === ROLE_KEYS.almacen;
  const isAlmacenLider = userRoleNormalized === ROLE_KEYS.almacenLider;
  const isMarketing = userRoleNormalized === ROLE_KEYS.marketing;
  const isProduccion = userRoleNormalized === ROLE_KEYS.produccion;

  const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
  if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });
  const teamDateFilter = buildDateFilter(month, year, 'q', 4);
  if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });
  const ownDateFilter = buildDateFilter(month, year, 'q', 3);
  if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });
  const almacenDateFilter = buildDateFilter(month, year, 'q', 3);
  if (almacenDateFilter.error) return res.status(400).json({ error: almacenDateFilter.error });

  try {
    const commissionSettings = await loadCommissionSettings();
    const rateVentasLider = Number(commissionSettings.ventas_lider_percent || 0) / 100;
    const rateVentasTop = Number(commissionSettings.ventas_top_percent || 0) / 100;
    const rateVentasRegular = Number(commissionSettings.ventas_regular_percent || 0) / 100;
    const rateAlmacen = Number(commissionSettings.almacen_percent || 0) / 100;
    const rateMarketingLider = Number(commissionSettings.marketing_lider_percent || 0) / 100;
    const rateProduccion = Number(commissionSettings.produccion_percent || 0) / 100;
    const rateAlmacenLider = Number(commissionSettings.almacen_lider_percent || 0) / 100;
    const rateAdmin = Number(commissionSettings.admin_percent || 0) / 100;

    // Total completed sales in period. Production/leadership roles earn a %
    // of this (the per-piece QC commission was retired).
    const allSalesRes = await pool.query(
      `SELECT COALESCE(SUM(q.total), 0) AS total_sales
       FROM quotes q
       WHERE q.status = ANY($1::text[])${allSalesDateFilter.sql}`,
      [COMPLETED_STATUSES, ...allSalesDateFilter.params]
    );
    const allSales = Number(allSalesRes.rows[0]?.total_sales || 0);

    const percentOfAllSales = (rate, percentLabel) => res.json({
      commission: allSales * rate,
      isTopSeller: false,
      topSellerEmail: null,
      breakdown: {
        role: req.user.role,
        rate,
        source: `${percentLabel}% del total de ventas`
      }
    });

    if (isAdmin) {
      return percentOfAllSales(rateAdmin, Number(commissionSettings.admin_percent || 0));
    }

    if (isMarketingLider) {
      return res.json({
        commission: allSales * rateMarketingLider,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateMarketingLider,
          source: `${Number(commissionSettings.marketing_lider_percent || 0)}% de todas las ventas`
        }
      });
    }

    if (isVentasLider) {
      // Ventas Lider: configurable % on own sales + all users with exactly Ventas role.
      const teamSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND u.is_active = TRUE
           AND (LOWER(u.role) = $2 OR u.id = $3)${teamDateFilter.sql}`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventas, req.user.id, ...teamDateFilter.params]
      );
      const teamSales = Number(teamSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: teamSales * rateVentasLider,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateVentasLider,
          source: `${Number(commissionSettings.ventas_lider_percent || 0)}% ventas equipo + propias`
        }
      });
    }

    // Usuarios de ventas: quien lidera ventas recibe 12%, los demás 8%.
    if (isSalesSeller) {
      const ownSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.user_id = $1
           AND q.status = ANY($2::text[])${ownDateFilter.sql}`,
        [req.user.id, COMPLETED_STATUSES, ...ownDateFilter.params]
      );
      const ownSales = Number(ownSalesRes.rows[0]?.total_sales || 0);

      const rankingRes = await pool.query(
        `SELECT
           u.id AS user_id,
           u.email AS email,
           COALESCE(SUM(q.total), 0) AS total_sales
         FROM users u
         LEFT JOIN quotes q
           ON q.user_id = u.id
           AND q.status = ANY($1::text[])${allSalesDateFilter.sql}
         WHERE LOWER(u.role) IN ('ventas', 'sales', 'vendedor')
           AND u.is_active = TRUE
         GROUP BY u.id, u.email
         ORDER BY total_sales DESC, u.id ASC
         LIMIT 1`,
        [COMPLETED_STATUSES, ...allSalesDateFilter.params]
      );

      const topSeller = rankingRes.rows[0] || null;
      const topSellerId = topSeller ? Number(topSeller.user_id) : null;
      const isTopSeller = topSellerId === Number(req.user.id) && Number(topSeller.total_sales || 0) > 0;
      const rate = isTopSeller ? rateVentasTop : rateVentasRegular;

      return res.json({
        commission: ownSales * rate,
        isTopSeller,
        topSellerEmail: topSeller?.email || null,
        breakdown: {
          role: req.user.role,
          rate,
          source: `${Number(commissionSettings.ventas_top_percent || 0)}% mejor en ventas / ${Number(commissionSettings.ventas_regular_percent || 0)}% asesor de ventas`
        }
      });
    }

    if (isAlmacen) {
      const cityScope = resolveInventoryScopeByCity(userContext.city || '');
      const localStore = cityScope?.canonical || userContext.city || '';
      const localSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.status = $1
           AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
               LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
           ${almacenDateFilter.sql}`,
        ['Enviado', localStore, ...almacenDateFilter.params]
      );
      const localSales = Number(localSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: localSales * rateAlmacen,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateAlmacen,
          source: `${Number(commissionSettings.almacen_percent || 0)}% pedidos enviados de almacén local (${localStore || 'sin ciudad'})`
        }
      });
    }

    if (isAlmacenLider) {
      return percentOfAllSales(rateAlmacenLider, Number(commissionSettings.almacen_lider_percent || 0));
    }

    if (isMarketing) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0, source: 'Compensación por contrato' }
      });
    }

    if (isProduccion) {
      return percentOfAllSales(rateProduccion, Number(commissionSettings.produccion_percent || 0));
    }

    // Non-sales roles without explicit commission rule.
    return res.json({
      commission: 0,
      isTopSeller: false,
      topSellerEmail: null,
      breakdown: { role: req.user.role || 'Sin rol', rate: 0, source: 'Rol sin comisión configurada' }
    });
  } catch (err) {
    console.error('Commission endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al calcular comisión: ' + err.message });
  }
});

// ─── Team commissions for the payroll view (admin) ──────────────────────────
// One row per active user with their commission for the period, computed with
// the same per-role rules as /api/commission/current.
router.get('/api/admin/team-commissions', authenticateToken, async (req, res) => {
  if (normalizeRole(req.user.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  try {
    const result = await computeTeamCommissions(req.query.month, req.query.year);
    if (result?.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('Team commissions endpoint error:', err.stack);
    res.status(500).json({ error: 'No se pudieron calcular las comisiones del equipo' });
  }
});

// ─── Current user commission orders (debug/details) ─────────────────────────
router.get('/api/commission/current/orders', authenticateToken, async (req, res) => {
  const { month, year } = req.query;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });

  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === ROLE_KEYS.admin;
  const isVentasLider = userRoleNormalized === ROLE_KEYS.ventasLider;
  const isMarketingLider = userRoleNormalized === ROLE_KEYS.marketingLider;
  const isSalesSeller = userRoleNormalized === ROLE_KEYS.ventas || userRoleNormalized === 'sales' || userRoleNormalized === 'vendedor';
  const isAlmacen = userRoleNormalized === ROLE_KEYS.almacen;

  try {
    // Almacén: solo Enviado desde su ciudad/almacén local.
    if (isAlmacen) {
      const almacenDateFilter = buildDateFilter(month, year, 'q', 3);
      if (almacenDateFilter.error) return res.status(400).json({ error: almacenDateFilter.error });

      const cityScope = resolveInventoryScopeByCity(userContext.city || '');
      const localStore = cityScope?.canonical || userContext.city || '';
      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = $1
           AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
               LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
           ${almacenDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        ['Enviado', localStore, ...almacenDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        city: userContext.city || null,
        criteria: {
          status: 'Enviado',
          local_store_match: localStore || null,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Ventas: ventas propias en estados completados.
    if (isSalesSeller) {
      const ownDateFilter = buildDateFilter(month, year, 'q', 3);
      if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.user_id = $1
           AND q.status = ANY($2::text[])${ownDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [req.user.id, COMPLETED_STATUSES, ...ownDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          user_id: req.user.id,
          statuses: COMPLETED_STATUSES,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Ventas Lider: ventas del equipo Ventas + propias en estados completados.
    if (isVentasLider) {
      const teamDateFilter = buildDateFilter(month, year, 'q', 4);
      if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND u.is_active = TRUE
           AND (LOWER(u.role) = $2 OR u.id = $3)${teamDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventas, req.user.id, ...teamDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          statuses: COMPLETED_STATUSES,
          team_role: ROLE_KEYS.ventas,
          include_own_user_id: req.user.id,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Marketing Lider y Admin: todas las ventas completadas.
    if (isMarketingLider || isAdmin) {
      const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
      if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])${allSalesDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [COMPLETED_STATUSES, ...allSalesDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          statuses: COMPLETED_STATUSES,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    return res.json({
      role: req.user.role,
      criteria: { month, year },
      total_sales: 0,
      orders_count: 0,
      orders: [],
      note: 'Este rol no calcula comisión por pedidos en el endpoint actual'
    });
  } catch (err) {
    console.error('Commission orders endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener pedidos de comisión: ' + err.message });
  }
});

// ─── Resumen de comisiones del área de Ventas (Inicio) ──────────────────────
// Un solo viaje para el panel «Rendimiento de ventas» del Inicio comercial:
// KPIs del mes elegido, ranking del equipo (solo líderes/global) y los últimos
// 6 meses para comparar. Mismas reglas de comisión que /api/commission/current
// y Pagos: mejor en ventas → ventas_top_percent, asesor → ventas_regular_percent,
// líder → ventas_lider_percent × (equipo + propias).
const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const HISTORY_MONTHS = 6;

router.get('/api/ventas/comisiones', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
    const canOwn = Boolean(access.cotizar || access.historial_individual || access.rendimiento_individual);
    const canTeam = Boolean(isAdmin || access.historial_global || access.rendimiento_global);
    if (!canOwn && !canTeam) {
      return res.status(403).json({ error: 'No tienes acceso al resumen de comisiones' });
    }

    const now = new Date();
    const monthNum = Number.parseInt(req.query.month ?? (now.getMonth() + 1), 10);
    const yearNum = Number.parseInt(req.query.year ?? now.getFullYear(), 10);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
    }
    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000) {
      return res.status(400).json({ error: 'Año inválido' });
    }

    // Ventana: los 6 meses que terminan en el mes elegido (hora Bolivia).
    const windowStart = new Date(Date.UTC(yearNum, monthNum - 1 - (HISTORY_MONTHS - 1), 1));
    const windowEnd = new Date(Date.UTC(yearNum, monthNum, 1)); // exclusivo
    const toDateStr = (d) => d.toISOString().slice(0, 10);
    const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

    const createdExpr = buildReportingCreatedAtExpr('q');
    const result = await pool.query(
      `SELECT u.id AS user_id, u.email, u.display_name, u.role,
              to_char(date_trunc('month', ${createdExpr}), 'YYYY-MM') AS month_start,
              COUNT(q.id) AS closed_count,
              COALESCE(SUM(q.total), 0) AS total_sales
       FROM users u
       LEFT JOIN quotes q ON q.user_id = u.id
         AND q.status = ANY($1::text[])
         AND date_trunc('month', ${createdExpr}) >= $2::date
         AND date_trunc('month', ${createdExpr}) < $3::date
       WHERE u.is_active = TRUE
         AND (u.role ILIKE '%ventas%' OR u.role ILIKE '%sales%' OR u.role ILIKE '%vendedor%')
       GROUP BY u.id, u.email, u.display_name, u.role, month_start`,
      [COMPLETED_STATUSES, toDateStr(windowStart), toDateStr(windowEnd)]
    );

    const settings = await loadCommissionSettings();
    const topPercent = Number(settings.ventas_top_percent || 0);
    const regularPercent = Number(settings.ventas_regular_percent || 0);
    const liderPercent = Number(settings.ventas_lider_percent || 0);

    const isSeller = (role) => {
      const r = normalizeRole(role || '');
      return r === ROLE_KEYS.ventas || r === 'sales' || r === 'vendedor';
    };
    const isLider = (role) => normalizeRole(role || '') === ROLE_KEYS.ventasLider;

    // users y ventas por (usuario, mes)
    const usersById = new Map();
    const salesByUserMonth = new Map(); // `${userId}|${yyyy-mm}` -> {sales, closed}
    for (const row of result.rows) {
      const id = Number(row.user_id);
      if (!usersById.has(id)) {
        usersById.set(id, {
          user_id: id,
          email: String(row.email || '').trim(),
          name: String(row.display_name || '').trim() || String(row.email || '').trim(),
          role: String(row.role || '').trim()
        });
      }
      if (row.month_start) {
        const key = `${id}|${row.month_start}`;
        salesByUserMonth.set(key, {
          sales: Number(row.total_sales || 0),
          closed: Number(row.closed_count || 0)
        });
      }
    }
    const users = [...usersById.values()];

    // Comisiones de UN mes con las reglas por rol (mismo criterio que Pagos).
    const round2 = (v) => Math.round(v * 100) / 100;
    const computeMonth = (key) => {
      const get = (id) => salesByUserMonth.get(`${id}|${key}`) || { sales: 0, closed: 0 };
      const sellers = users.filter((u) => isSeller(u.role))
        .map((u) => ({ id: u.user_id, sales: get(u.user_id).sales }))
        .sort((a, b) => (b.sales - a.sales) || (a.id - b.id));
      const topSellerId = sellers.length > 0 && sellers[0].sales > 0 ? sellers[0].id : null;
      const sellersTotal = sellers.reduce((sum, s) => sum + s.sales, 0);
      const perUser = new Map();
      let teamSales = 0;
      let teamClosed = 0;
      let teamCommission = 0;
      for (const u of users) {
        const { sales, closed } = get(u.user_id);
        let commission = 0;
        let rule = 'Sin comisión configurada';
        if (isSeller(u.role)) {
          const isTop = topSellerId === u.user_id;
          commission = sales * (isTop ? topPercent : regularPercent) / 100;
          rule = isTop ? `Mejor en ventas (${topPercent}%)` : `Asesor de ventas (${regularPercent}%)`;
        } else if (isLider(u.role)) {
          commission = (sellersTotal + sales) * liderPercent / 100;
          rule = `Líder de ventas (${liderPercent}% equipo + propias)`;
        }
        perUser.set(u.user_id, {
          sales: round2(sales),
          closed,
          commission: round2(commission),
          rule,
          is_top: topSellerId === u.user_id,
          is_lider: isLider(u.role)
        });
        teamSales += sales;
        teamClosed += closed;
        teamCommission += commission;
      }
      return {
        perUser,
        topSellerId,
        team: { sales: round2(teamSales), closed: teamClosed, commission: round2(teamCommission) }
      };
    };

    // Meses de la ventana en orden cronológico.
    const monthKeys = [];
    for (let i = HISTORY_MONTHS - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(yearNum, monthNum - 1 - i, 1));
      monthKeys.push({
        key: monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1),
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        label: `${MONTHS_ES[d.getUTCMonth()]}${d.getUTCFullYear() !== yearNum ? ` ${String(d.getUTCFullYear()).slice(2)}` : ''}`
      });
    }
    const byMonth = new Map(monthKeys.map((m) => [m.key, computeMonth(m.key)]));
    const currentKey = monthKey(yearNum, monthNum);
    const current = byMonth.get(currentKey);

    const myId = Number(req.user.id);
    const meMonth = current.perUser.get(myId) || null;

    // Historia para comparar: totales del equipo (líder) o propios (vendedor).
    const history = monthKeys.map((m) => {
      const data = byMonth.get(m.key);
      const mine = data.perUser.get(myId) || { sales: 0, closed: 0, commission: 0 };
      return {
        year: m.year,
        month: m.month,
        label: m.label,
        team_sales: data.team.sales,
        team_commission: data.team.commission,
        team_closed: data.team.closed,
        my_sales: mine.sales,
        my_commission: mine.commission,
        my_closed: mine.closed
      };
    });

    const topUser = current.topSellerId ? usersById.get(current.topSellerId) : null;
    const response = {
      scope: canTeam ? 'team' : 'own',
      month: monthNum,
      year: yearNum,
      settings: { top_percent: topPercent, regular_percent: regularPercent, lider_percent: liderPercent },
      me: meMonth ? { ...meMonth, name: usersById.get(myId)?.name || '' } : null,
      history,
      team: null,
      rows: null
    };

    if (canTeam) {
      response.team = {
        sales: current.team.sales,
        closed: current.team.closed,
        commission: current.team.commission,
        active_sellers: users.filter((u) => isSeller(u.role) || isLider(u.role)).length,
        top_seller: topUser
          ? { name: topUser.name, sales: current.perUser.get(topUser.user_id)?.sales || 0 }
          : null
      };
      // Posición por VENTAS del mes (no por comisión pagada).
      response.rows = users
        .map((u) => {
          const data = current.perUser.get(u.user_id);
          return {
            user_id: u.user_id,
            name: u.name,
            role_label: data.is_lider ? 'Líder de ventas' : (data.is_top ? 'Mejor en ventas' : 'Asesor de ventas'),
            closed: data.closed,
            sales: data.sales,
            commission: data.commission,
            rule: data.rule,
            is_top: data.is_top,
            is_lider: data.is_lider,
            monthly: monthKeys.map((m) => ({
              label: m.label,
              sales: byMonth.get(m.key).perUser.get(u.user_id)?.sales || 0
            }))
          };
        })
        .sort((a, b) => (b.sales - a.sales) || (a.user_id - b.user_id));
    }

    res.json(response);
  } catch (err) {
    console.error('Ventas comisiones endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener el resumen de comisiones' });
  }
});

module.exports = router;
