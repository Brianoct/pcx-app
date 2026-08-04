const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_TYPES = ['tarea', '3s', 'kaizen'];

const userDisplayName = (row) =>
  String(row.display_name || '').trim() || String(row.email || '').split('@')[0] || 'Usuario';

const buildTaskRow = (row, subtasks = []) => ({
  id: Number(row.id),
  user_id: Number(row.user_id),
  task_date: row.task_date instanceof Date ? row.task_date.toISOString().slice(0, 10) : String(row.task_date).slice(0, 10),
  start_minute: Number(row.start_minute),
  end_minute: Number(row.end_minute),
  title: row.title,
  task_type: TASK_TYPES.includes(row.task_type) ? row.task_type : 'tarea',
  is_done: Boolean(row.is_done),
  // Tarea que viene de Planificación (Programa→Operación→Misión→Tarea):
  // el frontend la dibuja con checkbox y el check se sincroniza allá.
  planning_task_id: row.planning_task_id ? Number(row.planning_task_id) : null,
  // Checklist del bloque: el % de avance se dibuja dentro del bloque.
  subtasks
});

const buildSubtaskRow = (row) => ({
  id: Number(row.id),
  task_id: Number(row.task_id),
  title: row.title,
  is_done: Boolean(row.is_done)
});

const loadSubtasksByTask = async (taskIds) => {
  if (taskIds.length === 0) return new Map();
  const result = await pool.query(
    'SELECT * FROM day_plan_subtasks WHERE task_id = ANY($1) ORDER BY position, id',
    [taskIds]
  );
  const map = new Map();
  for (const row of result.rows) {
    const sub = buildSubtaskRow(row);
    if (!map.has(sub.task_id)) map.set(sub.task_id, []);
    map.get(sub.task_id).push(sub);
  }
  return map;
};

// Sincroniza el check con la tarea de Planificación vinculada (si la hay).
const syncPlanningDone = async (taskRow, isDone) => {
  if (!taskRow.planning_task_id) return;
  await pool.query(
    `UPDATE planning_tasks SET is_done = $2, done_at = CASE WHEN $2 THEN NOW() ELSE NULL END, updated_at = NOW()
     WHERE id = $1`,
    [taskRow.planning_task_id, isDone]
  );
};

// Con checklist, el bloque se marca hecho solo cuando TODO está completo.
const recomputeTaskDone = async (taskRow) => {
  const agg = await pool.query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_done)::int AS done FROM day_plan_subtasks WHERE task_id = $1',
    [taskRow.id]
  );
  const { total, done } = agg.rows[0];
  if (Number(total) === 0) return null;
  const allDone = Number(done) === Number(total);
  if (Boolean(taskRow.is_done) !== allDone) {
    await pool.query('UPDATE day_plan_tasks SET is_done = $2, updated_at = NOW() WHERE id = $1', [taskRow.id, allDone]);
    await syncPlanningDone(taskRow, allDone);
  }
  return allDone;
};

const parseTaskFields = (body, { partial = false } = {}) => {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body || {}, key);
  if (!partial || has('title')) {
    const title = String(body?.title || '').trim().slice(0, 120);
    if (!title) return { error: 'La tarea necesita una descripción' };
    out.title = title;
  }
  if (!partial || has('start_minute') || has('end_minute')) {
    const start = Number.parseInt(body?.start_minute, 10);
    const end = Number.parseInt(body?.end_minute, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end <= start) {
      return { error: 'Horario inválido: la hora fin debe ser mayor a la de inicio' };
    }
    out.start_minute = start;
    out.end_minute = end;
  }
  if (has('task_type')) {
    const type = String(body.task_type || '').trim().toLowerCase();
    if (!TASK_TYPES.includes(type)) return { error: 'Tipo de tarea inválido' };
    out.task_type = type;
  }
  // Pasar el bloque a otra fecha (con su checklist intacta).
  if (has('task_date')) {
    const taskDate = String(body.task_date || '').trim();
    if (!DATE_RE.test(taskDate)) return { error: 'Fecha inválida (AAAA-MM-DD)' };
    out.task_date = taskDate;
  }
  if (has('is_done')) out.is_done = Boolean(body.is_done);
  return { fields: out };
};

