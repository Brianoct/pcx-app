import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const AREA_OPTIONS_FALLBACK = ['Marketing', 'Microfabrica', 'Almacen', 'Desarrollo', 'Ventas'];
const TASK_TYPE_LABELS = {
  rutina: 'Rutina',
  mejora: 'Mejora',
  rutina_mejora: 'Rutina + Mejora'
};
const STATUS_LABELS = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completada: 'Completada',
  bloqueada: 'Bloqueada'
};
const VERSION_BUMP_LABELS = {
  none: 'Sin cambio',
  patch: 'Patch',
  minor: 'Minor',
  major: 'Major'
};
const STATUS_COLORS = {
  pendiente: '#f59e0b',
  en_progreso: '#2563eb',
  completada: '#10b981',
  bloqueada: '#ef4444'
};
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WINDOW_BG = '#f8fafc';
const CARD_BG = '#ffffff';
const CARD_BORDER = '#dbe4ee';
const TEXT_DARK = '#0f172a';
const TEXT_MUTED = '#64748b';
const PRIMARY = '#1d4ed8';
const ACCENT = '#0ea5e9';

const toDateText = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getCalendarGrid = (monthCursor) => {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    cells.push(day);
  }
  return cells;
};

const parseMoney = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Number(amount.toFixed(2));
};

