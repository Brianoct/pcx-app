// Planificación estratégica: Programa (área) → Operación → Misión → Tarea.
// Fase 1: solo Admin, para probar y pulir antes de abrirlo a cada área.
// Las tareas se envían al Plan del día (day_plan_tasks.planning_task_id) y el
// check de "hecha" se sincroniza en ambos sentidos.
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');

const router = express.Router();

const AREAS = ['marketing', 'ventas', 'almacen', 'produccion', 'admin'];
const OPERATION_STATUSES = ['activa', 'pausada', 'completada'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const adminOnly = [authenticateToken, requireRole(['admin'])];

const dateText = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

// "Hoy" en hora de Bolivia (UTC-4, sin horario de verano).
const boliviaToday = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);

const parseDateField = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return { value: null };
  if (!DATE_RE.test(text)) return { error: 'Fecha inválida (AAAA-MM-DD)' };
  return { value: text };
};

const buildOperationRow = (row) => ({
  id: Number(row.id),
  name: row.name,
  description: row.description || '',
  status: row.status,
  start_date: dateText(row.start_date),
  end_date: dateText(row.end_date),
  created_by_name: row.created_by_name || null
});

const buildMissionRow = (row) => ({
  id: Number(row.id),
  operation_id: Number(row.operation_id),
  area: row.area,
  name: row.name,
  objective: row.objective || '',
  status: row.status
});

const buildTaskRow = (row) => ({
  id: Number(row.id),
  mission_id: Number(row.mission_id),
  title: row.title,
  due_date: dateText(row.due_date),
  is_done: Boolean(row.is_done),
  in_my_day: Boolean(row.in_my_day)
});

// Todo el árbol de una vez: operaciones → misiones → tareas. El volumen es
// chico (planificación estratégica, no transaccional) así que una sola
// respuesta anidada mantiene simple al frontend.
router.get('/api/planning', ...adminOnly, async (req, res) => {
  try {
    const [opsRes, missionsRes, tasksRes] = await Promise.all([
      pool.query(
        `SELECT o.*, COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) AS created_by_name
         FROM planning_operations o
         LEFT JOIN users u ON u.id = o.created_by
         ORDER BY (o.status = 'completada'), o.created_at DESC, o.id DESC`
      ),
      pool.query('SELECT * FROM planning_missions ORDER BY id'),
      pool.query(
        `SELECT t.*,
                EXISTS (
                  SELECT 1 FROM day_plan_tasks d
                  WHERE d.planning_task_id = t.id AND d.user_id = $1 AND d.task_date >= $2
                ) AS in_my_day
         FROM planning_tasks t
         ORDER BY t.is_done, t.due_date NULLS LAST, t.id`,
        [req.user.id, boliviaToday()]
      )
    ]);
    const tasksByMission = new Map();
    for (const row of tasksRes.rows) {
      const task = buildTaskRow(row);
      if (!tasksByMission.has(task.mission_id)) tasksByMission.set(task.mission_id, []);
      tasksByMission.get(task.mission_id).push(task);
    }
    const missionsByOperation = new Map();
    for (const row of missionsRes.rows) {
      const mission = buildMissionRow(row);
      mission.tasks = tasksByMission.get(mission.id) || [];
      mission.done_count = mission.tasks.filter((t) => t.is_done).length;
      if (!missionsByOperation.has(mission.operation_id)) missionsByOperation.set(mission.operation_id, []);
      missionsByOperation.get(mission.operation_id).push(mission);
    }
    const operations = opsRes.rows.map((row) => {
      const op = buildOperationRow(row);
      op.missions = missionsByOperation.get(op.id) || [];
      const allTasks = op.missions.flatMap((m) => m.tasks);
      op.task_count = allTasks.length;
      op.done_count = allTasks.filter((t) => t.is_done).length;
      return op;
    });
    res.json({ areas: AREAS, operations });
  } catch (err) {
    console.error('Error loading planning:', err);
    res.status(500).json({ error: 'No se pudo cargar la planificación' });
  }
});

// ---------------------------------------------------------------- operaciones