// The whole team's plan for one day, plus the roster of active users so
// people who haven't planned yet still appear as empty columns.
router.get('/api/day-plan', authenticateToken, async (req, res) => {
  const date = String(req.query.date || '').trim();
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' });
  try {
    const [teamRes, tasksRes] = await Promise.all([
      pool.query(
        `SELECT id, email, display_name, role FROM users
         WHERE is_active = TRUE
         ORDER BY COALESCE(NULLIF(TRIM(display_name), ''), email)`
      ),
      pool.query(
        `SELECT t.*, u.display_name, u.email
         FROM day_plan_tasks t
         JOIN users u ON u.id = t.user_id
         WHERE t.task_date = $1
         ORDER BY t.start_minute, t.id`,
        [date]
      )
    ]);
    const subtasksByTask = await loadSubtasksByTask(tasksRes.rows.map((row) => Number(row.id)));
    res.json({
      date,
      team: teamRes.rows.map((row) => ({
        id: Number(row.id),
        name: userDisplayName(row),
        role: row.role
      })),
      tasks: tasksRes.rows.map((row) => buildTaskRow(row, subtasksByTask.get(Number(row.id)) || []))
    });
  } catch (err) {
    console.error('Error loading day plan:', err);
    res.status(500).json({ error: 'No se pudo cargar el plan del día' });
  }
});

router.post('/api/day-plan', authenticateToken, async (req, res) => {
  const date = String(req.body?.date || '').trim();
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Fecha inválida (AAAA-MM-DD)' });
  const parsed = parseTaskFields(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { title, start_minute, end_minute } = parsed.fields;
  if (start_minute === undefined) return res.status(400).json({ error: 'Horario requerido' });
  try {
    const result = await pool.query(
      `INSERT INTO day_plan_tasks (user_id, task_date, start_minute, end_minute, title, task_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, date, start_minute, end_minute, title, parsed.fields.task_type || 'tarea']
    );
    res.status(201).json({ task: buildTaskRow(result.rows[0]) });
  } catch (err) {
    console.error('Error creating day plan task:', err);
    res.status(500).json({ error: 'No se pudo agregar la tarea' });
  }
});

const canManageTask = (req, taskRow) =>
  Number(taskRow.user_id) === Number(req.user.id)
  || normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;

router.patch('/api/day-plan/:id', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  const parsed = parseTaskFields(req.body, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const fields = parsed.fields;
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  try {
    const currentRes = await pool.query('SELECT * FROM day_plan_tasks WHERE id = $1', [taskId]);
    if (currentRes.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!canManageTask(req, currentRes.rows[0])) {
      return res.status(403).json({ error: 'Solo puedes editar tus propias tareas' });
    }
    const sets = [];
    const values = [taskId];
    for (const [key, value] of Object.entries(fields)) {
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    const result = await pool.query(
      `UPDATE day_plan_tasks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    const updated = result.rows[0];
    // Check sincronizado: si la tarea vino de Planificación, marcarla hecha
    // aquí también la marca allá (y viceversa, ver routes/planning.js).
    if (Object.prototype.hasOwnProperty.call(fields, 'is_done') && updated.planning_task_id) {
      await syncPlanningDone(updated, fields.is_done);
    }
    const subtasksByTask = await loadSubtasksByTask([taskId]);
    res.json({ task: buildTaskRow(updated, subtasksByTask.get(taskId) || []) });
  } catch (err) {
    console.error('Error updating day plan task:', err);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
  }
});

router.delete('/api/day-plan/:id', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  try {
    const currentRes = await pool.query('SELECT * FROM day_plan_tasks WHERE id = $1', [taskId]);
    if (currentRes.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!canManageTask(req, currentRes.rows[0])) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propias tareas' });
    }
    await pool.query('DELETE FROM day_plan_tasks WHERE id = $1', [taskId]);
    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    console.error('Error deleting day plan task:', err);
    res.status(500).json({ error: 'No se pudo eliminar la tarea' });
  }
});

