// Paneles por área: flags de activación (admin), metas de ventas y los
// tableros de área. Fase 1: Ventas (KPIs, embudo, seguimientos, alertas y —
// para líderes — rendimiento por vendedor). Fase 2: Marketing (ventas por
// destino, agenda, resumen de campañas/lives/promos y el mismo CRM).
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { ROLE_KEYS, canAccessPanel, normalizeRole } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

const FLAG_KEYS = ['panel_ventas', 'panel_marketing', 'panel_produccion', 'panel_almacen'];
const SOLD = "('Pagado', 'Embalado', 'Enviado')";
const BO_TODAY = "(NOW() AT TIME ZONE 'America/La_Paz')::date";
const BO_DATE = (col) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/La_Paz')::date`;
const BO_MONTH = "date_trunc('month', NOW() AT TIME ZONE 'America/La_Paz')::date";

// ─── Flags ──────────────────────────────────────────────────────────────────

const loadFlags = async () => {
  const result = await pool.query('SELECT key, enabled FROM feature_flags');
  const flags = {};
  for (const key of FLAG_KEYS) flags[key] = false;
  for (const row of result.rows) flags[row.key] = Boolean(row.enabled);
  return flags;
};

// Todos los usuarios autenticados: el frontend decide qué Inicio y qué
// entradas de menú mostrar.
router.get('/api/features', authenticateToken, async (req, res) => {
  try {
    res.json({ features: await loadFlags() });
  } catch (err) {
    console.error('Error loading features:', err);
    res.status(500).json({ error: 'No se pudieron cargar las funciones' });
  }
});

