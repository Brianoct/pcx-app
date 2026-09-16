const { pool } = require('../db');
const { areaForRole, AREA_LABELS } = require('./areas');

// Registro de mejoras: la única puerta de entrada es el Plan del día. Un
// bloque de tipo "mejora" que se marca hecho queda registrado; si se reabre
// (o deja de ser mejora) el registro se retira. Así la pestaña Mejoras y el
// resumen de Inicio siempre reflejan lo que el equipo realmente completó.
//
// Mejora en grupo: el bloque tiene participantes etiquetados. Cada persona
// (dueña + participantes) recibe su propio registro, todos con el mismo
// group_key (= id del bloque), así la pestaña los muestra como UNA mejora
// hecha entre varios y cada quien suma la suya.

const MEJORA_AREAS = ['ventas', 'almacen', 'produccion', 'marketing', 'admin', 'general'];

const normalizeMejoraArea = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  return MEJORA_AREAS.includes(key) ? key : null;
};

const areaForUserRole = (role) => areaForRole(role) || 'general';

const loadParticipantIds = async (taskId, client = pool) => {
  const res = await client.query('SELECT user_id FROM day_plan_task_participants WHERE task_id = $1', [taskId]);
  return res.rows.map((row) => Number(row.user_id));
};

const syncMejoraForTask = async (taskRow, client = pool) => {
  if (!taskRow || !taskRow.id) return null;
  const isMejora = String(taskRow.task_type || '') === 'mejora';
  if (isMejora && taskRow.is_done) {
    const participantIds = await loadParticipantIds(taskRow.id, client);
    const memberIds = Array.from(new Set([Number(taskRow.user_id), ...participantIds]));
    const rolesRes = await client.query('SELECT id, role FROM users WHERE id = ANY($1)', [memberIds]);
    const roleById = new Map(rolesRes.rows.map((row) => [Number(row.id), row.role]));
    // Un registro por persona; los que ya no participan salen del grupo.
    await client.query(
      'DELETE FROM mejoras WHERE group_key = $1 AND NOT (user_id = ANY($2))',
      [taskRow.id, memberIds]
    );
    for (const userId of memberIds) {
      await client.query(
        `INSERT INTO mejoras (day_plan_task_id, group_key, user_id, area, title, task_date, completed_at)
         VALUES ($1, $1, $2, $3, $4, $5, NOW())
         ON CONFLICT (group_key, user_id) DO UPDATE
           SET title = EXCLUDED.title,
               task_date = EXCLUDED.task_date,
               day_plan_task_id = EXCLUDED.day_plan_task_id,
               updated_at = NOW()`,
        [taskRow.id, userId, areaForUserRole(roleById.get(userId) || ''), taskRow.title, taskRow.task_date]
      );
    }
    return { registered: true, members: memberIds.length };
  }
  const del = await client.query('DELETE FROM mejoras WHERE group_key = $1', [taskRow.id]);
  return { registered: false, removed: del.rowCount > 0 };
};

const userName = (row) => String(row.display_name || '').trim() || String(row.email || '').split('@')[0] || 'Usuario';

const mapMejoraRow = (row) => ({
  id: Number(row.id),
  group_key: Number(row.group_key),
  day_plan_task_id: row.day_plan_task_id ? Number(row.day_plan_task_id) : null,
  user_id: Number(row.user_id),
  user_name: userName(row),
  user_role: row.role || null,
  area: row.area || 'general',
  area_label: AREA_LABELS[row.area] || AREA_LABELS.general,
  title: row.title,
  detail: row.detail || null,
  task_date: row.task_date instanceof Date ? row.task_date.toISOString().slice(0, 10) : String(row.task_date).slice(0, 10),
  completed_at: row.completed_at || null
});

// Una entrada por mejora: los registros de un grupo se funden en un ítem con
// la lista de participantes (el área es la del primer registro, corregible).
const groupMejoraRows = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const mapped = mapMejoraRow(row);
    if (!groups.has(mapped.group_key)) {
      groups.set(mapped.group_key, {
        ...mapped,
        participants: [],
        participant_ids: [],
        is_group: false
      });
    }
    const group = groups.get(mapped.group_key);
    group.participants.push({ user_id: mapped.user_id, name: mapped.user_name, area: mapped.area });
    group.participant_ids.push(mapped.user_id);
    if (!group.detail && mapped.detail) group.detail = mapped.detail;
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    is_group: group.participants.length > 1,
    user_name: group.participants.map((p) => p.name).join(', ')
  }));
};

module.exports = {
  MEJORA_AREAS,
  areaForUserRole,
  groupMejoraRows,
  loadParticipantIds,
  mapMejoraRow,
  normalizeMejoraArea,
  syncMejoraForTask
};
