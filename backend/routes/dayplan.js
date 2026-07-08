const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const userDisplayName = (row) =>
  String(row.display_name || '').trim() || String(row.email || '').split('@')[0] || 'Usuario';

const buildTaskRow = (row) => ({
  id: Number(row.id),
  user_id: Number(row.user_id),
  task_date: row.task_date instanceof Date ? row.task_date.toISOString().slice(0, 10) : String(row.task_date).slice(0, 10),
  start_minute: Number(row.start_minute),
  end_minute: Number(row.end_minute),
  title: row.title,
  is_done: Boolean(row.is_done)
});

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
    res.json({
      date,
      team: teamRes.rows.map((row) => ({
        id: Number(row.id),
        name: userDisplayName(row),
        role: row.role
      })),
      tasks: tasksRes.rows.map(buildTaskRow)
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
      `INSERT INTO day_plan_tasks (user_id, task_date, start_minute, end_minute, title)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, date, start_minute, end_minute, title]
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
    res.json({ task: buildTaskRow(result.rows[0]) });
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

module.exports = router;
