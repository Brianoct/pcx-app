const { pool } = require('../db');
const { normalizeText } = require('./rbac');
const { resolveUserDisplayName } = require('./users');
const { createHttpError } = require('./util');

const PROJECT_AREA_VALUES = ['Marketing', 'Microfabrica', 'Almacen', 'Desarrollo', 'Ventas'];

const PROJECT_TASK_TYPE_VALUES = ['rutina', 'mejora', 'rutina_mejora'];

const PROJECT_TASK_STATUS_VALUES = ['pendiente', 'en_progreso', 'completada', 'bloqueada'];

const PROJECT_VERSION_BUMP_VALUES = ['none', 'patch', 'minor', 'major'];

const normalizeProjectArea = (value = '') => {
  const normalized = normalizeText(value);
  const map = {
    marketing: 'Marketing',
    microfabrica: 'Microfabrica',
    'micro fabrica': 'Microfabrica',
    almacen: 'Almacen',
    storage: 'Almacen',
    desarrollo: 'Desarrollo',
    development: 'Desarrollo',
    ventas: 'Ventas',
    sales: 'Ventas'
  };
  return map[normalized] || null;
};

const normalizeProjectTaskType = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  const map = {
    rutina: 'rutina',
    routine: 'rutina',
    mejora: 'mejora',
    improvement: 'mejora',
    rutina_mejora: 'rutina_mejora',
    rutina_con_mejora: 'rutina_mejora',
    rutina_y_mejora: 'rutina_mejora',
    routine_improvement: 'rutina_mejora',
    routine_and_improvement: 'rutina_mejora'
  };
  return map[normalized] || null;
};

const normalizeProjectTaskStatus = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  const map = {
    pendiente: 'pendiente',
    pending: 'pendiente',
    en_progreso: 'en_progreso',
    progreso: 'en_progreso',
    in_progress: 'en_progreso',
    completada: 'completada',
    completado: 'completada',
    completed: 'completada',
    done: 'completada',
    bloqueada: 'bloqueada',
    bloqueado: 'bloqueada',
    blocked: 'bloqueada'
  };
  return map[normalized] || null;
};

const normalizeProjectVersionBump = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  const map = {
    none: 'none',
    ninguna: 'none',
    no: 'none',
    patch: 'patch',
    correccion: 'patch',
    correction: 'patch',
    minor: 'minor',
    menor: 'minor',
    major: 'major',
    mayor: 'major'
  };
  return map[normalized] || null;
};

const normalizeProjectDateInput = (value, fieldLabel) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const dateText = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw createHttpError(400, `${fieldLabel} inválida. Usa formato YYYY-MM-DD`);
  }
  return dateText;
};

const bumpSemver = (currentVersion, bumpType) => {
  const current = {
    major: Math.max(0, Number.parseInt(currentVersion?.major, 10) || 0),
    minor: Math.max(0, Number.parseInt(currentVersion?.minor, 10) || 0),
    patch: Math.max(0, Number.parseInt(currentVersion?.patch, 10) || 0)
  };
  if (bumpType === 'major') {
    return { major: current.major + 1, minor: 0, patch: 0 };
  }
  if (bumpType === 'minor') {
    return { major: current.major, minor: current.minor + 1, patch: 0 };
  }
  if (bumpType === 'patch') {
    return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  }
  return current;
};