const moneyFormatter = new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export default function ProjectsPanel({ token, user }) {
  const [loading, setLoading] = useState(true);
  const [savingProject, setSavingProject] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskDrafts, setTaskDrafts] = useState({});
  const [currentUserId, setCurrentUserId] = useState(null);
  const [areas, setAreas] = useState(AREA_OPTIONS_FALLBACK);
  const [taskTypeValues, setTaskTypeValues] = useState(['rutina', 'mejora', 'rutina_mejora']);
  const [statusValues, setStatusValues] = useState(['pendiente', 'en_progreso', 'completada', 'bloqueada']);
  const [versionBumpValues, setVersionBumpValues] = useState(['none', 'patch', 'minor', 'major']);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [viewScope, setViewScope] = useState('all');
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => toDateText(new Date()));
  const [projectForm, setProjectForm] = useState({
    name: '',
    description: '',
    area: AREA_OPTIONS_FALLBACK[0],
    work_type: 'rutina_mejora',
    version_major: 1,
    version_minor: 0,
    version_patch: 0
  });
  const [taskForm, setTaskForm] = useState({
    project_id: '',
    title: '',
    description: '',
    assignee_user_id: '',
    start_date: '',
    due_date: '',
    status: 'pendiente',
    progress_percent: 0,
    task_type: 'rutina',
    version_bump: 'none',
    cost: ''
  });

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardData, usersData] = await Promise.all([
        apiRequest('/api/projects/dashboard', { token }),
        apiRequest('/api/projects/users', { token })
      ]);
      const nextProjects = Array.isArray(dashboardData?.projects) ? dashboardData.projects : [];
      const nextTasks = Array.isArray(dashboardData?.tasks) ? dashboardData.tasks : [];
      const nextAreas = Array.isArray(dashboardData?.areas) && dashboardData.areas.length > 0
        ? dashboardData.areas
        : AREA_OPTIONS_FALLBACK;
      setProjects(nextProjects);
      setTasks(nextTasks);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setAreas(nextAreas);
      setTaskTypeValues(Array.isArray(dashboardData?.task_type_values) && dashboardData.task_type_values.length > 0
        ? dashboardData.task_type_values
        : ['rutina', 'mejora', 'rutina_mejora']);
      setStatusValues(Array.isArray(dashboardData?.task_status_values) && dashboardData.task_status_values.length > 0
        ? dashboardData.task_status_values
        : ['pendiente', 'en_progreso', 'completada', 'bloqueada']);
      setVersionBumpValues(Array.isArray(dashboardData?.version_bump_values) && dashboardData.version_bump_values.length > 0
        ? dashboardData.version_bump_values
        : ['none', 'patch', 'minor', 'major']);
      setCurrentUserId(Number(dashboardData?.current_user_id || user?.id || 0) || null);
      setProjectForm((prev) => ({
        ...prev,
        area: nextAreas.includes(prev.area) ? prev.area : nextAreas[0]
      }));
      setTaskDrafts(
        Object.fromEntries(
          nextTasks.map((task) => [
            task.id,
            {
              status: task.status || 'pendiente',
              progress_percent: Number(task.progress_percent || 0),
              cost: task.cost ?? ''
            }
          ])
        )
      );
      if (nextProjects.length > 0) {
        const existing = nextProjects.find((project) => String(project.id) === String(selectedProjectId));
        const fallbackProjectId = existing ? String(existing.id) : String(nextProjects[0].id);
        setSelectedProjectId(fallbackProjectId);
        setTaskForm((prev) => ({
          ...prev,
          project_id: prev.project_id || fallbackProjectId
        }));
      } else {
        setSelectedProjectId('');
        setTaskForm((prev) => ({ ...prev, project_id: '' }));
      }
    } catch (err) {
      setError(err.message || 'No se pudo cargar el módulo de proyectos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [token]);

  const myProjects = useMemo(
    () => projects.filter((project) => project.is_working_on),
    [projects]
  );

  const visibleTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const aDate = a.due_date || a.start_date || '';
      const bDate = b.due_date || b.start_date || '';
      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' });
    });
    if (viewScope === 'all') return sorted;
    return sorted.filter((task) => task.assignee_user_id === currentUserId || task.created_by === currentUserId);
  }, [tasks, viewScope, currentUserId]);

  const tasksSummary = useMemo(() => {
    const base = {
      total: visibleTasks.length,
      completed: 0,
      pending: 0,
      in_progress: 0,
      blocked: 0,
      avgProgress: 0
    };
    if (visibleTasks.length === 0) return base;
    let progressSum = 0;
    for (const task of visibleTasks) {
      progressSum += Number(task.progress_percent || 0);
      if (task.status === 'completada') base.completed += 1;
      if (task.status === 'pendiente') base.pending += 1;
      if (task.status === 'en_progreso') base.in_progress += 1;
      if (task.status === 'bloqueada') base.blocked += 1;
    }
    base.avgProgress = Math.round(progressSum / visibleTasks.length);
    return base;
  }, [visibleTasks]);

  const calendarCells = useMemo(() => getCalendarGrid(monthCursor), [monthCursor]);

  const tasksByDate = useMemo(() => {
    const map = new Map();
    const pushTask = (dateText, task) => {
      if (!dateText) return;
      if (!map.has(dateText)) map.set(dateText, []);
      map.get(dateText).push(task);
    };
    for (const task of visibleTasks) {
      const startDate = task.start_date || task.due_date || null;
      const dueDate = task.due_date || task.start_date || null;
      if (!startDate && !dueDate) continue;
      if (startDate && dueDate && startDate <= dueDate) {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${dueDate}T00:00:00`);
        let guard = 0;
        for (let cursor = new Date(start); cursor <= end && guard < 370; cursor.setDate(cursor.getDate() + 1)) {
          guard += 1;
          pushTask(toDateText(cursor), task);
        }
      } else {
        pushTask(startDate || dueDate, task);
      }
    }
    for (const [key, value] of map.entries()) {
      value.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' }));
      map.set(key, value);
    }
    return map;
  }, [visibleTasks]);

  const selectedDateTasks = useMemo(
    () => tasksByDate.get(selectedDate) || [],
    [tasksByDate, selectedDate]
  );

  const submitProject = async (event) => {
    event.preventDefault();
    if (!projectForm.name.trim()) {
      setError('Escribe un nombre para el proyecto');
      return;
    }
    setSavingProject(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/projects', {
        method: 'POST',
        token,
        body: {
          ...projectForm,
          name: projectForm.name.trim(),
          description: projectForm.description.trim(),
          version_major: Number(projectForm.version_major || 0),
          version_minor: Number(projectForm.version_minor || 0),
          version_patch: Number(projectForm.version_patch || 0)
        }
      });
      setNotice('Proyecto creado correctamente');
      setProjectForm((prev) => ({
        ...prev,
        name: '',
        description: '',
        version_major: 1,
        version_minor: 0,
        version_patch: 0
      }));
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'No se pudo crear el proyecto');
    } finally {
      setSavingProject(false);
    }
  };

  const submitTask = async (event) => {
    event.preventDefault();
    const projectId = Number.parseInt(taskForm.project_id || selectedProjectId, 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setError('Selecciona un proyecto para crear la tarea');
      return;
    }
    if (!taskForm.title.trim()) {
      setError('Escribe un título para la tarea');
      return;
    }
    setSavingTask(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        token,
        body: {
          title: taskForm.title.trim(),
          description: taskForm.description.trim() || null,
          assignee_user_id: taskForm.assignee_user_id ? Number(taskForm.assignee_user_id) : null,
          start_date: taskForm.start_date || null,
          due_date: taskForm.due_date || null,
          status: taskForm.status,
          progress_percent: Number(taskForm.progress_percent || 0),
          task_type: taskForm.task_type,
          version_bump: taskForm.version_bump,
          cost: parseMoney(taskForm.cost)
        }
      });
      setNotice('Tarea creada correctamente');
      setTaskForm((prev) => ({
        ...prev,
        title: '',
        description: '',
        assignee_user_id: '',
        start_date: '',
        due_date: '',
        status: 'pendiente',
        progress_percent: 0,
        task_type: 'rutina',
        version_bump: 'none',
        cost: ''
      }));
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'No se pudo crear la tarea');
    } finally {
      setSavingTask(false);
    }
  };

  const saveTaskDraft = async (task) => {
    const draft = taskDrafts[task.id];
    if (!draft) return;
    setUpdatingTaskId(task.id);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/projects/tasks/${task.id}`, {
        method: 'PATCH',
        token,
        body: {
          status: draft.status,
          progress_percent: Number(draft.progress_percent || 0),
          cost: parseMoney(draft.cost)
        }
      });
      setNotice(`Tarea "${task.title}" actualizada`);
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la tarea');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const panelStyle = {
    background: WINDOW_BG,
    border: `1px solid ${CARD_BORDER}`,
    borderRadius: '14px',
    boxShadow: '0 14px 30px rgba(15, 23, 42, 0.1)',
    padding: '14px',
    display: 'grid',
    gap: '12px',
    alignContent: 'start'
  };

  return (
    <div className="container" style={{ color: TEXT_DARK }}>
      <h2 style={{ textAlign: 'center', margin: '18px 0', color: '#f87171' }}>Proyectos y Tareas</h2>
      <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '14px' }}>
        Vista colaborativa para toda la empresa. Puedes crear proyectos por área, asignar tareas con costo y seguimiento por calendario.
      </p>

      {(error || notice) && (
        <div
          className="card"
          style={{
            border: `1px solid ${error ? '#ef4444' : '#16a34a'}`,
            background: error ? 'rgba(127,29,29,0.35)' : 'rgba(16,185,129,0.16)',
            color: error ? '#fecaca' : '#bbf7d0'
          }}
        >
          {error || notice}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
          alignItems: 'start'
        }}
      >
        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: TEXT_DARK }}>1) Proyectos activos</h3>
            <span style={{ color: TEXT_MUTED, fontSize: '0.86rem' }}>Liderado por áreas y versiones</span>
          </div>

          <form onSubmit={submitProject} style={{ display: 'grid', gap: '8px' }}>
            <input
              type="text"
              value={projectForm.name}
              onChange={(event) => setProjectForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Nombre del proyecto"
              style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
            />
            <textarea
              rows={2}
              value={projectForm.description}
              onChange={(event) => setProjectForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Descripción / objetivo"
              style={{ borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
              <select
                value={projectForm.area}
                onChange={(event) => setProjectForm((prev) => ({ ...prev, area: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              >
                {areas.map((area) => <option key={area} value={area}>{area}</option>)}
              </select>
              <select
                value={projectForm.work_type}
                onChange={(event) => setProjectForm((prev) => ({ ...prev, work_type: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              >
                {taskTypeValues.map((type) => (
                  <option key={type} value={type}>{TASK_TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
              <input
                type="number"
                min="0"
                value={projectForm.version_major}
                onChange={(event) => setProjectForm((prev) => ({ ...prev, version_major: event.target.value }))}
                placeholder="Major"
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
              <input
                type="number"
                min="0"
                value={projectForm.version_minor}
                onChange={(event) => setProjectForm((prev) => ({ ...prev, version_minor: event.target.value }))}
                placeholder="Minor"
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
              <input
                type="number"
                min="0"
                value={projectForm.version_patch}
                onChange={(event) => setProjectForm((prev) => ({ ...prev, version_patch: event.target.value }))}
                placeholder="Patch"
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
            </div>
            <button type="submit" className="btn" disabled={savingProject} style={{ background: PRIMARY, color: 'white' }}>
              {savingProject ? 'Creando...' : 'Crear proyecto'}
            </button>
          </form>

          <div style={{ height: '1px', background: CARD_BORDER, margin: '2px 0' }} />

          <form onSubmit={submitTask} style={{ display: 'grid', gap: '8px' }}>
            <h4 style={{ margin: 0, color: TEXT_DARK }}>Crear tarea</h4>
            <select
              value={taskForm.project_id || selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                setTaskForm((prev) => ({ ...prev, project_id: event.target.value }));
              }}
              style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
            >
              <option value="" disabled>Selecciona proyecto</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name} · v{project.version}</option>
              ))}
            </select>
            <input
              type="text"
              value={taskForm.title}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Título de tarea"
              style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
            />
            <textarea
              rows={2}
              value={taskForm.description}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Detalle de tarea"
              style={{ borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
              <select
                value={taskForm.assignee_user_id}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, assignee_user_id: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              >
                <option value="">Sin asignar</option>
                {users.map((row) => (
                  <option key={row.id} value={row.id}>{row.display_name}</option>
                ))}
              </select>
              <select
                value={taskForm.task_type}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, task_type: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              >
                {taskTypeValues.map((type) => (
                  <option key={type} value={type}>{TASK_TYPE_LABELS[type] || type}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
              <input
                type="date"
                value={taskForm.start_date}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, start_date: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
              <input
                type="date"
                value={taskForm.due_date}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, due_date: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
              <select
                value={taskForm.status}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, status: event.target.value }))}
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              >
                {statusValues.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status] || status}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="100"
                value={taskForm.progress_percent}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, progress_percent: event.target.value }))}
                placeholder="%"
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={taskForm.cost}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, cost: event.target.value }))}
                placeholder="Costo Bs"
                style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
              />
            </div>
            <select
              value={taskForm.version_bump}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, version_bump: event.target.value }))}
              style={{ minHeight: '38px', borderRadius: '10px', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, color: TEXT_DARK, padding: '8px 10px' }}
            >
              {versionBumpValues.map((value) => (
                <option key={value} value={value}>{VERSION_BUMP_LABELS[value] || value}</option>
              ))}
            </select>
            <button type="submit" className="btn" disabled={savingTask || projects.length === 0} style={{ background: ACCENT, color: 'white' }}>
              {savingTask ? 'Guardando...' : 'Crear tarea'}
            </button>
          </form>

          <div style={{ height: '1px', background: CARD_BORDER, margin: '2px 0' }} />
          <h4 style={{ margin: 0, color: TEXT_DARK }}>Proyectos en los que trabajas ({myProjects.length})</h4>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
            {loading ? (
              <div style={{ color: TEXT_MUTED }}>Cargando proyectos...</div>
            ) : myProjects.length === 0 ? (
              <div style={{ color: TEXT_MUTED }}>Todavía no participas en proyectos.</div>
            ) : myProjects.map((project) => (
              <div key={project.id} style={{ border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', background: CARD_BG, padding: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                  <strong style={{ color: TEXT_DARK }}>{project.name}</strong>
                  <span style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>v{project.version}</span>
                </div>
                <div style={{ marginTop: '3px', fontSize: '0.82rem', color: TEXT_MUTED }}>
                  {project.area} · {TASK_TYPE_LABELS[project.work_type] || project.work_type}
                </div>
                <div style={{ marginTop: '7px', height: '7px', borderRadius: '999px', background: '#dbeafe', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, Number(project.progress_percent || 0)))}%`, height: '100%', background: '#2563eb' }} />
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.8rem', color: TEXT_MUTED }}>
                  {project.completed_tasks}/{project.total_tasks} tareas completadas · Costo {moneyFormatter.format(Number(project.total_cost || 0))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: TEXT_DARK }}>2) Avance de tareas</h3>
            <div style={{ display: 'inline-flex', border: `1px solid ${CARD_BORDER}`, borderRadius: '999px', overflow: 'hidden' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setViewScope('all')}
                style={viewScope === 'all'
                  ? { background: PRIMARY, color: 'white', border: 'none', borderRadius: 0 }
                  : { background: CARD_BG, color: TEXT_MUTED, border: 'none', borderRadius: 0 }}
              >
                Todo el equipo
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setViewScope('mine')}
                style={viewScope === 'mine'
                  ? { background: PRIMARY, color: 'white', border: 'none', borderRadius: 0 }
                  : { background: CARD_BG, color: TEXT_MUTED, border: 'none', borderRadius: 0 }}
              >
                Mis tareas
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
            <div style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', padding: '8px' }}>
              <div style={{ color: TEXT_MUTED, fontSize: '0.78rem' }}>Total</div>
              <strong style={{ color: TEXT_DARK }}>{tasksSummary.total}</strong>
            </div>
            <div style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', padding: '8px' }}>
              <div style={{ color: TEXT_MUTED, fontSize: '0.78rem' }}>Completadas</div>
              <strong style={{ color: '#10b981' }}>{tasksSummary.completed}</strong>
            </div>
            <div style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', padding: '8px' }}>
              <div style={{ color: TEXT_MUTED, fontSize: '0.78rem' }}>Progreso medio</div>
              <strong style={{ color: '#2563eb' }}>{tasksSummary.avgProgress}%</strong>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '8px', maxHeight: '640px', overflowY: 'auto', paddingRight: '4px' }}>
            {loading ? (
              <div style={{ color: TEXT_MUTED }}>Cargando tareas...</div>
            ) : visibleTasks.length === 0 ? (
              <div style={{ color: TEXT_MUTED }}>No hay tareas para esta vista.</div>
            ) : visibleTasks.map((task) => {
              const draft = taskDrafts[task.id] || {
                status: task.status,
                progress_percent: Number(task.progress_percent || 0),
                cost: task.cost ?? ''
              };
              return (
                <div key={task.id} style={{ border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', background: CARD_BG, padding: '10px', display: 'grid', gap: '7px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ color: TEXT_DARK }}>{task.title}</strong>
                    <span style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>{task.project_name}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem', color: TEXT_MUTED }}>
                    <span>Responsable: {task.assignee_name}</span>
                    <span>Entrega: {formatDate(task.due_date)}</span>
                    <span>Costo: {task.cost !== null ? moneyFormatter.format(Number(task.cost || 0)) : '—'}</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '999px', background: '#dbeafe', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, Number(task.progress_percent || 0)))}%`, height: '100%', background: STATUS_COLORS[task.status] || '#2563eb' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px auto', gap: '7px', alignItems: 'center' }}>
                    <select
                      value={draft.status}
                      onChange={(event) => setTaskDrafts((prev) => ({
                        ...prev,
                        [task.id]: { ...prev[task.id], status: event.target.value }
                      }))}
                      style={{ minHeight: '34px', borderRadius: '9px', border: `1px solid ${CARD_BORDER}`, background: '#fff', color: TEXT_DARK, padding: '6px 8px' }}
                    >
                      {statusValues.map((status) => (
                        <option key={status} value={status}>{STATUS_LABELS[status] || status}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={draft.progress_percent}
                      onChange={(event) => setTaskDrafts((prev) => ({
                        ...prev,
                        [task.id]: { ...prev[task.id], progress_percent: event.target.value }
                      }))}
                      style={{ minHeight: '34px', borderRadius: '9px', border: `1px solid ${CARD_BORDER}`, background: '#fff', color: TEXT_DARK, padding: '6px 8px' }}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.cost}
                      onChange={(event) => setTaskDrafts((prev) => ({
                        ...prev,
                        [task.id]: { ...prev[task.id], cost: event.target.value }
                      }))}
                      placeholder="Costo"
                      style={{ minHeight: '34px', borderRadius: '9px', border: `1px solid ${CARD_BORDER}`, background: '#fff', color: TEXT_DARK, padding: '6px 8px' }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => saveTaskDraft(task)}
                      disabled={updatingTaskId === task.id}
                      style={{ background: ACCENT, color: 'white', minHeight: '34px' }}
                    >
                      {updatingTaskId === task.id ? '...' : 'Guardar'}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: TEXT_MUTED }}>
                    Tipo: {TASK_TYPE_LABELS[task.task_type] || task.task_type} · Cambio versión: {VERSION_BUMP_LABELS[task.version_bump] || task.version_bump}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: TEXT_DARK }}>3) Calendario de tareas</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                style={{ background: '#e2e8f0', color: TEXT_DARK }}
              >
                ◀
              </button>
              <strong style={{ color: TEXT_DARK, minWidth: '150px', textAlign: 'center' }}>
                {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
              </strong>
              <button
                type="button"
                className="btn"
                onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                style={{ background: '#e2e8f0', color: TEXT_DARK }}
              >
                ▶
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px' }}>
            {DAY_LABELS.map((day) => (
              <div key={day} style={{ textAlign: 'center', color: TEXT_MUTED, fontWeight: 700, fontSize: '0.78rem' }}>{day}</div>
            ))}
            {calendarCells.map((day) => {
              const dateText = toDateText(day);
              const dayTasks = tasksByDate.get(dateText) || [];
              const isCurrentMonth = day.getMonth() === monthCursor.getMonth();
              const isSelected = dateText === selectedDate;
              return (
                <button
                  key={dateText}
                  type="button"
                  onClick={() => setSelectedDate(dateText)}
                  style={{
                    border: `1px solid ${isSelected ? '#60a5fa' : CARD_BORDER}`,
                    borderRadius: '10px',
                    background: isSelected ? '#dbeafe' : '#fff',
                    minHeight: '74px',
                    padding: '6px',
                    display: 'grid',
                    alignContent: 'start',
                    gap: '4px',
                    color: isCurrentMonth ? TEXT_DARK : '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>{day.getDate()}</div>
                  <div style={{ display: 'grid', gap: '2px' }}>
                    {dayTasks.slice(0, 2).map((task) => (
                      <div
                        key={`calendar-${dateText}-${task.id}`}
                        style={{
                          background: STATUS_COLORS[task.status] || PRIMARY,
                          color: 'white',
                          borderRadius: '999px',
                          padding: '1px 6px',
                          fontSize: '0.66rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {task.title}
                      </div>
                    ))}
                    {dayTasks.length > 2 && (
                      <div style={{ fontSize: '0.68rem', color: TEXT_MUTED }}>+{dayTasks.length - 2} más</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ height: '1px', background: CARD_BORDER }} />
          <h4 style={{ margin: 0, color: TEXT_DARK }}>Tareas del {formatDate(selectedDate)}</h4>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '290px', overflowY: 'auto', paddingRight: '4px' }}>
            {selectedDateTasks.length === 0 ? (
              <div style={{ color: TEXT_MUTED }}>No hay tareas en esta fecha.</div>
            ) : selectedDateTasks.map((task) => (
              <div key={`selected-${task.id}`} style={{ border: `1px solid ${CARD_BORDER}`, borderRadius: '10px', background: '#fff', padding: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <strong style={{ color: TEXT_DARK }}>{task.title}</strong>
                  <span style={{ color: TEXT_MUTED, fontSize: '0.76rem' }}>{task.project_name}</span>
                </div>
                <div style={{ color: TEXT_MUTED, fontSize: '0.78rem', marginTop: '3px' }}>
                  {task.assignee_name} · {STATUS_LABELS[task.status] || task.status}
                </div>
                <div style={{ marginTop: '6px', height: '7px', borderRadius: '999px', background: '#dbeafe', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, Number(task.progress_percent || 0)))}%`, height: '100%', background: STATUS_COLORS[task.status] || PRIMARY }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
