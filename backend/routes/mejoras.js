const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { AREA_LABELS } = require('../lib/areas');
const { MEJORA_AREAS, groupMejoraRows, normalizeMejoraArea } = require('../lib/mejoras');

const router = express.Router();

// Pestaña Mejoras: el registro de todo lo que el equipo mejoró, por mes,
// por área del negocio y por persona. Las mejoras NO se crean aquí: nacen
// como bloque "Mejora" en el Plan del día y entran al registro al marcarse
// hechas (ver lib/mejoras.js). Aquí se consultan y se documentan.
//
// Una mejora en grupo tiene un registro por participante (mismo group_key):
// para el equipo cuenta UNA vez (COUNT DISTINCT group_key); para cada
// persona cuenta la suya.

const BO_TODAY = "(NOW() AT TIME ZONE 'America/La_Paz')::date";
const AREA_ORDER = ['ventas', 'almacen', 'produccion', 'marketing', 'admin', 'general'];

const isAdmin = (req) => normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;

const parseMonth = (query) => {
  const now = new Date();
  const month = Number.parseInt(query.month, 10);
  const year = Number.parseInt(query.year, 10);
  const safeMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1;
  const safeYear = Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : now.getFullYear();
  return { month: safeMonth, year: safeYear };
};

const loadGroup = async (groupKey) => {
  const res = await pool.query(
    `SELECT m.*, u.display_name, u.email, u.role
     FROM mejoras m JOIN users u ON u.id = m.user_id
     WHERE m.group_key = $1
     ORDER BY m.id`,
    [groupKey]
  );
  return groupMejoraRows(res.rows)[0] || null;
};