const ensureProjectsTables = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS projects (
       id BIGSERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       description TEXT,
       area TEXT NOT NULL,
       work_type TEXT NOT NULL DEFAULT 'rutina_mejora',
       version_major INTEGER NOT NULL DEFAULT 1,
       version_minor INTEGER NOT NULL DEFAULT 0,
       version_patch INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       is_active BOOLEAN NOT NULL DEFAULT TRUE
     )`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS name TEXT`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS description TEXT`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS area TEXT`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS work_type TEXT NOT NULL DEFAULT 'rutina_mejora'`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_major INTEGER NOT NULL DEFAULT 1`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_minor INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_patch INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_projects_area_active
     ON projects (LOWER(area), is_active, updated_at DESC)`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_tasks (
       id BIGSERIAL PRIMARY KEY,
       project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       description TEXT,
       assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       start_date DATE,
       due_date DATE,
       status TEXT NOT NULL DEFAULT 'pendiente',
       progress_percent INTEGER NOT NULL DEFAULT 0,
       task_type TEXT NOT NULL DEFAULT 'rutina',
       version_bump TEXT NOT NULL DEFAULT 'none',
       version_applied BOOLEAN NOT NULL DEFAULT FALSE,
       cost NUMERIC(12,2),
       created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     )`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS title TEXT`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS description TEXT`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS start_date DATE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS due_date DATE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendiente'`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'rutina'`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS version_bump TEXT NOT NULL DEFAULT 'none'`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS version_applied BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS cost NUMERIC(12,2)`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_tasks_project
     ON project_tasks (project_id, updated_at DESC, id DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee
     ON project_tasks (assignee_user_id, status, due_date)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_tasks_dates
     ON project_tasks (start_date, due_date)`
  );
};

const formatProjectVersion = (row = {}) => {
  const major = Math.max(0, Number.parseInt(row.version_major, 10) || 0);
  const minor = Math.max(0, Number.parseInt(row.version_minor, 10) || 0);
  const patch = Math.max(0, Number.parseInt(row.version_patch, 10) || 0);
  return `${major}.${minor}.${patch}`;
};

const normalizeProjectDateOutput = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const mapProjectRow = (row = {}) => ({
  id: Number(row.id),
  name: String(row.name || '').trim(),
  description: row.description || null,
  area: normalizeProjectArea(row.area || '') || String(row.area || '').trim(),
  work_type: normalizeProjectTaskType(row.work_type || '') || 'rutina_mejora',
  version_major: Math.max(0, Number.parseInt(row.version_major, 10) || 0),
  version_minor: Math.max(0, Number.parseInt(row.version_minor, 10) || 0),
  version_patch: Math.max(0, Number.parseInt(row.version_patch, 10) || 0),
  version: formatProjectVersion(row),
  created_by: row.created_by !== null && row.created_by !== undefined ? Number(row.created_by) : null,
  created_by_name: resolveUserDisplayName({ display_name: row.created_by_name, email: row.created_by_email }, 'Usuario'),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  is_active: row.is_active !== false
});

const mapProjectTaskRow = (row = {}) => ({
  id: Number(row.id),
  project_id: Number(row.project_id),
  project_name: String(row.project_name || '').trim(),
  project_area: normalizeProjectArea(row.project_area || '') || String(row.project_area || '').trim(),
  title: String(row.title || '').trim(),
  description: row.description || null,
  assignee_user_id: row.assignee_user_id !== null && row.assignee_user_id !== undefined
    ? Number(row.assignee_user_id)
    : null,
  assignee_name: row.assignee_user_id
    ? resolveUserDisplayName({ display_name: row.assignee_name, email: row.assignee_email }, 'Sin asignar')
    : 'Sin asignar',
  start_date: normalizeProjectDateOutput(row.start_date),
  due_date: normalizeProjectDateOutput(row.due_date),
  status: normalizeProjectTaskStatus(row.status || '') || 'pendiente',
  progress_percent: Math.max(0, Math.min(100, Number.parseInt(row.progress_percent, 10) || 0)),
  task_type: normalizeProjectTaskType(row.task_type || '') || 'rutina',
  version_bump: normalizeProjectVersionBump(row.version_bump || '') || 'none',
  version_applied: Boolean(row.version_applied),
  cost: row.cost !== null && row.cost !== undefined ? Number(row.cost) : null,
  created_by: row.created_by !== null && row.created_by !== undefined ? Number(row.created_by) : null,
  created_by_name: resolveUserDisplayName({ display_name: row.created_by_name, email: row.created_by_email }, 'Usuario'),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

const getProjectsAccessScope = (userContext, access) => {
  const hasProjectsPanel = Boolean(access?.proyectos_panel);
  if (!userContext?.id) {
    return { error: 'Usuario no encontrado' };
  }
  if (!hasProjectsPanel) {
    return { error: 'No tienes permiso para proyectos' };
  }
  return { allowed: true };
};

const normalizeProjectPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  const normalized = {};

  if (!partial || has('name')) {
    const name = String(src.name || '').trim();
    if (!name) throw createHttpError(400, 'Nombre del proyecto requerido');
    if (name.length > 140) throw createHttpError(400, 'Nombre del proyecto demasiado largo (máx 140)');
    normalized.name = name;
  }

  if (!partial || has('description')) {
    const description = String(src.description || '').trim();
    if (description.length > 2000) throw createHttpError(400, 'Descripción demasiado larga (máx 2000)');
    normalized.description = description || null;
  }

  if (!partial || has('area')) {
    const area = normalizeProjectArea(src.area || '');
    if (!area) {
      throw createHttpError(400, `Área inválida. Usa: ${PROJECT_AREA_VALUES.join(', ')}`);
    }
    normalized.area = area;
  }

  if (!partial || has('work_type')) {
    const workType = normalizeProjectTaskType(src.work_type || src.type || 'rutina_mejora');
    if (!workType) {
      throw createHttpError(400, 'Tipo de proyecto inválido. Usa: rutina, mejora o rutina_mejora');
    }
    normalized.work_type = workType;
  }

  const versionKeys = ['version_major', 'version_minor', 'version_patch'];
  const hasVersionOverride = versionKeys.some((key) => has(key));
  if (!partial || hasVersionOverride) {
    const major = Number.parseInt(src.version_major ?? 1, 10);
    const minor = Number.parseInt(src.version_minor ?? 0, 10);
    const patch = Number.parseInt(src.version_patch ?? 0, 10);
    if (![major, minor, patch].every((value) => Number.isInteger(value) && value >= 0 && value <= 9999)) {
      throw createHttpError(400, 'Versión inválida. Usa números enteros entre 0 y 9999');
    }
    normalized.version_major = major;
    normalized.version_minor = minor;
    normalized.version_patch = patch;
  }

  return normalized;
};

const normalizeProjectTaskPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  const normalized = {};

  if (!partial || has('title')) {
    const title = String(src.title || '').trim();
    if (!title) throw createHttpError(400, 'Título de la tarea requerido');
    if (title.length > 180) throw createHttpError(400, 'Título de la tarea demasiado largo (máx 180)');
    normalized.title = title;
  }

  if (!partial || has('description')) {
    const description = String(src.description || '').trim();
    if (description.length > 2500) throw createHttpError(400, 'Descripción de la tarea demasiado larga (máx 2500)');
    normalized.description = description || null;
  }

  if (!partial || has('assignee_user_id')) {
    const rawAssignee = src.assignee_user_id;
    if (rawAssignee === null || rawAssignee === '' || rawAssignee === undefined) {
      normalized.assignee_user_id = null;
    } else {
      const assigneeId = Number.parseInt(rawAssignee, 10);
      if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
        throw createHttpError(400, 'Usuario asignado inválido');
      }
      normalized.assignee_user_id = assigneeId;
    }
  }

  if (!partial || has('start_date')) {
    normalized.start_date = normalizeProjectDateInput(src.start_date, 'Fecha de inicio');
  }

  if (!partial || has('due_date')) {
    normalized.due_date = normalizeProjectDateInput(src.due_date, 'Fecha de entrega');
  }

  const effectiveStart = Object.prototype.hasOwnProperty.call(normalized, 'start_date') ? normalized.start_date : null;
  const effectiveDue = Object.prototype.hasOwnProperty.call(normalized, 'due_date') ? normalized.due_date : null;
  if (effectiveStart && effectiveDue && effectiveDue < effectiveStart) {
    throw createHttpError(400, 'La fecha de entrega no puede ser menor a la fecha de inicio');
  }

  if (!partial || has('status')) {
    const status = normalizeProjectTaskStatus(src.status || 'pendiente');
    if (!status) {
      throw createHttpError(400, `Estado inválido. Usa: ${PROJECT_TASK_STATUS_VALUES.join(', ')}`);
    }
    normalized.status = status;
  }

  if (!partial || has('progress_percent') || has('progress')) {
    const rawProgress = src.progress_percent ?? src.progress ?? 0;
    const progress = Number.parseInt(rawProgress, 10);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw createHttpError(400, 'Progreso inválido. Usa un número entero entre 0 y 100');
    }
    normalized.progress_percent = progress;
  }

  if (!partial || has('task_type') || has('type')) {
    const taskType = normalizeProjectTaskType(src.task_type || src.type || 'rutina');
    if (!taskType) {
      throw createHttpError(400, `Tipo de tarea inválido. Usa: ${PROJECT_TASK_TYPE_VALUES.join(', ')}`);
    }
    normalized.task_type = taskType;
  }

  if (!partial || has('version_bump') || has('version_change')) {
    const versionBump = normalizeProjectVersionBump(src.version_bump || src.version_change || 'none');
    if (!versionBump) {
      throw createHttpError(400, `Cambio de versión inválido. Usa: ${PROJECT_VERSION_BUMP_VALUES.join(', ')}`);
    }
    normalized.version_bump = versionBump;
  }

  if (!partial || has('cost')) {
    const rawCost = src.cost;
    if (rawCost === '' || rawCost === null || rawCost === undefined) {
      normalized.cost = null;
    } else {
      const cost = Number(rawCost);
      if (!Number.isFinite(cost) || cost < 0 || cost > 1000000000) {
        throw createHttpError(400, 'Costo inválido. Debe ser un número entre 0 y 1000000000');
      }
      normalized.cost = Number(cost.toFixed(2));
    }
  }

  const effectiveStatus = Object.prototype.hasOwnProperty.call(normalized, 'status')
    ? normalized.status
    : null;
  if (effectiveStatus === 'completada') {
    normalized.progress_percent = 100;
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'progress_percent')
    && normalized.progress_percent === 100
    && !Object.prototype.hasOwnProperty.call(normalized, 'status')
    && !partial) {
    normalized.status = 'completada';
  }

  return normalized;
};

const maybeApplyTaskVersionBump = async (client, taskRow) => {
  const status = normalizeProjectTaskStatus(taskRow?.status || '');
  const bumpType = normalizeProjectVersionBump(taskRow?.version_bump || '');
  const alreadyApplied = Boolean(taskRow?.version_applied);
  if (status !== 'completada' || !bumpType || bumpType === 'none' || alreadyApplied) {
    return null;
  }

  const projectRes = await client.query(
    `SELECT id, version_major, version_minor, version_patch
     FROM projects
     WHERE id = $1
       AND is_active = TRUE
     FOR UPDATE`,
    [taskRow.project_id]
  );
  if (projectRes.rowCount === 0) {
    throw createHttpError(404, 'Proyecto no encontrado');
  }
  const current = projectRes.rows[0];
  const nextVersion = bumpSemver(
    {
      major: current.version_major,
      minor: current.version_minor,
      patch: current.version_patch
    },
    bumpType
  );
  await client.query(
    `UPDATE projects
     SET version_major = $1,
         version_minor = $2,
         version_patch = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [nextVersion.major, nextVersion.minor, nextVersion.patch, taskRow.project_id]
  );
  await client.query(
    `UPDATE project_tasks
     SET version_applied = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [taskRow.id]
  );
  return nextVersion;
};

module.exports = {
  PROJECT_AREA_VALUES,
  PROJECT_TASK_STATUS_VALUES,
  PROJECT_TASK_TYPE_VALUES,
  PROJECT_VERSION_BUMP_VALUES,
  bumpSemver,
  ensureProjectsTables,
  formatProjectVersion,
  getProjectsAccessScope,
  mapProjectRow,
  mapProjectTaskRow,
  maybeApplyTaskVersionBump,
  normalizeProjectArea,
  normalizeProjectDateInput,
  normalizeProjectDateOutput,
  normalizeProjectPayload,
  normalizeProjectTaskPayload,
  normalizeProjectTaskStatus,
  normalizeProjectTaskType,
  normalizeProjectVersionBump
};