router.patch('/api/admin/features', authenticateToken, requireRole(['admin']), async (req, res) => {
  const key = String(req.body?.key || '').trim();
  if (!FLAG_KEYS.includes(key)) return res.status(400).json({ error: 'Función desconocida' });
  const enabled = Boolean(req.body?.enabled);
  try {
    await pool.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET enabled = $2, updated_at = NOW()`,
      [key, enabled]
    );
    res.json({ message: enabled ? 'Panel activado' : 'Panel desactivado', features: await loadFlags() });
  } catch (err) {
    console.error('Error updating feature flag:', err);
    res.status(500).json({ error: 'No se pudo actualizar la función' });
  }
});

// ─── Metas de ventas ────────────────────────────────────────────────────────

const buildGoalsRow = (row) => ({
  monthly_target_bs: Number(row.monthly_target_bs),
  monthly_units_min: Number(row.monthly_units_min),
  monthly_units_expected: Number(row.monthly_units_expected),
  monthly_units_high: Number(row.monthly_units_high),
  monthly_new_customers: Number(row.monthly_new_customers),
  daily_followups: Number(row.daily_followups)
});

const loadGoals = async () => {
  const result = await pool.query('SELECT * FROM sales_goals WHERE id = 1');
  return result.rowCount > 0 ? buildGoalsRow(result.rows[0]) : null;
};

router.get('/api/admin/sales-goals', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    res.json({ goals: await loadGoals() });
  } catch (err) {
    console.error('Error loading sales goals:', err);
    res.status(500).json({ error: 'No se pudieron cargar las metas' });
  }
});

router.patch('/api/admin/sales-goals', authenticateToken, requireRole(['admin']), async (req, res) => {
  const FIELDS = {
    monthly_target_bs: { min: 0, max: 10000000 },
    monthly_units_min: { min: 0, max: 100000 },
    monthly_units_expected: { min: 0, max: 100000 },
    monthly_units_high: { min: 0, max: 100000 },
    monthly_new_customers: { min: 0, max: 100000 },
    daily_followups: { min: 0, max: 10000 }
  };
  const sets = [];
  const values = [];
  for (const [field, range] of Object.entries(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) continue;
    const value = Number(req.body[field]);
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      return res.status(400).json({ error: `Valor inválido para ${field}` });
    }
    values.push(value);
    sets.push(`${field} = $${values.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  try {
    await pool.query(`UPDATE sales_goals SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1`, values);
    res.json({ message: 'Metas actualizadas', goals: await loadGoals() });
  } catch (err) {
    console.error('Error updating sales goals:', err);
    res.status(500).json({ error: 'No se pudieron actualizar las metas' });
  }
});

// ─── Tablero de Ventas ──────────────────────────────────────────────────────

router.get('/api/ventas/dashboard', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const role = userContext.role;
    const isAdmin = normalizeRole(role || '') === ROLE_KEYS.admin;
    const can = (key) => isAdmin || canAccessPanel(userContext.panel_access, role, key);
    if (!can('cotizar') && !can('historial_global') && !can('historial_individual')) {
      return res.status(403).json({ error: 'No tienes acceso al panel de ventas' });
    }
    // Líder: ve al equipo completo y el desglose por vendedor.
    const isLeader = isAdmin || can('historial_global');

    const quoteParams = isLeader ? [] : [req.user.id];
    const customerScope = isLeader ? '' : 'AND (c.assigned_user_id = $1 OR c.created_by = $1)';

    // Los tiles muestran primero lo personal y al final lo global del área,
    // así que las cifras de cotizaciones se calculan en ambos alcances.
    const SALES_SELECT = (scopeSql) => `SELECT
           COUNT(*) FILTER (WHERE ${BO_DATE('q.created_at')} = ${BO_TODAY})::int AS quotes_today,
           COUNT(*) FILTER (WHERE ${BO_DATE('q.created_at')} >= ${BO_TODAY} - 6)::int AS quotes_week,
           COUNT(*) FILTER (WHERE ${BO_DATE('q.created_at')} >= ${BO_MONTH})::int AS quotes_month,
           COUNT(*) FILTER (WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} = ${BO_TODAY})::int AS sold_today,
           COALESCE(SUM(q.total) FILTER (WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} = ${BO_TODAY}), 0) AS sold_today_bs,
           COUNT(*) FILTER (WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} >= ${BO_TODAY} - 6)::int AS sold_week,
           COALESCE(SUM(q.total) FILTER (WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} >= ${BO_TODAY} - 6), 0) AS sold_week_bs,
           COUNT(*) FILTER (WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} >= ${BO_MONTH})::int AS sold_month,
           COALESCE(SUM(q.total) FILTER (WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} >= ${BO_MONTH}), 0) AS sold_month_bs,
           COUNT(*) FILTER (WHERE q.status = 'Cotizado')::int AS pending_count,
           COALESCE(SUM(q.total) FILTER (WHERE q.status = 'Cotizado'), 0) AS pending_bs,
           COUNT(*) FILTER (WHERE q.status = 'Cotizado' AND ${BO_DATE('q.created_at')} <= ${BO_TODAY} - 3)::int AS pending_stale
         FROM quotes q
         WHERE TRUE ${scopeSql}`;

    const jobs = {
      goals: loadGoals(),
      sales: pool.query(SALES_SELECT('AND q.user_id = $1'), [req.user.id]),
      salesTeam: pool.query(SALES_SELECT('')),
      teamNew: pool.query(
        `SELECT COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS nuevos_mes
         FROM customers c`
      ),
      funnel: pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'contactado')::int AS contactado,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'cotizado')::int AS cotizado,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'negociando')::int AS negociando,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'cliente'
             AND (c.stage_changed_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS ganados_mes,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'perdido'
             AND (c.stage_changed_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS perdidos_mes,
           COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS nuevos_mes,
           COUNT(*) FILTER (WHERE c.follow_up_at IS NOT NULL AND c.follow_up_at = ${BO_TODAY})::int AS seg_hoy,
           COUNT(*) FILTER (WHERE c.follow_up_at IS NOT NULL AND c.follow_up_at < ${BO_TODAY})::int AS seg_vencidos,
           COUNT(*) FILTER (WHERE c.pipeline_stage IN ('contactado', 'cotizado', 'negociando')
             AND c.follow_up_at IS NULL)::int AS sin_siguiente_paso,
           COUNT(*) FILTER (WHERE c.pipeline_stage IN ('cotizado', 'negociando')
             AND c.updated_at < NOW() - INTERVAL '7 days')::int AS sin_contacto_7d
         FROM customers c
         WHERE TRUE ${customerScope}`,
        quoteParams
      ),
      followUps: pool.query(
        `SELECT c.id, c.name, c.phone, c.follow_up_at, c.follow_up_note, c.pipeline_stage
         FROM customers c
         WHERE c.follow_up_at IS NOT NULL
           AND c.follow_up_at <= ${BO_TODAY} + 7
           AND c.pipeline_stage NOT IN ('perdido', 'inactivo')
           ${customerScope}
         ORDER BY c.follow_up_at ASC, c.updated_at DESC
         LIMIT 8`,
        quoteParams
      )
    };

    if (isLeader) {
      jobs.perVendor = pool.query(
        `SELECT COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1), q.vendor, '—') AS vendor,
                COUNT(*)::int AS quotes_month,
                COUNT(*) FILTER (WHERE q.status IN ${SOLD})::int AS sold_month,
                COALESCE(SUM(q.total) FILTER (WHERE q.status IN ${SOLD}), 0) AS sold_month_bs
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE ${BO_DATE('q.created_at')} >= ${BO_MONTH}
         GROUP BY 1
         ORDER BY sold_month_bs DESC, quotes_month DESC
         LIMIT 12`
      );
    }

    const keys = Object.keys(jobs);
    const results = await Promise.all(keys.map((key) => jobs[key]));
    const data = {};
    keys.forEach((key, i) => { data[key] = results[i]; });

    const sales = data.sales.rows[0];
    const salesTeam = data.salesTeam.rows[0];
    const funnel = data.funnel.rows[0];
    const goals = data.goals;
    const soldMonth = Number(sales.sold_month);
    const goalUnits = goals ? goals.monthly_units_expected : 0;

    res.json({
      scope: isLeader ? 'team' : 'own',
      goals,
      // Cifras globales del área: van al final de la fila de tiles.
      team: {
        quotes_month: Number(salesTeam.quotes_month),
        sold_month: Number(salesTeam.sold_month),
        sold_month_bs: Number(salesTeam.sold_month_bs),
        pending_count: Number(salesTeam.pending_count),
        pending_bs: Number(salesTeam.pending_bs),
        nuevos_mes: Number(data.teamNew.rows[0].nuevos_mes)
      },
      sales: {
        quotes_today: Number(sales.quotes_today),
        quotes_week: Number(sales.quotes_week),
        quotes_month: Number(sales.quotes_month),
        sold_today: Number(sales.sold_today),
        sold_today_bs: Number(sales.sold_today_bs),
        sold_week: Number(sales.sold_week),
        sold_week_bs: Number(sales.sold_week_bs),
        sold_month: soldMonth,
        sold_month_bs: Number(sales.sold_month_bs),
        pending_count: Number(sales.pending_count),
        pending_bs: Number(sales.pending_bs),
        pending_stale: Number(sales.pending_stale),
        goal_units_pct: goalUnits > 0 ? Math.round((soldMonth / goalUnits) * 100) : null,
        goal_bs_pct: goals && Number(goals.monthly_target_bs) > 0
          ? Math.round((Number(sales.sold_month_bs) / Number(goals.monthly_target_bs)) * 100)
          : null
      },
      funnel: {
        contactado: Number(funnel.contactado),
        cotizado: Number(funnel.cotizado),
        negociando: Number(funnel.negociando),
        ganados_mes: Number(funnel.ganados_mes),
        perdidos_mes: Number(funnel.perdidos_mes),
        nuevos_mes: Number(funnel.nuevos_mes)
      },
      seguimientos: {
        hoy: Number(funnel.seg_hoy),
        vencidos: Number(funnel.seg_vencidos),
        proximos: data.followUps.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          phone: row.phone,
          follow_up_at: row.follow_up_at instanceof Date
            ? row.follow_up_at.toISOString().slice(0, 10)
            : String(row.follow_up_at).slice(0, 10),
          follow_up_note: row.follow_up_note || null,
          pipeline_stage: row.pipeline_stage
        }))
      },
      alerts: {
        seguimientos_vencidos: Number(funnel.seg_vencidos),
        // Para líderes la alerta cubre al equipo; para vendedores, lo suyo.
        cotizaciones_sin_respuesta: Number(isLeader ? salesTeam.pending_stale : sales.pending_stale),
        sin_siguiente_paso: Number(funnel.sin_siguiente_paso),
        sin_contacto_7d: Number(funnel.sin_contacto_7d)
      },
      per_vendor: isLeader
        ? data.perVendor.rows.map((row) => ({
          vendor: row.vendor,
          quotes_month: Number(row.quotes_month),
          sold_month: Number(row.sold_month),
          sold_month_bs: Number(row.sold_month_bs),
          conversion_pct: Number(row.quotes_month) > 0
            ? Math.round((Number(row.sold_month) / Number(row.quotes_month)) * 100)
            : null,
          goal_pct: goalUnits > 0 ? Math.round((Number(row.sold_month) / goalUnits) * 100) : null
        }))
        : null
    });
  } catch (err) {
    console.error('Error loading ventas dashboard:', err);
    res.status(500).json({ error: 'No se pudo cargar el panel de ventas' });
  }
});

// ─── Tablero de Marketing ───────────────────────────────────────────────────

router.get('/api/marketing/dashboard', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const role = userContext.role;
    const isAdmin = normalizeRole(role || '') === ROLE_KEYS.admin;
    const can = (key) => isAdmin || canAccessPanel(userContext.panel_access, role, key);
    const marketingKeys = ['marketing_calendario', 'marketing_combos', 'marketing_inversion', 'marketing_promos'];
    if (!marketingKeys.some((key) => can(key))) {
      return res.status(403).json({ error: 'No tienes acceso al panel de marketing' });
    }

    const jobs = {
      // Destinos del mes: mismo rollup departamento → ciudad de Estadísticas,
      // acotado al mes en curso (lo que Marketing necesita para orientar pauta).
      geo: pool.query(
        `SELECT
           COALESCE(NULLIF(TRIM(q.department), ''), 'Sin clasificar') AS department,
           COALESCE(NULLIF(TRIM(q.ciudad), ''), NULLIF(TRIM(q.provincia), ''), 'Sin detalle') AS ciudad,
           COUNT(*)::int AS order_count,
           COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.status IN ${SOLD} AND ${BO_DATE('q.created_at')} >= ${BO_MONTH}
         GROUP BY 1, 2`
      ),
      agendaCampaigns: pool.query(
        `SELECT id, name, kind, status, start_date::text AS start_date, end_date::text AS end_date,
                live_time::text AS live_time
         FROM marketing_campaigns
         WHERE status <> 'finalizada' AND end_date >= ${BO_TODAY} AND start_date <= ${BO_TODAY} + 14
         ORDER BY start_date ASC
         LIMIT 10`
      ),
      agendaEvents: pool.query(
        `SELECT id, title, event_date::text AS event_date, event_time::text AS event_time
         FROM marketing_events
         WHERE event_date BETWEEN ${BO_TODAY} AND ${BO_TODAY} + 14
         ORDER BY event_date ASC, event_time ASC NULLS LAST
         LIMIT 10`
      ),
      campaignStats: pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'anunciada' AND start_date <= ${BO_TODAY} AND end_date >= ${BO_TODAY})::int AS activas,
           COUNT(*) FILTER (WHERE kind = 'live' AND status = 'anunciada' AND end_date >= ${BO_TODAY})::int AS lives_pendientes,
           COUNT(*) FILTER (WHERE status = 'borrador')::int AS borradores,
           COUNT(*) FILTER (WHERE status = 'finalizada' AND end_date >= ${BO_MONTH})::int AS finalizadas_mes
         FROM marketing_campaigns`
      ),
      nextLive: pool.query(
        `SELECT id, name, start_date::text AS start_date, live_time::text AS live_time
         FROM marketing_campaigns
         WHERE kind = 'live' AND status = 'anunciada' AND start_date >= ${BO_TODAY}
         ORDER BY start_date ASC, live_time ASC NULLS LAST
         LIMIT 1`
      ),
      inversion: pool.query(
        `SELECT COALESCE(SUM(cc.amount), 0) AS total_mes
         FROM campaign_costs cc
         WHERE (cc.created_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH}`
      ),
      promoTools: pool.query(
        `SELECT COUNT(*) FILTER (WHERE active)::int AS activas FROM promo_tools`
      ),
      promoCodes: pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE (pc.created_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS emitidos_mes,
           COUNT(*) FILTER (WHERE pc.redeemed_at IS NOT NULL
             AND (pc.redeemed_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS canjeados_mes
         FROM promo_codes pc`
      ),
      // El mismo embudo y seguimientos del Panel de Ventas, en alcance global:
      // Marketing lee el CRM completo, igual que un líder de ventas.
      funnel: pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'contactado')::int AS contactado,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'cotizado')::int AS cotizado,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'negociando')::int AS negociando,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'cliente'
             AND (c.stage_changed_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS ganados_mes,
           COUNT(*) FILTER (WHERE c.pipeline_stage = 'perdido'
             AND (c.stage_changed_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS perdidos_mes,
           COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'America/La_Paz') >= ${BO_MONTH})::int AS nuevos_mes,
           COUNT(*) FILTER (WHERE c.follow_up_at IS NOT NULL AND c.follow_up_at = ${BO_TODAY})::int AS seg_hoy,
           COUNT(*) FILTER (WHERE c.follow_up_at IS NOT NULL AND c.follow_up_at < ${BO_TODAY})::int AS seg_vencidos
         FROM customers c`
      ),
      followUps: pool.query(
        `SELECT c.id, c.name, c.phone, c.follow_up_at, c.follow_up_note, c.pipeline_stage
         FROM customers c
         WHERE c.follow_up_at IS NOT NULL
           AND c.follow_up_at <= ${BO_TODAY} + 7
           AND c.pipeline_stage NOT IN ('perdido', 'inactivo')
         ORDER BY c.follow_up_at ASC, c.updated_at DESC
         LIMIT 8`
      )
    };

    const keys = Object.keys(jobs);
    const results = await Promise.all(keys.map((key) => jobs[key]));
    const data = {};
    keys.forEach((key, i) => { data[key] = results[i]; });

    // Rollup destinos: idéntico al de Estadísticas (adminStats topLocations).
    const locByDept = new Map();
    for (const row of data.geo.rows) {
      if (!locByDept.has(row.department)) {
        locByDept.set(row.department, { location: row.department, order_count: 0, total_sales: 0, cities: [] });
      }
      const dept = locByDept.get(row.department);
      dept.order_count += Number(row.order_count || 0);
      dept.total_sales += Number(row.total_sales || 0);
      dept.cities.push({ ciudad: row.ciudad, order_count: Number(row.order_count || 0), total_sales: Number(row.total_sales || 0) });
    }
    const topLocations = [...locByDept.values()]
      .sort((a, b) => b.total_sales - a.total_sales)
      .map((dept) => ({ ...dept, cities: dept.cities.sort((a, b) => b.total_sales - a.total_sales).slice(0, 5) }));
    const salesByDepartment = [...locByDept.values()].map((dept) => ({
      department: dept.location,
      order_count: dept.order_count,
      total_sales: dept.total_sales
    }));

    // Agenda unificada: campañas/lives + eventos propios, en orden cronológico.
    const dateOnly = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));
    const agenda = [
      ...data.agendaCampaigns.rows.map((row) => ({
        type: row.kind === 'live' ? 'live' : 'campana',
        id: Number(row.id),
        title: row.name,
        date: dateOnly(row.start_date),
        end_date: dateOnly(row.end_date),
        time: row.live_time ? String(row.live_time).slice(0, 5) : null,
        status: row.status
      })),
      ...data.agendaEvents.rows.map((row) => ({
        type: 'evento',
        id: Number(row.id),
        title: row.title,
        date: dateOnly(row.event_date),
        end_date: null,
        time: row.event_time ? String(row.event_time).slice(0, 5) : null,
        status: null
      }))
    ].sort((a, b) => (a.date === b.date ? String(a.time || '99').localeCompare(String(b.time || '99')) : a.date.localeCompare(b.date)));

    const campaignStats = data.campaignStats.rows[0];
    const funnel = data.funnel.rows[0];
    const nextLiveRow = data.nextLive.rows[0] || null;

    res.json({
      geo: { topLocations, salesByDepartment },
      agenda,
      campaigns: {
        activas: Number(campaignStats.activas),
        lives_pendientes: Number(campaignStats.lives_pendientes),
        borradores: Number(campaignStats.borradores),
        finalizadas_mes: Number(campaignStats.finalizadas_mes),
        proximo_live: nextLiveRow
          ? {
            id: Number(nextLiveRow.id),
            name: nextLiveRow.name,
            start_date: dateOnly(nextLiveRow.start_date),
            live_time: nextLiveRow.live_time ? String(nextLiveRow.live_time).slice(0, 5) : null
          }
          : null,
        inversion_mes_bs: Number(data.inversion.rows[0].total_mes)
      },
      promos: {
        herramientas_activas: Number(data.promoTools.rows[0].activas),
        cupones_emitidos_mes: Number(data.promoCodes.rows[0].emitidos_mes),
        cupones_canjeados_mes: Number(data.promoCodes.rows[0].canjeados_mes)
      },
      funnel: {
        contactado: Number(funnel.contactado),
        cotizado: Number(funnel.cotizado),
        negociando: Number(funnel.negociando),
        ganados_mes: Number(funnel.ganados_mes),
        perdidos_mes: Number(funnel.perdidos_mes),
        nuevos_mes: Number(funnel.nuevos_mes)
      },
      seguimientos: {
        hoy: Number(funnel.seg_hoy),
        vencidos: Number(funnel.seg_vencidos),
        proximos: data.followUps.rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          phone: row.phone,
          follow_up_at: row.follow_up_at instanceof Date
            ? row.follow_up_at.toISOString().slice(0, 10)
            : String(row.follow_up_at).slice(0, 10),
          follow_up_note: row.follow_up_note || null,
          pipeline_stage: row.pipeline_stage
        }))
      }
    });
  } catch (err) {
    console.error('Error loading marketing dashboard:', err);
    res.status(500).json({ error: 'No se pudo cargar el panel de marketing' });
  }
});

module.exports = router;
