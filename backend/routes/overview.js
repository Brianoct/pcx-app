const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, canAccessPanel, normalizeRole } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// One round trip for the Inicio page: every number the user is allowed to
// see, in a single payload. Sections the user can't access come back null so
// the client simply doesn't render those tiles.
router.get('/api/dashboard/overview', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = userContext.panel_access;
    const role = userContext.role;
    const isAdmin = normalizeRole(role || '') === ROLE_KEYS.admin;
    const can = (key) => isAdmin || canAccessPanel(access, role, key);

    const seesTeamQuotes = can('historial_global') || can('pedidos_global');
    const canQuotes = can('cotizar') || can('historial_global') || can('historial_individual');
    const canPedidos = can('pedidos_global') || can('pedidos_individual');
    const canInventory = can('inventario_global') || can('inventario_individual');
    const canProduction = can('produccion_kanban');
    const canCrm = can('cotizar') || can('historial_global') || can('pedidos_global');

    const jobs = {};

    if (canQuotes) {
      jobs.quotesToday = pool.query(
        `SELECT COUNT(*)::int AS quotes_count,
                COALESCE(SUM(total), 0) AS quotes_total,
                COUNT(*) FILTER (WHERE status IN ('Pagado', 'Embalado', 'Enviado'))::int AS sold_count
         FROM quotes
         WHERE created_at::date = CURRENT_DATE ${seesTeamQuotes ? '' : 'AND user_id = $1'}`,
        seesTeamQuotes ? [] : [req.user.id]
      );
    }
    if (canPedidos) {
      jobs.pipeline = pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'Confirmado')::int AS confirmado,
           COUNT(*) FILTER (WHERE status = 'Pagado')::int AS pagado,
           COUNT(*) FILTER (WHERE status = 'Embalado')::int AS embalado,
           COUNT(*) FILTER (WHERE status = 'Enviado' AND created_at::date = CURRENT_DATE)::int AS enviado_hoy
         FROM quotes`
      );
      jobs.toPrepare = pool.query(
        `SELECT id, customer_name, store_location, total, created_at
         FROM quotes WHERE status = 'Pagado'
         ORDER BY created_at ASC LIMIT 5`
      );
    }
    if (canInventory) {
      jobs.stockAlerts = pool.query(
        `SELECT COUNT(*)::int AS alerts FROM products
         WHERE is_active = TRUE AND (
           (min_stock_cochabamba > 0 AND stock_cochabamba < min_stock_cochabamba) OR
           (min_stock_santacruz > 0 AND stock_santacruz < min_stock_santacruz) OR
           (min_stock_lima > 0 AND stock_lima < min_stock_lima)
         )`
      );
    }
    if (canProduction) {
      jobs.production = pool.query(
        `SELECT COUNT(*)::int AS active_cards,
                COUNT(*) FILTER (WHERE stage = 'recepcion')::int AS por_recibir
         FROM production_kanban_cards WHERE is_active = TRUE`
      );
    }
    if (canCrm) {
      jobs.crmDue = pool.query(
        `SELECT COUNT(*)::int AS due FROM customers
         WHERE follow_up_at IS NOT NULL AND follow_up_at <= CURRENT_DATE`
      );
      jobs.crmDueList = pool.query(
        `SELECT id, name, phone, follow_up_at, follow_up_note FROM customers
         WHERE follow_up_at IS NOT NULL AND follow_up_at <= CURRENT_DATE
         ORDER BY follow_up_at ASC LIMIT 4`
      );
    }
    jobs.myDay = pool.query(
      `SELECT COUNT(*)::int AS tasks, COUNT(*) FILTER (WHERE is_done)::int AS done
       FROM day_plan_tasks WHERE user_id = $1 AND task_date = CURRENT_DATE`,
      [req.user.id]
    );
    jobs.teamDay = pool.query(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS name,
              COUNT(t.id)::int AS tasks, COUNT(t.id) FILTER (WHERE t.is_done)::int AS done
       FROM day_plan_tasks t JOIN users u ON u.id = t.user_id
       WHERE t.task_date = CURRENT_DATE
       GROUP BY u.id, u.display_name, u.email
       ORDER BY name`
    );

    const keys = Object.keys(jobs);
    const results = await Promise.all(keys.map((key) => jobs[key]));
    const data = {};
    keys.forEach((key, i) => { data[key] = results[i]; });

    res.json({
      quotes_today: data.quotesToday ? {
        count: Number(data.quotesToday.rows[0].quotes_count),
        total: Number(data.quotesToday.rows[0].quotes_total),
        sold_count: Number(data.quotesToday.rows[0].sold_count),
        scope: seesTeamQuotes ? 'team' : 'own'
      } : null,
      pipeline: data.pipeline ? data.pipeline.rows[0] : null,
      to_prepare: data.toPrepare ? data.toPrepare.rows.map((row) => ({
        id: Number(row.id),
        customer_name: row.customer_name,
        store_location: row.store_location,
        total: Number(row.total)
      })) : null,
      stock_alerts: data.stockAlerts ? Number(data.stockAlerts.rows[0].alerts) : null,
      production: data.production ? {
        active_cards: Number(data.production.rows[0].active_cards),
        por_recibir: Number(data.production.rows[0].por_recibir)
      } : null,
      crm_due: data.crmDue ? Number(data.crmDue.rows[0].due) : null,
      crm_due_list: data.crmDueList ? data.crmDueList.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        phone: row.phone,
        note: row.follow_up_note || null
      })) : null,
      my_day: {
        tasks: Number(data.myDay.rows[0].tasks),
        done: Number(data.myDay.rows[0].done)
      },
      team_day: data.teamDay.rows.map((row) => ({
        user_id: Number(row.id),
        name: row.name,
        tasks: Number(row.tasks),
        done: Number(row.done)
      }))
    });
  } catch (err) {
    console.error('Error loading dashboard overview:', err);
    res.status(500).json({ error: 'No se pudo cargar el resumen' });
  }
});

module.exports = router;
