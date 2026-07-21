const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');

const router = express.Router();

const CAMPAIGN_AREAS = ['ventas', 'almacen', 'produccion', 'marketing', 'admin'];
const EDIT_ROLES = ['Marketing', 'Marketing Lider', 'Admin'];

// Which campaign area a user's role belongs to (which checkboxes they may tick).
// Admin can tick any area — they're the fallback for everything.
const areaForRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  if (role === ROLE_KEYS.admin) return 'admin';
  if (role === ROLE_KEYS.ventas || role === ROLE_KEYS.ventasLider || role === 'sales' || role === 'vendedor') return 'ventas';
  if (role === ROLE_KEYS.almacen || role === ROLE_KEYS.almacenLider) return 'almacen';
  if (role === ROLE_KEYS.produccion) return 'produccion';
  if (role === ROLE_KEYS.marketing || role === ROLE_KEYS.marketingLider) return 'marketing';
  return null;
};

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

const loadCampaigns = async () => {
  const campaignsRes = await pool.query(
    `SELECT c.id, c.name, c.objective, c.start_date::text AS start_date, c.end_date::text AS end_date,
            c.status, c.kind, c.live_time::text AS live_time, c.created_at,
            u.display_name AS created_by_name, u.email AS created_by_email
     FROM marketing_campaigns c
     LEFT JOIN users u ON u.id = c.created_by
     ORDER BY c.start_date DESC, c.id DESC`
  );
  const tasksRes = await pool.query(
    `SELECT t.id, t.campaign_id, t.area, t.title, t.position, t.done, t.done_at,
            du.display_name AS done_by_name, du.email AS done_by_email
     FROM marketing_campaign_tasks t
     LEFT JOIN users du ON du.id = t.done_by
     ORDER BY t.campaign_id, t.area, t.position, t.id`
  );
  const tasksByCampaign = new Map();
  for (const task of tasksRes.rows) {
    const key = Number(task.campaign_id);
    if (!tasksByCampaign.has(key)) tasksByCampaign.set(key, []);
    tasksByCampaign.get(key).push({
      id: Number(task.id),
      area: task.area,
      title: task.title,
      position: Number(task.position || 0),
      done: Boolean(task.done),
      done_at: task.done_at,
      done_by: String(task.done_by_name || task.done_by_email || '').trim() || null
    });
  }
  return campaignsRes.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    objective: row.objective,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    kind: row.kind || 'campana',
    live_time: row.live_time ? String(row.live_time).slice(0, 5) : null,
    expected_return: row.expected_return === null || row.expected_return === undefined ? null : Number(row.expected_return),
    created_by: String(row.created_by_name || row.created_by_email || '').trim() || null,
    created_at: row.created_at,
    tasks: tasksByCampaign.get(Number(row.id)) || []
  }));
};

const sanitizeTasks = (rawTasks) => {
  if (!Array.isArray(rawTasks)) return { tasks: [] };
  const tasks = [];
  for (const raw of rawTasks) {
    const area = String(raw?.area || '').trim().toLowerCase();
    const title = String(raw?.title || '').trim();
    if (!title) continue;
    if (!CAMPAIGN_AREAS.includes(area)) return { error: `Área inválida: ${raw?.area}` };
    if (title.length > 300) return { error: 'Cada responsabilidad debe tener máximo 300 caracteres' };
    const id = Number.parseInt(raw?.id, 10);
    tasks.push({ id: Number.isInteger(id) && id > 0 ? id : null, area, title });
  }
  return { tasks };
};

const validateCampaignBody = (body = {}) => {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'El nombre de la campaña es obligatorio' };
  if (name.length > 120) return { error: 'Nombre máximo 120 caracteres' };
  const objective = String(body.objective || '').trim().slice(0, 1000);
  if (!isValidDate(body.start_date) || !isValidDate(body.end_date)) {
    return { error: 'Fechas inválidas (AAAA-MM-DD)' };
  }
  if (String(body.end_date) < String(body.start_date)) {
    return { error: 'La fecha de fin no puede ser anterior al inicio' };
  }
  const kind = String(body.kind || 'campana').trim().toLowerCase();
  if (!['campana', 'live'].includes(kind)) return { error: 'Tipo inválido' };
  let liveTime = null;
  if (body.live_time !== undefined && body.live_time !== null && String(body.live_time).trim() !== '') {
    liveTime = String(body.live_time).trim().slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(liveTime)) return { error: 'Hora inválida (HH:MM)' };
  }
  let expectedReturn = null;
  if (body.expected_return !== undefined && body.expected_return !== null && String(body.expected_return).trim() !== '') {
    expectedReturn = Number(body.expected_return);
    if (!Number.isFinite(expectedReturn) || expectedReturn < 0) return { error: 'Retorno esperado inválido' };
  }
  const { tasks, error } = sanitizeTasks(body.tasks);
  if (error) return { error };
  return { name, objective, start_date: body.start_date, end_date: body.end_date, kind, live_time: liveTime, expected_return: expectedReturn, tasks };
};

