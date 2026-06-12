const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { PROJECT_AREA_VALUES, PROJECT_TASK_STATUS_VALUES, PROJECT_TASK_TYPE_VALUES, PROJECT_VERSION_BUMP_VALUES, ensureProjectsTables, getProjectsAccessScope, mapProjectRow, mapProjectTaskRow, maybeApplyTaskVersionBump, normalizeProjectPayload, normalizeProjectTaskPayload, normalizeProjectTaskStatus, normalizeProjectTaskType, normalizeProjectVersionBump } = require('../lib/projects');
const { sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext, resolveUserDisplayName } = require('../lib/users');
const { createHttpError } = require('../lib/util');

const router = express.Router();

// ─── PROJECTS / TASKS COLLABORATION ──────────────────────────────────────────
router.get('/api/projects/users', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const result = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE is_active = TRUE
       ORDER BY LOWER(COALESCE(display_name, email)) ASC`
    );
    res.json((result.rows || []).map((row) => ({
      id: Number(row.id),
      role: row.role || null,
      email: row.email || null,
      display_name: resolveUserDisplayName(row, 'Usuario')
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar usuarios para proyectos' });
  }
});

router.get('/api/projects/dashboard', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const [projectsRes, tasksRes] = await Promise.all([
      pool.query(
        `SELECT
           p.id, p.name, p.description, p.area, p.work_type,
           p.version_major, p.version_minor, p.version_patch,
           p.created_by, p.created_at, p.updated_at, p.is_active,
           u.email AS created_by_email,
           u.display_name AS created_by_name
         FROM projects p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.is_active = TRUE
         ORDER BY p.updated_at DESC, p.id DESC`
      ),
      pool.query(
        `SELECT
           t.id, t.project_id, t.title, t.description,
           t.assignee_user_id, t.start_date, t.due_date, t.status,
           t.progress_percent, t.task_type, t.version_bump, t.version_applied,
           t.cost, t.created_by, t.created_at, t.updated_at,
           p.name AS project_name,
           p.area AS project_area,
           au.email AS assignee_email,
           au.display_name AS assignee_name,
           cu.email AS created_by_email,
           cu.display_name AS created_by_name
         FROM project_tasks t
         INNER JOIN projects p ON p.id = t.project_id
         LEFT JOIN users au ON au.id = t.assignee_user_id
         LEFT JOIN users cu ON cu.id = t.created_by
         WHERE p.is_active = TRUE
         ORDER BY COALESCE(t.due_date, t.start_date) ASC NULLS LAST, t.updated_at DESC, t.id DESC`
      )
    ]);

    const projects = (projectsRes.rows || []).map((row) => mapProjectRow(row));
    const tasks = (tasksRes.rows || []).map((row) => mapProjectTaskRow(row));
    const summaryByProjectId = new Map(
      projects.map((project) => [project.id, {
        total_tasks: 0,
        completed_tasks: 0,
        pending_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        progress_sum: 0,
        total_cost: 0
      }])
    );
    const myProjectIds = new Set();
    for (const project of projects) {
      if (project.created_by === req.user.id) {
        myProjectIds.add(project.id);
      }
    }
    for (const task of tasks) {
      const summary = summaryByProjectId.get(task.project_id);
      if (summary) {
        summary.total_tasks += 1;
        summary.progress_sum += Number(task.progress_percent || 0);
        summary.total_cost += Number(task.cost || 0);
        if (task.status === 'completada') summary.completed_tasks += 1;
        if (task.status === 'pendiente') summary.pending_tasks += 1;
        if (task.status === 'en_progreso') summary.in_progress_tasks += 1;
        if (task.status === 'bloqueada') summary.blocked_tasks += 1;
      }
      if (task.assignee_user_id === req.user.id) {
        myProjectIds.add(task.project_id);
      }
    }

    const projectsWithSummary = projects.map((project) => {
      const summary = summaryByProjectId.get(project.id) || {
        total_tasks: 0,
        completed_tasks: 0,
        pending_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        progress_sum: 0,
        total_cost: 0
      };
      const progressPercent = summary.total_tasks > 0
        ? Math.round(summary.progress_sum / summary.total_tasks)
        : 0;
      return {
        ...project,
        ...summary,
        progress_percent: progressPercent,
        is_working_on: myProjectIds.has(project.id)
      };
    });

    res.json({
      current_user_id: Number(req.user.id),
      areas: PROJECT_AREA_VALUES,
      task_type_values: PROJECT_TASK_TYPE_VALUES,
      task_status_values: PROJECT_TASK_STATUS_VALUES,
      version_bump_values: PROJECT_VERSION_BUMP_VALUES,
      projects: projectsWithSummary,
      tasks
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el tablero de proyectos' });
  }
});

router.post('/api/projects', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const normalized = normalizeProjectPayload(req.body || {}, { partial: false });
    const result = await pool.query(
      `INSERT INTO projects (
         name, description, area, work_type,
         version_major, version_minor, version_patch,
         created_by, created_at, updated_at, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), TRUE)
       RETURNING id, name, description, area, work_type, version_major, version_minor, version_patch,
                 created_by, created_at, updated_at, is_active`,
      [
        normalized.name,
        normalized.description,
        normalized.area,
        normalized.work_type,
        normalized.version_major,
        normalized.version_minor,
        normalized.version_patch,
        req.user.id
      ]
    );
    const created = mapProjectRow(result.rows[0] || {});
    res.status(201).json({ message: 'Proyecto creado', project: created });
  } catch (err) {
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo crear el proyecto' });
  }
});

router.post('/api/projects/:projectId/tasks', authenticateToken, async (req, res) => {
  const projectId = Number.parseInt(req.params.projectId, 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Proyecto inválido' });
  }

  const client = await pool.connect();
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const normalized = normalizeProjectTaskPayload(req.body || {}, { partial: false });
    await client.query('BEGIN');
    const projectRes = await client.query(
      `SELECT id
       FROM projects
       WHERE id = $1
         AND is_active = TRUE
       FOR UPDATE`,
      [projectId]
    );
    if (projectRes.rowCount === 0) {
      throw createHttpError(404, 'Proyecto no encontrado');
    }
    if (normalized.assignee_user_id) {
      const assigneeRes = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND is_active = TRUE`,
        [normalized.assignee_user_id]
      );
      if (assigneeRes.rowCount === 0) {
        throw createHttpError(400, 'Usuario asignado no encontrado o desactivado');
      }
    }

    const insertRes = await client.query(
      `INSERT INTO project_tasks (
         project_id, title, description, assignee_user_id, start_date, due_date,
         status, progress_percent, task_type, version_bump, version_applied, cost, created_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, $12, NOW(), NOW())
       RETURNING id, project_id, title, description, assignee_user_id, start_date, due_date,
                 status, progress_percent, task_type, version_bump, version_applied, cost, created_by, created_at, updated_at`,
      [
        projectId,
        normalized.title,
        normalized.description,
        normalized.assignee_user_id,
        normalized.start_date,
        normalized.due_date,
        normalized.status,
        normalized.progress_percent,
        normalized.task_type,
        normalized.version_bump,
        normalized.cost,
        req.user.id
      ]
    );
    await maybeApplyTaskVersionBump(client, insertRes.rows[0]);
    const taskId = Number(insertRes.rows[0]?.id || 0);
    const taskRes = await client.query(
      `SELECT
         t.id, t.project_id, t.title, t.description,
         t.assignee_user_id, t.start_date, t.due_date, t.status,
         t.progress_percent, t.task_type, t.version_bump, t.version_applied,
         t.cost, t.created_by, t.created_at, t.updated_at,
         p.name AS project_name,
         p.area AS project_area,
         au.email AS assignee_email,
         au.display_name AS assignee_name,
         cu.email AS created_by_email,
         cu.display_name AS created_by_name
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN users au ON au.id = t.assignee_user_id
       LEFT JOIN users cu ON cu.id = t.created_by
       WHERE t.id = $1`,
      [taskId]
    );
    await client.query('COMMIT');
    res.status(201).json({
      message: 'Tarea creada',
      task: mapProjectTaskRow(taskRes.rows[0] || {})
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo crear la tarea' });
  } finally {
    client.release();
  }
});

