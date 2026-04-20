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
const PRIMARY = '#ff7f30';
const ACCENT = '#2563eb';

const toDateText = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const compareDateText = (a, b) => String(a || '').localeCompare(String(b || ''));

const clampDateTextToRange = (value, minDateText, maxDateText) => {
  if (!value) return minDateText;
  if (compareDateText(value, minDateText) < 0) return minDateText;
  if (compareDateText(value, maxDateText) > 0) return maxDateText;
  return value;
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

const baseFieldStyle = {
  minHeight: '38px',
  borderRadius: '10px',
  border: '1px solid rgba(71, 85, 105, 0.72)',
  background: '#0f172a',
  color: '#f8fafc',
  padding: '8px 10px'
};

const splitColumns = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px'
};

const tripleColumns = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '8px'
};

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
  const [editorMode, setEditorMode] = useState('tasks');
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
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
  const [editingTaskId, setEditingTaskId] = useState(null);

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
      avgProgress: 0
    };
    if (visibleTasks.length === 0) return base;
    let progressSum = 0;
    for (const task of visibleTasks) {
      progressSum += Number(task.progress_percent || 0);
      if (task.status === 'completada') base.completed += 1;
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

  const monthDateBounds = useMemo(() => {
    if (!Array.isArray(calendarCells) || calendarCells.length === 0) {
      const fallback = toDateText(new Date());
      return { min: fallback, max: fallback };
    }
    return {
      min: toDateText(calendarCells[0]),
      max: toDateText(calendarCells[calendarCells.length - 1])
    };
  }, [calendarCells]);

  const tasksByDayKey = useMemo(() => {
    const grouped = new Map();
    for (const task of visibleTasks) {
      const startDate = task.start_date || task.due_date || null;
      const dueDate = task.due_date || task.start_date || null;
      if (!startDate && !dueDate) continue;
      const normalizedStart = startDate && dueDate
        ? (compareDateText(startDate, dueDate) <= 0 ? startDate : dueDate)
        : (startDate || dueDate);
      const normalizedEnd = startDate && dueDate
        ? (compareDateText(startDate, dueDate) <= 0 ? dueDate : startDate)
        : (dueDate || startDate);
      if (!normalizedStart || !normalizedEnd) continue;
      if (compareDateText(normalizedEnd, monthDateBounds.min) < 0) continue;
      if (compareDateText(normalizedStart, monthDateBounds.max) > 0) continue;
      const effectiveStart = clampDateTextToRange(normalizedStart, monthDateBounds.min, monthDateBounds.max);
      const effectiveEnd = clampDateTextToRange(normalizedEnd, monthDateBounds.min, monthDateBounds.max);
      const startIndex = Math.max(0, Math.floor(compareDateText(effectiveStart, monthDateBounds.min) === 0 ? 0 : (new Date(`${effectiveStart}T00:00:00`) - new Date(`${monthDateBounds.min}T00:00:00`)) / 86400000));
      const endIndex = Math.max(startIndex, Math.floor(compareDateText(effectiveEnd, monthDateBounds.min) === 0 ? 0 : (new Date(`${effectiveEnd}T00:00:00`) - new Date(`${monthDateBounds.min}T00:00:00`)) / 86400000));
      const safeStart = Math.max(0, Math.min(41, startIndex));
      const safeEnd = Math.max(safeStart, Math.min(41, endIndex));
      for (let day = safeStart; day <= safeEnd; day += 1) {
        if (!grouped.has(day)) grouped.set(day, []);
        grouped.get(day).push({
          task,
          startIndex: safeStart,
          endIndex: safeEnd,
          isStart: day === safeStart,
          isEnd: day === safeEnd
        });
      }
    }
    for (const [key, entries] of grouped.entries()) {
      entries.sort((a, b) => {
        if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
        if (a.endIndex !== b.endIndex) return b.endIndex - a.endIndex;
        return String(a.task.title || '').localeCompare(String(b.task.title || ''), 'es', { sensitivity: 'base' });
      });
      grouped.set(key, entries);
    }
    return grouped;
  }, [visibleTasks, monthDateBounds]);

  const calendarRowsByDay = useMemo(() => {
    const rowsByDay = Array.from({ length: 42 }, () => []);
    const rangeEntries = [];
    const seen = new Set();
    for (const dayEntries of tasksByDayKey.values()) {
      for (const entry of dayEntries) {
        if (!entry?.task?.id) continue;
        if (seen.has(entry.task.id)) continue;
        seen.add(entry.task.id);
        rangeEntries.push({
          task: entry.task,
          startIndex: entry.startIndex,
          endIndex: entry.endIndex
        });
      }
    }
    rangeEntries.sort((a, b) => {
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      if (a.endIndex !== b.endIndex) return b.endIndex - a.endIndex;
      return String(a.task.title || '').localeCompare(String(b.task.title || ''), 'es', { sensitivity: 'base' });
    });
    for (const item of rangeEntries) {
      let lane = 0;
      for (; lane < 8; lane += 1) {
        let overlaps = false;
        for (let day = item.startIndex; day <= item.endIndex; day += 1) {
          if (rowsByDay[day][lane]) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) break;
      }
      const chosenLane = Math.min(lane, 7);
      for (let day = item.startIndex; day <= item.endIndex; day += 1) {
        rowsByDay[day][chosenLane] = {
          ...item,
          isStart: day === item.startIndex,
          isEnd: day === item.endIndex
        };
      }
    }
    return rowsByDay;
  }, [tasksByDayKey]);

  const selectedDateTasks = useMemo(
    () => tasksByDate.get(selectedDate) || [],
    [tasksByDate, selectedDate]
  );

  const tasksWithoutDate = useMemo(
    () => visibleTasks.filter((task) => !task.start_date && !task.due_date),
    [visibleTasks]
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
      const fallbackDate = selectedDate || toDateText(new Date());
      const hasProvidedDate = Boolean(taskForm.start_date || taskForm.due_date);
      const createStartDate = taskForm.start_date || (!hasProvidedDate ? fallbackDate : null);
      const createDueDate = taskForm.due_date || (!hasProvidedDate ? fallbackDate : null);

      await apiRequest(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        token,
        body: {
          title: taskForm.title.trim(),
          description: taskForm.description.trim() || null,
          assignee_user_id: taskForm.assignee_user_id ? Number(taskForm.assignee_user_id) : null,
          start_date: createStartDate,
          due_date: createDueDate,
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
      const focusDate = createDueDate || createStartDate;
      if (focusDate) {
        setSelectedDate(focusDate);
        const focus = new Date(`${focusDate}T00:00:00`);
        if (!Number.isNaN(focus.getTime())) {
          setMonthCursor(new Date(focus.getFullYear(), focus.getMonth(), 1));
        }
      }
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

  const startEditTask = (task) => {
    if (!task) return;
    setEditingTaskId(task.id);
    setSelectedProjectId(String(task.project_id || selectedProjectId || ''));
    setTaskForm({
      project_id: String(task.project_id || ''),
      title: String(task.title || ''),
      description: String(task.description || ''),
      assignee_user_id: task.assignee_user_id ? String(task.assignee_user_id) : '',
      start_date: task.start_date || '',
      due_date: task.due_date || '',
      status: normalizeStatusForForm(task.status),
      progress_percent: Number(task.progress_percent || 0),
      task_type: normalizeTaskTypeForForm(task.task_type),
      version_bump: normalizeVersionBumpForForm(task.version_bump),
      cost: task.cost !== null && task.cost !== undefined ? String(task.cost) : ''
    });
    setEditorMode('tasks');
    setSidePanelOpen(true);
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
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
  };

  const deleteTask = async (task) => {
    if (!task?.id) return;
    if (!window.confirm(`¿Eliminar la tarea "${task.title}"?`)) return;
    setUpdatingTaskId(task.id);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/projects/tasks/${task.id}`, {
        method: 'DELETE',
        token
      });
      if (editingTaskId === task.id) {
        cancelEditTask();
      }
      setNotice(`Tarea "${task.title}" eliminada`);
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'No se pudo eliminar la tarea');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const focusTaskOnCalendar = (task) => {
    const targetDate = task?.due_date || task?.start_date;
    if (!targetDate) return;
    setSelectedDate(targetDate);
    const date = new Date(`${targetDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  return (
    <div className="container">
      <section className="admin-hero-card" style={{ marginBottom: '14px' }}>
        <div>
          <p className="admin-hero-eyebrow">Gestión de proyectos</p>
          <h2 className="admin-hero-title">Proyectos y Tareas</h2>
          <p className="admin-hero-subtitle">
            Calendario colaborativo con foco operativo. Administra proyectos y tareas desde un panel contextual.
          </p>
        </div>
        <div className="admin-active-section-badge" style={{ textAlign: 'left', minWidth: '220px' }}>
          <span>Vista actual</span>
          <strong>Calendario mensual + tareas</strong>
        </div>
      </section>

      {(error || notice) && (
        <div
          className="card"
          style={{
            marginBottom: '12px',
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
          gridTemplateColumns: sidePanelOpen ? 'minmax(340px, 410px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: '12px',
          alignItems: 'start'
        }}
      >
        {sidePanelOpen && (
          <aside
            style={{
              border: '1px solid rgba(45, 56, 82, 0.9)',
              borderRadius: '16px',
              background: 'linear-gradient(180deg, rgba(13, 22, 36, 0.96), rgba(9, 15, 25, 0.98))',
              boxShadow: '0 14px 28px rgba(2, 6, 23, 0.42)',
              padding: '12px',
              display: 'grid',
              gap: '10px',
              position: 'sticky',
              top: '76px',
              maxHeight: 'calc(100vh - 96px)',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, color: '#f8fafc' }}>Panel de edición</h3>
              <button
                type="button"
                className="btn"
                onClick={() => setSidePanelOpen(false)}
                style={{ minHeight: '32px', padding: '6px 10px', background: '#1f2a40', color: '#dbe7ff' }}
              >
                Ocultar
              </button>
            </div>

            <div style={{ display: 'inline-flex', border: '1px solid rgba(71, 85, 105, 0.75)', borderRadius: '999px', overflow: 'hidden' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setEditorMode('projects')}
                style={{
                  minHeight: '36px',
                  borderRadius: 0,
                  background: editorMode === 'projects' ? PRIMARY : 'transparent',
                  color: editorMode === 'projects' ? '#fff' : '#9fb2cc'
                }}
              >
                Proyectos
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setEditorMode('tasks')}
                style={{
                  minHeight: '36px',
                  borderRadius: 0,
                  background: editorMode === 'tasks' ? PRIMARY : 'transparent',
                  color: editorMode === 'tasks' ? '#fff' : '#9fb2cc'
                }}
              >
                Tareas
              </button>
            </div>

            {editorMode === 'projects' ? (
              <form onSubmit={submitProject} style={{ display: 'grid', gap: '8px' }}>
                <h4 style={{ margin: 0, color: '#e2e8f0' }}>Nuevo proyecto</h4>
                <input
                  type="text"
                  value={projectForm.name}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Nombre del proyecto"
                  style={baseFieldStyle}
                />
                <textarea
                  rows={2}
                  value={projectForm.description}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Descripción / objetivo"
                  style={{ ...baseFieldStyle, minHeight: '72px', resize: 'vertical' }}
                />
                <div style={splitColumns}>
                  <select
                    value={projectForm.area}
                    onChange={(event) => setProjectForm((prev) => ({ ...prev, area: event.target.value }))}
                    style={baseFieldStyle}
                  >
                    {areas.map((area) => <option key={area} value={area}>{area}</option>)}
                  </select>
                  <select
                    value={projectForm.work_type}
                    onChange={(event) => setProjectForm((prev) => ({ ...prev, work_type: event.target.value }))}
                    style={baseFieldStyle}
                  >
                    {taskTypeValues.map((type) => (
                      <option key={type} value={type}>{TASK_TYPE_LABELS[type] || type}</option>
                    ))}
                  </select>
                </div>
                <div style={tripleColumns}>
                  <input
                    type="number"
                    min="0"
                    value={projectForm.version_major}
                    onChange={(event) => setProjectForm((prev) => ({ ...prev, version_major: event.target.value }))}
                    placeholder="Major"
                    style={baseFieldStyle}
                  />
                  <input
                    type="number"
                    min="0"
                    value={projectForm.version_minor}
                    onChange={(event) => setProjectForm((prev) => ({ ...prev, version_minor: event.target.value }))}
                    placeholder="Minor"
                    style={baseFieldStyle}
                  />
                  <input
                    type="number"
                    min="0"
                    value={projectForm.version_patch}
                    onChange={(event) => setProjectForm((prev) => ({ ...prev, version_patch: event.target.value }))}
                    placeholder="Patch"
                    style={baseFieldStyle}
                  />
                </div>
                <button type="submit" className="btn" disabled={savingProject} style={{ background: PRIMARY, color: '#fff' }}>
                  {savingProject ? 'Creando...' : 'Crear proyecto'}
                </button>
              </form>
            ) : (
              <form
                onSubmit={async (event) => {
                  if (!editingTaskId) {
                    await submitTask(event);
                    return;
                  }
                  event.preventDefault();
                  const projectId = Number.parseInt(taskForm.project_id || selectedProjectId, 10);
                  if (!Number.isInteger(projectId) || projectId <= 0) {
                    setError('Selecciona un proyecto para guardar la tarea');
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
                    await apiRequest(`/api/projects/tasks/${editingTaskId}`, {
                      method: 'PATCH',
                      token,
                      body: {
                        project_id: projectId,
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
                    setNotice('Tarea actualizada correctamente');
                    cancelEditTask();
                    await loadDashboard();
                  } catch (err) {
                    setError(err.message || 'No se pudo actualizar la tarea');
                  } finally {
                    setSavingTask(false);
                  }
                }}
                style={{ display: 'grid', gap: '8px' }}
              >
                <h4 style={{ margin: 0, color: '#e2e8f0' }}>
                  {editingTaskId ? `Editando tarea #${editingTaskId}` : 'Nueva tarea'}
                </h4>
                <select
                  value={taskForm.project_id || selectedProjectId}
                  onChange={(event) => {
                    setSelectedProjectId(event.target.value);
                    setTaskForm((prev) => ({ ...prev, project_id: event.target.value }));
                  }}
                  style={baseFieldStyle}
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
                  style={baseFieldStyle}
                />
                <textarea
                  rows={2}
                  value={taskForm.description}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Detalle de tarea"
                  style={{ ...baseFieldStyle, minHeight: '72px', resize: 'vertical' }}
                />
                <div style={splitColumns}>
                  <select
                    value={taskForm.assignee_user_id}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, assignee_user_id: event.target.value }))}
                    style={baseFieldStyle}
                  >
                    <option value="">Sin asignar</option>
                    {users.map((row) => (
                      <option key={row.id} value={row.id}>{row.display_name}</option>
                    ))}
                  </select>
                  <select
                    value={taskForm.task_type}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, task_type: event.target.value }))}
                    style={baseFieldStyle}
                  >
                    {taskTypeValues.map((type) => (
                      <option key={type} value={type}>{TASK_TYPE_LABELS[type] || type}</option>
                    ))}
                  </select>
                </div>
                <div style={splitColumns}>
                  <input
                    type="date"
                    value={taskForm.start_date}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, start_date: event.target.value }))}
                    style={baseFieldStyle}
                  />
                  <input
                    type="date"
                    value={taskForm.due_date}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, due_date: event.target.value }))}
                    style={baseFieldStyle}
                  />
                </div>
                <div style={tripleColumns}>
                  <select
                    value={taskForm.status}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, status: event.target.value }))}
                    style={baseFieldStyle}
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
                    style={baseFieldStyle}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={taskForm.cost}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, cost: event.target.value }))}
                    placeholder="Costo Bs"
                    style={baseFieldStyle}
                  />
                </div>
                <select
                  value={taskForm.version_bump}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, version_bump: event.target.value }))}
                  style={baseFieldStyle}
                >
                  {versionBumpValues.map((value) => (
                    <option key={value} value={value}>{VERSION_BUMP_LABELS[value] || value}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {editingTaskId && (
                    <button
                      type="button"
                      className="btn"
                      onClick={cancelEditTask}
                      style={{ background: '#475569', color: '#fff', minHeight: '36px', padding: '8px 12px' }}
                    >
                      Cancelar edición
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn"
                    disabled={savingTask || projects.length === 0}
                    style={{ background: ACCENT, color: '#fff', minHeight: '36px', padding: '8px 14px' }}
                  >
                    {savingTask ? 'Guardando...' : editingTaskId ? 'Guardar cambios' : 'Crear tarea'}
                  </button>
                </div>
              </form>
            )}

            <div style={{ borderTop: '1px solid rgba(71, 85, 105, 0.46)', paddingTop: '10px', display: 'grid', gap: '8px' }}>
              <h4 style={{ margin: 0, color: '#f8fafc' }}>Mis proyectos ({myProjects.length})</h4>
              <div style={{ display: 'grid', gap: '8px', maxHeight: '260px', overflowY: 'auto', paddingRight: '2px' }}>
                {loading ? (
                  <div style={{ color: '#9fb2cc' }}>Cargando proyectos...</div>
                ) : myProjects.length === 0 ? (
                  <div style={{ color: '#9fb2cc' }}>Todavía no participas en proyectos.</div>
                ) : myProjects.map((project) => (
                  <div key={project.id} style={{ border: '1px solid rgba(71, 85, 105, 0.68)', borderRadius: '10px', background: '#0f172a', padding: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <strong style={{ color: '#f8fafc' }}>{project.name}</strong>
                      <span style={{ fontSize: '0.78rem', color: '#9fb2cc' }}>v{project.version}</span>
                    </div>
                    <div style={{ marginTop: '3px', fontSize: '0.82rem', color: '#93a4bc' }}>
                      {project.area} · {TASK_TYPE_LABELS[project.work_type] || project.work_type}
                    </div>
                    <div style={{ marginTop: '7px', height: '7px', borderRadius: '999px', background: '#1e293b', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, Number(project.progress_percent || 0)))}%`, height: '100%', background: '#2563eb' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        <section
          style={{
            border: '1px solid rgba(45, 56, 82, 0.9)',
            borderRadius: '16px',
            background: 'linear-gradient(180deg, rgba(13, 22, 36, 0.96), rgba(9, 15, 25, 0.98))',
            boxShadow: '0 14px 28px rgba(2, 6, 23, 0.42)',
            padding: '14px',
            display: 'grid',
            gap: '10px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, color: '#f8fafc' }}>Calendario de tareas</h3>
              <div style={{ color: '#98acc8', fontSize: '0.84rem', marginTop: '2px' }}>
                Vista mensual prioritaria para planificación y seguimiento
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {!sidePanelOpen && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSidePanelOpen(true)}
                  style={{ minHeight: '34px', padding: '7px 12px', background: '#1f2a40', color: '#dbe7ff' }}
                >
                  Mostrar panel
                </button>
              )}
              <div style={{ display: 'inline-flex', border: '1px solid rgba(71, 85, 105, 0.75)', borderRadius: '999px', overflow: 'hidden' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setViewScope('all')}
                  style={{
                    minHeight: '34px',
                    borderRadius: 0,
                    background: viewScope === 'all' ? '#2563eb' : 'transparent',
                    color: viewScope === 'all' ? '#fff' : '#9fb2cc'
                  }}
                >
                  Todo el equipo
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setViewScope('mine')}
                  style={{
                    minHeight: '34px',
                    borderRadius: 0,
                    background: viewScope === 'mine' ? '#2563eb' : 'transparent',
                    color: viewScope === 'mine' ? '#fff' : '#9fb2cc'
                  }}
                >
                  Mis tareas
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(71, 85, 105, 0.72)', borderRadius: '10px', padding: '8px' }}>
              <div style={{ color: '#9cb0cb', fontSize: '0.76rem' }}>Tareas visibles</div>
              <strong style={{ color: '#f8fafc', fontSize: '1.08rem' }}>{tasksSummary.total}</strong>
            </div>
            <div style={{ background: '#0f172a', border: '1px solid rgba(71, 85, 105, 0.72)', borderRadius: '10px', padding: '8px' }}>
              <div style={{ color: '#9cb0cb', fontSize: '0.76rem' }}>Completadas</div>
              <strong style={{ color: '#34d399', fontSize: '1.08rem' }}>{tasksSummary.completed}</strong>
            </div>
            <div style={{ background: '#0f172a', border: '1px solid rgba(71, 85, 105, 0.72)', borderRadius: '10px', padding: '8px' }}>
              <div style={{ color: '#9cb0cb', fontSize: '0.76rem' }}>Progreso medio</div>
              <strong style={{ color: '#60a5fa', fontSize: '1.08rem' }}>{tasksSummary.avgProgress}%</strong>
            </div>
          </div>

          <div style={{ border: '1px solid rgba(71, 85, 105, 0.62)', borderRadius: '12px', background: '#0f172a', padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, color: '#f8fafc' }}>Lista de tareas ({visibleTasks.length})</h4>
              {tasksWithoutDate.length > 0 && (
                <span style={{ color: '#fbbf24', fontSize: '0.78rem' }}>
                  {tasksWithoutDate.length} sin fecha (no salen en calendario)
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gap: '8px', maxHeight: '220px', overflowY: 'auto', paddingRight: '2px' }}>
              {loading ? (
                <div style={{ color: '#9fb2cc' }}>Cargando tareas...</div>
              ) : visibleTasks.length === 0 ? (
                <div style={{ color: '#9fb2cc' }}>No hay tareas registradas para esta vista.</div>
              ) : visibleTasks.map((task) => {
                const hasDate = Boolean(task.start_date || task.due_date);
                return (
                  <div key={`list-${task.id}`} style={{ border: '1px solid rgba(71, 85, 105, 0.6)', borderRadius: '10px', background: '#101b2f', padding: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <strong style={{ color: '#f8fafc' }}>{task.title}</strong>
                      <span style={{ color: '#93a5be', fontSize: '0.75rem' }}>{task.project_name}</span>
                    </div>
                    <div style={{ marginTop: '4px', color: '#94a9c3', fontSize: '0.76rem' }}>
                      Estado: {STATUS_LABELS[task.status] || task.status} · Inicio: {formatDate(task.start_date)} · Entrega: {formatDate(task.due_date)}
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      {!hasDate ? (
                        <span style={{ color: '#fbbf24', fontSize: '0.74rem' }}>Sin fecha en calendario</span>
                      ) : (
                        <span style={{ color: '#86efac', fontSize: '0.74rem' }}>Con fecha</span>
                      )}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {hasDate && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => focusTaskOnCalendar(task)}
                            style={{ minHeight: '30px', padding: '5px 9px', background: '#1f3b70', color: '#dbeafe', fontSize: '0.76rem' }}
                          >
                            Ver en calendario
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => startEditTask(task)}
                          style={{ minHeight: '30px', padding: '5px 9px', background: '#1e40af', color: '#dbeafe', fontSize: '0.76rem' }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => deleteTask(task)}
                          disabled={updatingTaskId === task.id}
                          style={{ minHeight: '30px', padding: '5px 9px', background: '#7f1d1d', color: '#fecaca', fontSize: '0.76rem' }}
                        >
                          {updatingTaskId === task.id ? '...' : 'Eliminar'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              style={{ minHeight: '34px', minWidth: '40px', padding: '0 10px', background: '#1e293b', color: '#f8fafc' }}
            >
              ◀
            </button>
            <strong style={{ color: '#f8fafc', minWidth: '170px', textAlign: 'center', fontSize: '1.05rem' }}>
              {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
            </strong>
            <button
              type="button"
              className="btn"
              onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              style={{ minHeight: '34px', minWidth: '40px', padding: '0 10px', background: '#1e293b', color: '#f8fafc' }}
            >
              ▶
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '8px' }}>
            {DAY_LABELS.map((day) => (
              <div key={day} style={{ textAlign: 'center', color: '#96aac6', fontWeight: 700, fontSize: '0.78rem' }}>{day}</div>
            ))}
            {calendarCells.map((day, dayIndex) => {
              const dateText = toDateText(day);
              const dayTasks = tasksByDate.get(dateText) || [];
              const dayRows = calendarRowsByDay[dayIndex] || [];
              const isCurrentMonth = day.getMonth() === monthCursor.getMonth();
              const isSelected = dateText === selectedDate;
              return (
                <button
                  key={dateText}
                  type="button"
                  onClick={() => setSelectedDate(dateText)}
                  style={{
                    border: `1px solid ${isSelected ? 'rgba(255, 127, 48, 0.9)' : 'rgba(71, 85, 105, 0.62)'}`,
                    borderRadius: '11px',
                    background: isSelected ? 'rgba(255, 127, 48, 0.16)' : '#0f172a',
                    minHeight: '136px',
                    padding: '8px 7px',
                    display: 'grid',
                    alignContent: 'start',
                    gap: '5px',
                    color: isCurrentMonth ? '#f8fafc' : '#6f84a3',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>{day.getDate()}</div>
                  <div style={{ display: 'grid', gap: '3px' }}>
                    {dayRows.slice(0, 5).map((row, rowIndex) => {
                      if (!row) return <div key={`empty-${dateText}-${rowIndex}`} style={{ minHeight: '18px' }} />;
                      const color = STATUS_COLORS[row.task.status] || '#2563eb';
                      return (
                        <div
                          key={`bar-${dateText}-${row.task.id}-${rowIndex}`}
                          style={{
                            background: color,
                            color: '#fff',
                            borderRadius: row.isStart || row.isEnd ? '999px' : '3px',
                            padding: row.isStart || row.isEnd ? '2px 7px' : '2px 4px',
                            fontSize: '0.66rem',
                            minHeight: '18px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: row.isStart ? 'flex-start' : 'center',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            opacity: row.task.status === 'completada' ? 0.9 : 1
                          }}
                          title={`${row.task.title} (${formatDate(row.task.start_date)} - ${formatDate(row.task.due_date)})`}
                        >
                          {row.isStart ? row.task.title : ''}
                        </div>
                      );
                    })}
                    {dayTasks.length > 5 && (
                      <div style={{ fontSize: '0.68rem', color: '#9cb0cb' }}>+{dayTasks.length - 5} más</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: '1px solid rgba(71, 85, 105, 0.5)', paddingTop: '10px', display: 'grid', gap: '8px' }}>
            <h4 style={{ margin: 0, color: '#f8fafc' }}>Tareas del {formatDate(selectedDate)}</h4>
            <div style={{ display: 'grid', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '2px' }}>
              {selectedDateTasks.length === 0 ? (
                <div style={{ color: '#9fb2cc' }}>No hay tareas en esta fecha.</div>
              ) : selectedDateTasks.map((task) => {
                const draft = taskDrafts[task.id] || {
                  status: task.status,
                  progress_percent: Number(task.progress_percent || 0),
                  cost: task.cost ?? ''
                };
                return (
                  <div key={`selected-${task.id}`} style={{ border: '1px solid rgba(71, 85, 105, 0.68)', borderRadius: '10px', background: '#0f172a', padding: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ color: '#f8fafc' }}>{task.title}</strong>
                      <span style={{ color: '#93a5be', fontSize: '0.76rem' }}>{task.project_name}</span>
                    </div>
                    <div style={{ color: '#94a9c3', fontSize: '0.78rem', marginTop: '3px' }}>
                      {task.assignee_name} · {STATUS_LABELS[task.status] || task.status} · Entrega: {formatDate(task.due_date)}
                    </div>
                    <div style={{ marginTop: '6px', height: '7px', borderRadius: '999px', background: '#1e293b', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, Number(task.progress_percent || 0)))}%`, height: '100%', background: STATUS_COLORS[task.status] || '#2563eb' }} />
                    </div>
                    <div
                      style={{
                        marginTop: '8px',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) 82px 100px auto',
                        gap: '6px',
                        alignItems: 'center'
                      }}
                    >
                      <select
                        value={draft.status}
                        onChange={(event) => setTaskDrafts((prev) => ({
                          ...prev,
                          [task.id]: { ...prev[task.id], status: event.target.value }
                        }))}
                        style={{ ...baseFieldStyle, minHeight: '32px', padding: '5px 8px' }}
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
                        style={{ ...baseFieldStyle, minHeight: '32px', padding: '5px 8px' }}
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
                        style={{ ...baseFieldStyle, minHeight: '32px', padding: '5px 8px' }}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => saveTaskDraft(task)}
                        disabled={updatingTaskId === task.id}
                        style={{ minHeight: '32px', padding: '5px 10px', background: '#2563eb', color: '#fff' }}
                      >
                        {updatingTaskId === task.id ? '...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