router.post('/api/planning/operations', ...adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'La operación necesita un nombre' });
  const description = String(req.body?.description || '').trim().slice(0, 500);
  const start = parseDateField(req.body?.start_date);
  const end = parseDateField(req.body?.end_date);
  if (start.error || end.error) return res.status(400).json({ error: start.error || end.error });
  try {
    const result = await pool.query(
      `INSERT INTO planning_operations (name, description, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, start.value, end.value, req.user.id]
    );
    res.status(201).json({ operation: buildOperationRow(result.rows[0]) });
  } catch (err) {
    console.error('Error creating operation:', err);
    res.status(500).json({ error: 'No se pudo crear la operación' });
  }
});

router.patch('/api/planning/operations/:id', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Operación inválida' });
  const body = req.body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const sets = [];
  const values = [id];
  const push = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (has('name')) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'La operación necesita un nombre' });
    push('name', name);
  }
  if (has('description')) push('description', String(body.description || '').trim().slice(0, 500));
  if (has('status')) {
    const status = String(body.status || '').trim().toLowerCase();
    if (!OPERATION_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    push('status', status);
  }
  if (has('start_date')) {
    const parsed = parseDateField(body.start_date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    push('start_date', parsed.value);
  }
  if (has('end_date')) {
    const parsed = parseDateField(body.end_date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    push('end_date', parsed.value);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  try {
    const result = await pool.query(
      `UPDATE planning_operations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Operación no encontrada' });
    res.json({ operation: buildOperationRow(result.rows[0]) });
  } catch (err) {
    console.error('Error updating operation:', err);
    res.status(500).json({ error: 'No se pudo actualizar la operación' });
  }
});

router.delete('/api/planning/operations/:id', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Operación inválida' });
  try {
    const result = await pool.query('DELETE FROM planning_operations WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Operación no encontrada' });
    res.json({ message: 'Operación eliminada' });
  } catch (err) {
    console.error('Error deleting operation:', err);
    res.status(500).json({ error: 'No se pudo eliminar la operación' });
  }
});

// ------------------------------------------------------------------- misiones

router.post('/api/planning/missions', ...adminOnly, async (req, res) => {
  const operationId = Number.parseInt(req.body?.operation_id, 10);
  if (!Number.isInteger(operationId) || operationId <= 0) return res.status(400).json({ error: 'Operación inválida' });
  const area = String(req.body?.area || '').trim().toLowerCase();
  if (!AREAS.includes(area)) return res.status(400).json({ error: 'Área inválida' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'La misión necesita un nombre' });
  const objective = String(req.body?.objective || '').trim().slice(0, 500);
  try {
    const result = await pool.query(
      `INSERT INTO planning_missions (operation_id, area, name, objective)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [operationId, area, name, objective]
    );
    const mission = buildMissionRow(result.rows[0]);
    mission.tasks = [];
    mission.done_count = 0;
    res.status(201).json({ mission });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Operación no encontrada' });
    console.error('Error creating mission:', err);
    res.status(500).json({ error: 'No se pudo crear la misión' });
  }
});

router.patch('/api/planning/missions/:id', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Misión inválida' });
  const body = req.body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const sets = [];
  const values = [id];
  const push = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (has('name')) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'La misión necesita un nombre' });
    push('name', name);
  }
  if (has('objective')) push('objective', String(body.objective || '').trim().slice(0, 500));
  if (has('area')) {
    const area = String(body.area || '').trim().toLowerCase();
    if (!AREAS.includes(area)) return res.status(400).json({ error: 'Área inválida' });
    push('area', area);
  }
  if (has('status')) {
    const status = String(body.status || '').trim().toLowerCase();
    if (!['activa', 'completada'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    push('status', status);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  try {
    const result = await pool.query(
      `UPDATE planning_missions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Misión no encontrada' });
    res.json({ mission: buildMissionRow(result.rows[0]) });
  } catch (err) {
    console.error('Error updating mission:', err);
    res.status(500).json({ error: 'No se pudo actualizar la misión' });
  }
});

router.delete('/api/planning/missions/:id', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Misión inválida' });
  try {
    const result = await pool.query('DELETE FROM planning_missions WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Misión no encontrada' });
    res.json({ message: 'Misión eliminada' });
  } catch (err) {
    console.error('Error deleting mission:', err);
    res.status(500).json({ error: 'No se pudo eliminar la misión' });
  }
});

// --------------------------------------------------------------------- tareas

router.post('/api/planning/tasks', ...adminOnly, async (req, res) => {
  const missionId = Number.parseInt(req.body?.mission_id, 10);
  if (!Number.isInteger(missionId) || missionId <= 0) return res.status(400).json({ error: 'Misión inválida' });
  const title = String(req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'La tarea necesita una descripción' });
  const due = parseDateField(req.body?.due_date);
  if (due.error) return res.status(400).json({ error: due.error });
  try {
    const result = await pool.query(
      `INSERT INTO planning_tasks (mission_id, title, due_date)
       VALUES ($1, $2, $3) RETURNING *, FALSE AS in_my_day`,
      [missionId, title, due.value]
    );
    res.status(201).json({ task: buildTaskRow(result.rows[0]) });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Misión no encontrada' });
    console.error('Error creating planning task:', err);
    res.status(500).json({ error: 'No se pudo crear la tarea' });
  }
});