// Everyone logged in can see campaigns — the whole point is company-wide
// visibility of each area's responsibilities.
router.get('/api/campaigns', authenticateToken, async (_req, res) => {
  try {
    res.json({ campaigns: await loadCampaigns(), areas: CAMPAIGN_AREAS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar las campañas' });
  }
});

router.post('/api/campaigns', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  const parsed = validateCampaignBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const campaignRes = await client.query(
      `INSERT INTO marketing_campaigns (name, objective, start_date, end_date, status, kind, live_time, expected_return, created_by)
       VALUES ($1, $2, $3, $4, 'borrador', $5, $6, $7, $8)
       RETURNING id`,
      [parsed.name, parsed.objective, parsed.start_date, parsed.end_date, parsed.kind, parsed.live_time, parsed.expected_return, req.user.id]
    );
    const campaignId = campaignRes.rows[0].id;
    for (let i = 0; i < parsed.tasks.length; i++) {
      await client.query(
        `INSERT INTO marketing_campaign_tasks (campaign_id, area, title, position)
         VALUES ($1, $2, $3, $4)`,
        [campaignId, parsed.tasks[i].area, parsed.tasks[i].title, i]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Campaña creada', id: Number(campaignId) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear la campaña' });
  } finally {
    client.release();
  }
});