router.delete('/api/projects/tasks/:taskId', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.taskId, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'Tarea inválida' });
  }

  const client = await pool.connect();
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    await client.query('BEGIN');
    const currentRes = await client.query(
      `SELECT t.id, t.title, t.project_id, p.is_active
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1
       FOR UPDATE`,
      [taskId]
    );
    if (currentRes.rowCount === 0) {
      throw createHttpError(404, 'Tarea no encontrada');
    }
    const current = currentRes.rows[0];
    if (current.is_active === false) {
      throw createHttpError(400, 'No se puede eliminar una tarea de un proyecto inactivo');
    }

    await client.query(
      `DELETE FROM project_tasks
       WHERE id = $1`,
      [taskId]
    );
    await client.query('COMMIT');
    res.json({
      message: 'Tarea eliminada',
      task_id: taskId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo eliminar la tarea' });
  } finally {
    client.release();
  }
});

router.patch('/api/projects/tasks/:taskId', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.taskId, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'Tarea inválida' });
  }

  const client = await pool.connect();
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const normalized = normalizeProjectTaskPayload(req.body || {}, { partial: true });
    if (Object.keys(normalized).length === 0) {
      throw createHttpError(400, 'No se enviaron cambios para la tarea');
    }

    await client.query('BEGIN');
    const currentRes = await client.query(
      `SELECT t.*, p.is_active
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1
       FOR UPDATE`,
      [taskId]
    );
    if (currentRes.rowCount === 0) {
      throw createHttpError(404, 'Tarea no encontrada');
    }
    const current = currentRes.rows[0];
    if (current.is_active === false) {
      throw createHttpError(400, 'No se puede actualizar una tarea de un proyecto inactivo');
    }

    if (Object.prototype.hasOwnProperty.call(normalized, 'assignee_user_id') && normalized.assignee_user_id) {
      const assigneeRes = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND is_active = TRUE`,
        [normalized.assignee_user_id]
      );
      if (assigneeRes.rowCount === 0) {
        throw createHttpError(400, 'Usuario asignado no encontrado o desactivado');
      }
    }

    const nextStartDate = Object.prototype.hasOwnProperty.call(normalized, 'start_date')
      ? normalized.start_date
      : current.start_date;
    const nextDueDate = Object.prototype.hasOwnProperty.call(normalized, 'due_date')
      ? normalized.due_date
      : current.due_date;
    if (nextStartDate && nextDueDate && nextDueDate < nextStartDate) {
      throw createHttpError(400, 'La fecha de entrega no puede ser menor a la fecha de inicio');
    }

    let nextStatus = Object.prototype.hasOwnProperty.call(normalized, 'status')
      ? normalized.status
      : (normalizeProjectTaskStatus(current.status || '') || 'pendiente');
    let nextProgress = Object.prototype.hasOwnProperty.call(normalized, 'progress_percent')
      ? normalized.progress_percent
      : Math.max(0, Math.min(100, Number.parseInt(current.progress_percent, 10) || 0));
    if (nextStatus === 'completada') {
      nextProgress = 100;
    } else if (nextProgress === 100 && !Object.prototype.hasOwnProperty.call(normalized, 'status')) {
      nextStatus = 'completada';
    }

    const nextTask = {
      title: Object.prototype.hasOwnProperty.call(normalized, 'title') ? normalized.title : current.title,
      description: Object.prototype.hasOwnProperty.call(normalized, 'description') ? normalized.description : current.description,
      assignee_user_id: Object.prototype.hasOwnProperty.call(normalized, 'assignee_user_id')
        ? normalized.assignee_user_id
        : current.assignee_user_id,
      start_date: nextStartDate,
      due_date: nextDueDate,
      status: nextStatus,
      progress_percent: nextProgress,
      task_type: Object.prototype.hasOwnProperty.call(normalized, 'task_type')
        ? normalized.task_type
        : (normalizeProjectTaskType(current.task_type || '') || 'rutina'),
      version_bump: Object.prototype.hasOwnProperty.call(normalized, 'version_bump')
        ? normalized.version_bump
        : (normalizeProjectVersionBump(current.version_bump || '') || 'none'),
      cost: Object.prototype.hasOwnProperty.call(normalized, 'cost')
        ? normalized.cost
        : (current.cost !== null && current.cost !== undefined ? Number(current.cost) : null),
      version_applied: Boolean(current.version_applied)
    };

    const updateRes = await client.query(
      `UPDATE project_tasks
       SET title = $1,
           description = $2,
           assignee_user_id = $3,
           start_date = $4,
           due_date = $5,
           status = $6,
           progress_percent = $7,
           task_type = $8,
           version_bump = $9,
           cost = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING id, project_id, title, description, assignee_user_id, start_date, due_date,
                 status, progress_percent, task_type, version_bump, version_applied, cost, created_by, created_at, updated_at`,
      [
        nextTask.title,
        nextTask.description,
        nextTask.assignee_user_id,
        nextTask.start_date,
        nextTask.due_date,
        nextTask.status,
        nextTask.progress_percent,
        nextTask.task_type,
        nextTask.version_bump,
        nextTask.cost,
        taskId
      ]
    );
    const updatedTask = updateRes.rows[0];
    await maybeApplyTaskVersionBump(client, updatedTask);
    const taskRes = await client.query(
      `SELECT
         t.id, t.project_id, t.title, t.description,
         t.assignee_user_id, t.start_date, t.due_date, t.status,
         t.progress_percent, t.task_type, t.version_bump, t.version_applied,
         t.cost, t.created_by, t.created_at, t.updated_at,
         p.name AS project_name,
         p.area AS project_area,
         au.email AS assignee_email,
         au.display_name AS assignee_name,
         cu.email AS created_by_email,
         cu.display_name AS created_by_name
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN users au ON au.id = t.assignee_user_id
       LEFT JOIN users cu ON cu.id = t.created_by
       WHERE t.id = $1`,
      [taskId]
    );
    await client.query('COMMIT');
    res.json({
      message: 'Tarea actualizada',
      task: mapProjectTaskRow(taskRes.rows[0] || {})
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo actualizar la tarea' });
  } finally {
    client.release();
  }
});

module.exports = router;