router.get('/api/mejoras', authenticateToken, async (req, res) => {
  const { month, year } = parseMonth(req.query || {});
  try {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const [itemsRes, byAreaRes, byUserRes, totalsRes, plannedRes] = await Promise.all([
      pool.query(
        `SELECT m.*, u.display_name, u.email, u.role
         FROM mejoras m
         JOIN users u ON u.id = m.user_id
         WHERE m.task_date >= $1::date AND m.task_date < ($1::date + INTERVAL '1 month')
         ORDER BY m.task_date DESC, m.completed_at DESC, m.group_key DESC, m.id`,
        [monthStart]
      ),
      pool.query(
        `SELECT area, COUNT(DISTINCT group_key)::int AS count
         FROM mejoras
         WHERE task_date >= $1::date AND task_date < ($1::date + INTERVAL '1 month')
         GROUP BY area`,
        [monthStart]
      ),
      pool.query(
        `SELECT u.id, COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS name, u.role,
                COUNT(m.id) FILTER (WHERE m.task_date >= $1::date AND m.task_date < ($1::date + INTERVAL '1 month'))::int AS month_count,
                COUNT(m.id)::int AS total_count,
                MAX(m.task_date) AS last_date
         FROM users u
         LEFT JOIN mejoras m ON m.user_id = u.id
         WHERE u.is_active = TRUE
         GROUP BY u.id, u.display_name, u.email, u.role
         ORDER BY month_count DESC, total_count DESC, name`,
        [monthStart]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT group_key) FILTER (WHERE task_date >= $1::date AND task_date < ($1::date + INTERVAL '1 month'))::int AS month_count,
                COUNT(DISTINCT group_key) FILTER (WHERE task_date >= ($1::date - INTERVAL '1 month') AND task_date < $1::date)::int AS previous_month_count,
                COUNT(DISTINCT group_key)::int AS all_time,
                COUNT(DISTINCT user_id) FILTER (WHERE task_date >= $1::date AND task_date < ($1::date + INTERVAL '1 month'))::int AS people,
                COUNT(DISTINCT group_key) FILTER (WHERE task_date = ${BO_TODAY})::int AS today_count
         FROM mejoras`,
        [monthStart]
      ),
      // Mejoras planificadas hoy y aún no hechas: lo que está "en camino".
      pool.query(
        `SELECT t.id, t.title, t.user_id, t.start_minute,
                COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS name,
                COALESCE((
                  SELECT string_agg(COALESCE(NULLIF(TRIM(pu.display_name), ''), split_part(pu.email, '@', 1)), ', ' ORDER BY pu.display_name)
                  FROM day_plan_task_participants p JOIN users pu ON pu.id = p.user_id
                  WHERE p.task_id = t.id
                ), '') AS participants
         FROM day_plan_tasks t JOIN users u ON u.id = t.user_id
         WHERE t.task_type = 'mejora' AND t.is_done = FALSE AND t.task_date = ${BO_TODAY}
         ORDER BY t.start_minute, t.id`
      )
    ]);

    const countByArea = Object.fromEntries(byAreaRes.rows.map((row) => [row.area, Number(row.count)]));
    const byArea = AREA_ORDER
      .filter((area) => area !== 'general' || countByArea.general > 0)
      .map((area) => ({ area, label: AREA_LABELS[area], count: countByArea[area] || 0 }));

    res.json({
      month,
      year,
      totals: totalsRes.rows[0],
      by_area: byArea,
      by_user: byUserRes.rows.map((row) => ({
        user_id: Number(row.id),
        name: row.name,
        role: row.role,
        month_count: Number(row.month_count),
        total_count: Number(row.total_count),
        last_date: row.last_date ? String(row.last_date instanceof Date ? row.last_date.toISOString().slice(0, 10) : row.last_date).slice(0, 10) : null
      })),
      in_progress_today: plannedRes.rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        user_id: Number(row.user_id),
        user_name: row.participants ? `${row.name}, ${row.participants}` : row.name,
        is_group: Boolean(row.participants),
        start_minute: Number(row.start_minute)
      })),
      items: groupMejoraRows(itemsRes.rows),
      areas: MEJORA_AREAS.map((area) => ({ area, label: AREA_LABELS[area] }))
    });
  } catch (err) {
    console.error('Error loading mejoras:', err);
    res.status(500).json({ error: 'No se pudo cargar el registro de mejoras' });
  }
});

// Documentar una mejora: qué cambió y qué se ganó. Cualquiera de sus
// participantes o admin; el texto es compartido por todo el grupo.
// Admin además puede corregir el área (de todo el grupo).
router.patch('/api/mejoras/:id', authenticateToken, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Mejora inválida' });
  const has = (key) => Object.prototype.hasOwnProperty.call(req.body || {}, key);
  try {
    const current = await pool.query('SELECT * FROM mejoras WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Mejora no encontrada' });
    const groupKey = Number(current.rows[0].group_key);
    const member = await pool.query('SELECT 1 FROM mejoras WHERE group_key = $1 AND user_id = $2', [groupKey, req.user.id]);
    if (member.rowCount === 0 && !isAdmin(req)) return res.status(403).json({ error: 'Solo puedes documentar tus propias mejoras' });

    const sets = [];
    const values = [groupKey];
    if (has('detail')) {
      const detail = String(req.body.detail || '').trim().slice(0, 1500);
      values.push(detail || null);
      sets.push(`detail = $${values.length}`);
    }
    if (has('area')) {
      if (!isAdmin(req)) return res.status(403).json({ error: 'Solo Admin puede cambiar el área' });
      const area = normalizeMejoraArea(req.body.area);
      if (!area) return res.status(400).json({ error: 'Área inválida' });
      values.push(area);
      sets.push(`area = $${values.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    await pool.query(`UPDATE mejoras SET ${sets.join(', ')}, updated_at = NOW() WHERE group_key = $1`, values);
    res.json({ mejora: await loadGroup(groupKey) });
  } catch (err) {
    console.error('Error updating mejora:', err);
    res.status(500).json({ error: 'No se pudo actualizar la mejora' });
  }
});

// Quitar un registro (solo Admin): para entradas que no fueron una mejora
// real. Se quita el grupo completo.
router.delete('/api/mejoras/:id', authenticateToken, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Mejora inválida' });
  if (!isAdmin(req)) return res.status(403).json({ error: 'Solo Admin puede eliminar registros' });
  try {
    const current = await pool.query('SELECT group_key FROM mejoras WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Mejora no encontrada' });
    await pool.query('DELETE FROM mejoras WHERE group_key = $1', [Number(current.rows[0].group_key)]);
    res.json({ message: 'Registro eliminado' });
  } catch (err) {
    console.error('Error deleting mejora:', err);
    res.status(500).json({ error: 'No se pudo eliminar el registro' });
  }
});

module.exports = router;
