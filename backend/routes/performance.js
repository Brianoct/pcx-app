const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { loadCommissionSettings } = require('../lib/commission');
const { computeTeamCommissions } = require('../lib/commissionTeam');
const { resolveInventoryScopeByCity } = require('../lib/inventory');
const { ROLE_KEYS, normalizeRole, sanitizePanelAccess } = require('../lib/rbac');
const { COMPLETED_STATUSES, buildDateFilter } = require('../lib/reporting');
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
  const isMicrofabricaLider = userRoleNormalized === ROLE_KEYS.microfabricaLider;
  const isMicrofabrica = userRoleNormalized === ROLE_KEYS.microfabrica;

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
    const rateMicrofabrica = Number(commissionSettings.microfabrica_percent || 0) / 100;
    const rateMicrofabricaLider = Number(commissionSettings.microfabrica_lider_percent || 0) / 100;
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

    if (isMicrofabricaLider) {
      return percentOfAllSales(rateMicrofabricaLider, Number(commissionSettings.microfabrica_lider_percent || 0));
    }
    if (isMicrofabrica) {
      return percentOfAllSales(rateMicrofabrica, Number(commissionSettings.microfabrica_percent || 0));
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

module.exports = router;