// Full update: fields + task list. Existing task ids keep their done state;
// tasks omitted from the payload are deleted; new ones are inserted.
router.put('/api/campaigns/:id', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  const parsed = validateCampaignBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const campaignId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return res.status(400).json({ error: 'ID inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE marketing_campaigns
       SET name = $2, objective = $3, start_date = $4, end_date = $5, live_time = $6, expected_return = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [campaignId, parsed.name, parsed.objective, parsed.start_date, parsed.end_date, parsed.live_time, parsed.expected_return]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaña no encontrada' });
    }
    const keepIds = parsed.tasks.map((t) => t.id).filter(Boolean);
    if (keepIds.length > 0) {
      await client.query(
        `DELETE FROM marketing_campaign_tasks WHERE campaign_id = $1 AND NOT (id = ANY($2::bigint[]))`,
        [campaignId, keepIds]
      );
    } else {
      await client.query('DELETE FROM marketing_campaign_tasks WHERE campaign_id = $1', [campaignId]);
    }
    for (let i = 0; i < parsed.tasks.length; i++) {
      const task = parsed.tasks[i];
      if (task.id) {
        await client.query(
          `UPDATE marketing_campaign_tasks SET area = $2, title = $3, position = $4
           WHERE id = $1 AND campaign_id = $5`,
          [task.id, task.area, task.title, i, campaignId]
        );
      } else {
        await client.query(
          `INSERT INTO marketing_campaign_tasks (campaign_id, area, title, position)
           VALUES ($1, $2, $3, $4)`,
          [campaignId, task.area, task.title, i]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Campaña actualizada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la campaña' });
  } finally {
    client.release();
  }
});

router.patch('/api/campaigns/:id/status', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!['borrador', 'anunciada', 'finalizada'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  try {
    const result = await pool.query(
      `UPDATE marketing_campaigns SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id, status]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Campaña no encontrada' });
    res.json({ message: status === 'anunciada' ? 'Campaña anunciada a todo el equipo' : 'Estado actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cambiar el estado' });
  }
});

router.delete('/api/campaigns/:id', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM marketing_campaigns WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Campaña no encontrada' });
    res.json({ message: 'Campaña eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la campaña' });
  }
});

// Tick/untick a responsibility. Each user can only check tasks of their own
// area; Admin (and Marketing, who runs the campaign) can check any.
router.patch('/api/campaigns/tasks/:taskId/done', authenticateToken, async (req, res) => {
  const done = Boolean(req.body?.done);
  try {
    const taskRes = await pool.query(
      `SELECT t.id, t.area, c.status
       FROM marketing_campaign_tasks t
       JOIN marketing_campaigns c ON c.id = t.campaign_id
       WHERE t.id = $1`,
      [req.params.taskId]
    );
    if (taskRes.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const task = taskRes.rows[0];
    if (task.status === 'finalizada') {
      return res.status(400).json({ error: 'La campaña ya finalizó' });
    }
    const role = normalizeRole(req.user.role || '');
    const userArea = areaForRole(req.user.role);
    const canAnyArea = role === ROLE_KEYS.admin || role === ROLE_KEYS.marketing || role === ROLE_KEYS.marketingLider;
    if (!canAnyArea && userArea !== task.area) {
      return res.status(403).json({ error: 'Solo el área responsable puede marcar esta tarea' });
    }
    await pool.query(
      `UPDATE marketing_campaign_tasks
       SET done = $2,
           done_by = CASE WHEN $2::boolean THEN $3::integer ELSE NULL END,
           done_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [task.id, done, req.user.id]
    );
    res.json({ message: done ? 'Tarea marcada como lista' : 'Tarea desmarcada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
  }
});

// ─── Piloto de Inversión (no es un presupuesto) ──────────────────────────────
// Cada campaña/live registra su inversión y declara un retorno esperado.
// El retorno REAL se mide: ventas de la ventana vs. línea base (promedio
// diario de los 30 días previos) → ventas extra y múltiplo.

const PAID_STATUSES = ['Pagado', 'Embalado', 'Enviado'];
const LIVE_WINDOW_DAYS = 3; // día del live + 2 días de cola de pedidos

router.post('/api/campaigns/:id/costs', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  const campaignId = Number.parseInt(req.params.id, 10);
  const concept = String(req.body?.concept || '').trim().slice(0, 160);
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return res.status(400).json({ error: 'ID inválido' });
  if (!concept) return res.status(400).json({ error: 'El concepto es obligatorio' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Monto inválido' });
  try {
    const result = await pool.query(
      `INSERT INTO campaign_costs (campaign_id, concept, amount, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [campaignId, concept, amount, req.user.id]
    );
    res.status(201).json({ message: 'Inversión registrada', id: Number(result.rows[0].id) });
  } catch (err) {
    if (err?.code === '23503') return res.status(404).json({ error: 'Campaña no encontrada' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la inversión' });
  }
});

router.delete('/api/campaigns/costs/:costId', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM campaign_costs WHERE id = $1 RETURNING id', [req.params.costId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json({ message: 'Ítem eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

// Resumen de inversión y retorno por campaña/live. Solo Marketing/Admin.
router.get('/api/campaigns/investment', authenticateToken, requireRole(EDIT_ROLES), async (_req, res) => {
  try {
    const campRes = await pool.query(
      `SELECT id, name, kind, status, start_date::text AS start_date, end_date::text AS end_date,
              live_time, expected_return
       FROM marketing_campaigns
       ORDER BY start_date DESC, id DESC
       LIMIT 60`
    );
    const costsRes = await pool.query(
      `SELECT cc.id, cc.campaign_id, cc.concept, cc.amount
       FROM campaign_costs cc ORDER BY cc.created_at, cc.id`
    );
    const costsByCampaign = new Map();
    for (const row of costsRes.rows) {
      const key = Number(row.campaign_id);
      if (!costsByCampaign.has(key)) costsByCampaign.set(key, []);
      costsByCampaign.get(key).push({ id: Number(row.id), concept: row.concept, amount: Number(row.amount) });
    }

    const todayRes = await pool.query("SELECT (NOW() AT TIME ZONE 'America/La_Paz')::date::text AS today");
    const today = todayRes.rows[0].today;

    const items = await Promise.all(campRes.rows.map(async (camp) => {
      const isLive = camp.kind === 'live';
      const windowStart = camp.start_date;
      const windowEnd = isLive
        ? (await pool.query("SELECT ($1::date + ($2 - 1) * INTERVAL '1 day')::date::text AS d", [camp.start_date, LIVE_WINDOW_DAYS])).rows[0].d
        : camp.end_date;

      const [windowRes, baselineRes] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(total), 0) AS sales, COUNT(*)::int AS orders
           FROM quotes
           WHERE status = ANY($3)
             AND (created_at AT TIME ZONE 'America/La_Paz')::date BETWEEN $1::date AND $2::date`,
          [windowStart, windowEnd, PAID_STATUSES]
        ),
        pool.query(
          `SELECT COALESCE(SUM(total), 0) / 30.0 AS daily_avg
           FROM quotes
           WHERE status = ANY($2)
             AND (created_at AT TIME ZONE 'America/La_Paz')::date BETWEEN ($1::date - 30) AND ($1::date - 1)`,
          [windowStart, PAID_STATUSES]
        )
      ]);

      const costs = costsByCampaign.get(Number(camp.id)) || [];
      const invested = costs.reduce((sum, c) => sum + c.amount, 0);
      const windowDaysRes = await pool.query('SELECT ($2::date - $1::date + 1) AS days', [windowStart, windowEnd]);
      const windowDays = Number(windowDaysRes.rows[0].days);
      const windowSales = Number(windowRes.rows[0].sales);
      const baselineDaily = Number(baselineRes.rows[0].daily_avg);
      const baselineSales = Math.round(baselineDaily * windowDays * 100) / 100;
      const extra = Math.round((windowSales - baselineSales) * 100) / 100;
      const phase = windowStart > today ? 'pendiente' : (windowEnd >= today ? 'en_curso' : 'cerrada');

      return {
        id: Number(camp.id),
        name: camp.name,
        kind: camp.kind || 'campana',
        status: camp.status,
        start_date: camp.start_date,
        end_date: camp.end_date,
        live_time: camp.live_time ? String(camp.live_time).slice(0, 5) : null,
        window_end: windowEnd,
        window_days: windowDays,
        phase,
        costs,
        invested: Math.round(invested * 100) / 100,
        expected_return: camp.expected_return === null ? null : Number(camp.expected_return),
        window_sales: windowSales,
        window_orders: Number(windowRes.rows[0].orders),
        baseline_sales: baselineSales,
        extra_sales: extra,
        multiple: invested > 0 && phase !== 'pendiente' ? Math.round((extra / invested) * 10) / 10 : null
      };
    }));

    const totals = items.reduce((acc, item) => {
      acc.invested += item.invested;
      if (item.phase !== 'pendiente') acc.extra += Math.max(0, item.extra_sales) * (item.invested > 0 ? 1 : 0);
      return acc;
    }, { invested: 0, extra: 0 });

    res.json({
      items,
      totals: {
        invested: Math.round(totals.invested * 100) / 100,
        extra_sales: Math.round(totals.extra * 100) / 100,
        multiple: totals.invested > 0 ? Math.round((totals.extra / totals.invested) * 10) / 10 : null
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el resumen de inversión' });
  }
});

// ─── Eventos del calendario de Marketing ─────────────────────────────────────
// Además de campañas y lives, Marketing anota sus propios eventos (sesiones
// de fotos, ferias, entregas de artes). Todos los ven; edita Marketing/Admin.

const parseEvent = (body = {}) => {
  const title = String(body.title || '').trim().slice(0, 160);
  if (!title) return { error: 'El título es obligatorio' };
  if (!isValidDate(body.event_date)) return { error: 'Fecha inválida (AAAA-MM-DD)' };
  let eventTime = null;
  if (body.event_time !== undefined && body.event_time !== null && String(body.event_time).trim() !== '') {
    eventTime = String(body.event_time).trim().slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) return { error: 'Hora inválida (HH:MM)' };
  }
  return { title, event_date: body.event_date, event_time: eventTime, note: String(body.note || '').trim().slice(0, 1000) };
};

router.get('/api/marketing-events', authenticateToken, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.title, e.event_date::text AS event_date, e.event_time, e.note,
              COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS author
       FROM marketing_events e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.event_date >= (NOW() AT TIME ZONE 'America/La_Paz')::date - INTERVAL '12 months'
       ORDER BY e.event_date, e.event_time NULLS LAST, e.id`
    );
    res.json({
      events: result.rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        event_date: String(row.event_date).slice(0, 10),
        event_time: row.event_time ? String(row.event_time).slice(0, 5) : null,
        note: row.note || '',
        author: row.author || null
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar los eventos' });
  }
});

router.post('/api/marketing-events', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  const parsed = parseEvent(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const result = await pool.query(
      `INSERT INTO marketing_events (title, event_date, event_time, note, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parsed.title, parsed.event_date, parsed.event_time, parsed.note, req.user.id]
    );
    res.status(201).json({ message: 'Evento creado', id: Number(result.rows[0].id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el evento' });
  }
});

router.put('/api/marketing-events/:id', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  const parsed = parseEvent(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const result = await pool.query(
      `UPDATE marketing_events SET title = $2, event_date = $3, event_time = $4, note = $5, updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.id, parsed.title, parsed.event_date, parsed.event_time, parsed.note]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el evento' });
  }
});

router.delete('/api/marketing-events/:id', authenticateToken, requireRole(EDIT_ROLES), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM marketing_events WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar el evento' });
  }
});

module.exports = router;