// ─── Checklist dentro de un bloque ──────────────────────────────────────────

const loadOwnedTask = async (req, res, taskId) => {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: 'Tarea inválida' });
    return null;
  }
  const result = await pool.query('SELECT * FROM day_plan_tasks WHERE id = $1', [taskId]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Tarea no encontrada' });
    return null;
  }
  if (!canManageTask(req, result.rows[0])) {
    res.status(403).json({ error: 'Solo puedes editar tus propias tareas' });
    return null;
  }
  return result.rows[0];
};

router.post('/api/day-plan/:id/subtasks', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.id, 10);
  try {
    const task = await loadOwnedTask(req, res, taskId);
    if (!task) return;
    const title = String(req.body?.title || '').trim().slice(0, 120);
    if (!title) return res.status(400).json({ error: 'La tarea necesita una descripción' });
    const posRes = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM day_plan_subtasks WHERE task_id = $1',
      [taskId]
    );
    const result = await pool.query(
      'INSERT INTO day_plan_subtasks (task_id, title, position) VALUES ($1, $2, $3) RETURNING *',
      [taskId, title, Number(posRes.rows[0].next)]
    );
    // Un checklist con un ítem nuevo pendiente reabre el bloque si estaba hecho.
    const allDone = await recomputeTaskDone(task);
    res.status(201).json({ subtask: buildSubtaskRow(result.rows[0]), task_done: allDone });
  } catch (err) {
    console.error('Error creating subtask:', err);
    res.status(500).json({ error: 'No se pudo agregar la tarea a la lista' });
  }
});

router.patch('/api/day-plan/subtasks/:id', authenticateToken, async (req, res) => {
  const subtaskId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(subtaskId) || subtaskId <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  try {
    const subRes = await pool.query('SELECT * FROM day_plan_subtasks WHERE id = $1', [subtaskId]);
    if (subRes.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const task = await loadOwnedTask(req, res, Number(subRes.rows[0].task_id));
    if (!task) return;

    const has = (key) => Object.prototype.hasOwnProperty.call(req.body || {}, key);
    const sets = [];
    const values = [subtaskId];
    if (has('title')) {
      const title = String(req.body.title || '').trim().slice(0, 120);
      if (!title) return res.status(400).json({ error: 'La tarea necesita una descripción' });
      values.push(title);
      sets.push(`title = $${values.length}`);
    }
    if (has('is_done')) {
      values.push(Boolean(req.body.is_done));
      sets.push(`is_done = $${values.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    const result = await pool.query(
      `UPDATE day_plan_subtasks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    const allDone = await recomputeTaskDone(task);
    res.json({ subtask: buildSubtaskRow(result.rows[0]), task_done: allDone });
  } catch (err) {
    console.error('Error updating subtask:', err);
    res.status(500).json({ error: 'No se pudo actualizar la tarea' });
  }
});

router.delete('/api/day-plan/subtasks/:id', authenticateToken, async (req, res) => {
  const subtaskId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(subtaskId) || subtaskId <= 0) return res.status(400).json({ error: 'Tarea inválida' });
  try {
    const subRes = await pool.query('SELECT * FROM day_plan_subtasks WHERE id = $1', [subtaskId]);
    if (subRes.rowCount === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const task = await loadOwnedTask(req, res, Number(subRes.rows[0].task_id));
    if (!task) return;
    await pool.query('DELETE FROM day_plan_subtasks WHERE id = $1', [subtaskId]);
    const allDone = await recomputeTaskDone(task);
    res.json({ message: 'Tarea eliminada', task_done: allDone });
  } catch (err) {
    console.error('Error deleting subtask:', err);
    res.status(500).json({ error: 'No se pudo eliminar la tarea' });
  }
});

module.exports = router;
