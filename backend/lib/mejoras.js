const { pool } = require('../db');
const { areaForRole, AREA_LABELS } = require('./areas');

// Registro de mejoras: la única puerta de entrada es el Plan del día. Un
// bloque de tipo "mejora" que se marca hecho queda registrado; si se reabre
// (o deja de ser mejora) el registro se retira. Así la pestaña Mejoras y el
// resumen de Inicio siempre reflejan lo que el equipo realmente completó.

const MEJORA_AREAS = ['ventas', 'almacen', 'produccion', 'marketing', 'admin', 'general'];

const normalizeMejoraArea = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  return MEJORA_AREAS.includes(key) ? key : null;
};

const areaForUserRole = (role) => areaForRole(role) || 'general';

const syncMejoraForTask = async (taskRow, client = pool) => {
  if (!taskRow || !taskRow.id) return null;
  const isMejora = String(taskRow.task_type || '') === 'mejora';
  if (isMejora && taskRow.is_done) {
    const userRes = await client.query('SELECT role FROM users WHERE id = $1', [taskRow.user_id]);
    const area = areaForUserRole(userRes.rows[0]?.role || '');
    const result = await client.query(
      `INSERT INTO mejoras (day_plan_task_id, user_id, area, title, task_date, completed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (day_plan_task_id) DO UPDATE
         SET title = EXCLUDED.title,
             task_date = EXCLUDED.task_date,
             updated_at = NOW()
       RETURNING *`,
      [taskRow.id, taskRow.user_id, area, taskRow.title, taskRow.task_date]
    );
    return { registered: true, mejora: result.rows[0] };
  }
  const del = await client.query('DELETE FROM mejoras WHERE day_plan_task_id = $1', [taskRow.id]);
  return { registered: false, removed: del.rowCount > 0 };
};

const mapMejoraRow = (row) => ({
  id: Number(row.id),
  day_plan_task_id: row.day_plan_task_id ? Number(row.day_plan_task_id) : null,
  user_id: Number(row.user_id),
  user_name: String(row.display_name || '').trim() || String(row.email || '').split('@')[0] || 'Usuario',
  user_role: row.role || null,
  area: row.area || 'general',
  area_label: AREA_LABELS[row.area] || AREA_LABELS.general,
  title: row.title,
  detail: row.detail || null,
  task_date: row.task_date instanceof Date ? row.task_date.toISOString().slice(0, 10) : String(row.task_date).slice(0, 10),
  completed_at: row.completed_at || null
});

module.exports = { MEJORA_AREAS, areaForUserRole, mapMejoraRow, normalizeMejoraArea, syncMejoraForTask };