router.patch('/api/planning/tasks/:id', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  const body = req.body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const sets = [];
  const values = [id];
  const push = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (has('title')) {
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) return res.status(400).json({ error: 'La tarea necesita una descripción' });
    push('title', title);
  }
  if (has('due_date')) {
    const parsed = parseDateField(body.due_date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    push('due_date', parsed.value);
  }
  let doneChanged = null;
  if (has('is_done')) {
    doneChanged = Boolean(body.is_done);
    push('is_done', doneChanged);
    push('done_at', doneChanged ? new Date() : null);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  try {
    const result = await pool.query(
      `UPDATE planning_tasks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *, FALSE AS in_my_day`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    // Sincroniza el check con las entradas del Plan del día que apuntan aquí.
    if (doneChanged !== null) {
      await pool.query(
        'UPDATE day_plan_tasks SET is_done = $2, updated_at = NOW() WHERE planning_task_id = $1',
        [id, doneChanged]
      );
    }
    res.json({ task: buildTaskRow(result.rows[0]) });
  } catch (err) {
    console.error('Error updating planning task:', err);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
  }
});

router.delete('/api/planning/tasks/:id', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  try {
    const result = await pool.query('DELETE FROM planning_tasks WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    console.error('Error deleting planning task:', err);
    res.status(500).json({ error: 'No se pudo eliminar la tarea' });
  }
});

// Enviar una tarea de planificación a MI Plan del día. La entrada queda
// vinculada (planning_task_id) para que el check se sincronice.
router.post('/api/planning/tasks/:id/to-dayplan', ...adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  try {
    const taskRes = await pool.query(
      `SELECT t.*, m.name AS mission_name
       FROM planning_tasks t
       JOIN planning_missions m ON m.id = t.mission_id
       WHERE t.id = $1`,
      [id]
    );
    if (taskRes.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const task = taskRes.rows[0];

    const today = boliviaToday();
    let date = today;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'date')) {
      const parsed = parseDateField(req.body.date);
      if (parsed.error || !parsed.value) return res.status(400).json({ error: parsed.error || 'Fecha requerida' });
      date = parsed.value;
    } else {
      // Sin fecha explícita: la fecha límite si aún no pasó, si no hoy.
      const due = dateText(task.due_date);
      if (due && due >= today) date = due;
    }

    const dupRes = await pool.query(
      'SELECT id FROM day_plan_tasks WHERE planning_task_id = $1 AND user_id = $2 AND task_date = $3',
      [id, req.user.id, date]
    );
    if (dupRes.rowCount > 0) {
      return res.status(409).json({ error: 'Esta tarea ya está en tu plan de ese día' });
    }

    // Bloque por defecto 08:00–09:00; si está ocupado, la primera hora libre.
    const busyRes = await pool.query(
      'SELECT start_minute, end_minute FROM day_plan_tasks WHERE user_id = $1 AND task_date = $2',
      [req.user.id, date]
    );
    const busy = busyRes.rows.map((r) => [Number(r.start_minute), Number(r.end_minute)]);
    let start = 8 * 60;
    while (start + 60 <= 19 * 60 && busy.some(([s, e]) => s < start + 60 && e > start)) start += 60;
    if (start + 60 > 19 * 60) start = 8 * 60;

    const insertRes = await pool.query(
      `INSERT INTO day_plan_tasks (user_id, task_date, start_minute, end_minute, title, task_type, planning_task_id, is_done)
       VALUES ($1, $2, $3, $4, $5, 'tarea', $6, $7) RETURNING *`,
      [req.user.id, date, start, start + 60, String(task.title).slice(0, 120), id, Boolean(task.is_done)]
    );
    const row = insertRes.rows[0];
    res.status(201).json({
      message: 'Agregada a tu Plan del día',
      day_task: {
        id: Number(row.id),
        task_date: dateText(row.task_date),
        start_minute: Number(row.start_minute),
        end_minute: Number(row.end_minute)
      }
    });
  } catch (err) {
    console.error('Error sending task to day plan:', err);
    res.status(500).json({ error: 'No se pudo enviar al Plan del día' });
  }
});

module.exports = router;
