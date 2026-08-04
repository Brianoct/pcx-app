// Plan del día: the team's workday at a glance. In the morning meeting each
// person logs their tasks for today with a time frame; everyone's day shows
// side by side, one column per person. Replaces the old event calendar.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';

const DAY_START = 7 * 60;   // board shows 07:00 …
const DAY_END = 19 * 60;    // … to 19:00
const HOUR_PX = 56;
const REFRESH_MS = 45000;   // meeting mode: keep everyone's board fresh

const USER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4',
  '#f97316', '#84cc16', '#6366f1', '#14b8a6', '#e11d48', '#0ea5e9'
];

// Meeting categories: regular work keeps the person's color; Lean 3S and
// Kaizen use ONE fixed look for the whole team so they jump out on the board.
const TASK_TYPE_META = {
  tarea: { label: 'Tarea normal' },
  '3s': { label: 'Lean 3S', icon: '🧹', badge: '3S' },
  kaizen: { label: 'Kaizen (mejora)', icon: '💡', badge: 'KAIZEN' }
};

const pad2 = (n) => String(n).padStart(2, '0');
const toDateText = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const minuteLabel = (minute) => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;

const TIME_OPTIONS = [];
for (let m = DAY_START; m <= DAY_END; m += 30) TIME_OPTIONS.push(m);

// Overlapping tasks in one column share the width via simple lanes.
const assignLanes = (tasks) => {
  const sorted = [...tasks].sort((a, b) => a.start_minute - b.start_minute || a.id - b.id);
  const laneEnds = [];
  const withLanes = sorted.map((task) => {
    let lane = laneEnds.findIndex((end) => end <= task.start_minute);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = task.end_minute;
    return { ...task, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return withLanes.map((task) => ({ ...task, laneCount }));
};

export default function Calendar({ token, user }) {
  const toast = useToast();
  const [date, setDate] = useState(() => toDateText(new Date()));
  const [team, setTeam] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('tarea');
  const [startMinute, setStartMinute] = useState(8 * 60);
  const [endMinute, setEndMinute] = useState(9 * 60);
  const [saving, setSaving] = useState(false);
  const [nowMinute, setNowMinute] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  // Editor de bloque: título, horario, tipo y checklist interna.
  const [editorId, setEditorId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [newSubtask, setNewSubtask] = useState('');
  const [moveDate, setMoveDate] = useState('');
  // Arrastre: mover el bloque (misma duración) o estirar el borde inferior.
  const dragRef = useRef(null);
  const previewRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState(null);

  const isToday = date === toDateText(new Date());
  const myId = Number(user?.id);
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const editorTask = editorId ? tasks.find((t) => t.id === editorId) : null;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiRequest(`/api/day-plan?date=${date}`, { token });
      setTeam(Array.isArray(data?.team) ? data.team : []);
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
    } catch (err) {
      if (!silent) toast.error(err.message || 'No se pudo cargar el plan');
    } finally {
      if (!silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      load(true);
      const now = new Date();
      setNowMinute(now.getHours() * 60 + now.getMinutes());
    }, REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [load]);

  const shiftDay = (delta) => {
    const [y, m, d] = date.split('-').map(Number);
    setDate(toDateText(new Date(y, m - 1, d + delta)));
  };

  const addTask = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const data = await apiRequest('/api/day-plan', {
        method: 'POST',
        token,
        body: { date, title: title.trim(), start_minute: startMinute, end_minute: endMinute, task_type: taskType }
      });
      setTasks((prev) => [...prev, data.task]);
      setTitle('');
      setTaskType('tarea');
      // Chain the next entry right after this one — fast logging in the meeting.
      const duration = endMinute - startMinute;
      const nextStart = Math.min(endMinute, DAY_END - 30);
      setStartMinute(nextStart);
      setEndMinute(Math.min(nextStart + duration, DAY_END));
    } catch (err) {
      toast.error(err.message || 'No se pudo agregar');
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (task) => {
    try {
      const data = await apiRequest(`/api/day-plan/${task.id}`, {
        method: 'PATCH', token, body: { is_done: !task.is_done }
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? data.task : t)));
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar');
    }
  };

  const removeTask = async (task) => {
    if (!window.confirm(`¿Eliminar "${task.title}"?`)) return;
    try {
      await apiRequest(`/api/day-plan/${task.id}`, { method: 'DELETE', token });
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (editorId === task.id) setEditorId(null);
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  const openEditor = (task) => {
    setEditorId(task.id);
    setEditDraft({
      title: task.title,
      task_type: task.task_type,
      start_minute: task.start_minute,
      end_minute: task.end_minute
    });
    setNewSubtask('');
    // Fecha sugerida para «pasar a otro día»: el día siguiente del tablero.
    const [y, m, d] = date.split('-').map(Number);
    setMoveDate(toDateText(new Date(y, m - 1, d + 1)));
  };

  // ── Arrastre para mover / estirar bloques ─────────────────────────────────
  const snap15 = (minute) => Math.round(minute / 15) * 15;

  const setPreview = (value) => {
    previewRef.current = value;
    setDragPreview(value);
  };

  const onDragMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPx = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaPx) < 5) return;
    drag.moved = true;
    const deltaMin = snap15((deltaPx / HOUR_PX) * 60);
    if (drag.mode === 'move') {
      const duration = drag.origEnd - drag.origStart;
      const start = Math.max(DAY_START, Math.min(drag.origStart + deltaMin, DAY_END - duration));
      setPreview({ taskId: drag.taskId, start_minute: start, end_minute: start + duration });
    } else {
      const end = Math.max(drag.origStart + 15, Math.min(drag.origEnd + deltaMin, DAY_END));
      setPreview({ taskId: drag.taskId, start_minute: drag.origStart, end_minute: end });
    }
     
  }, []);

  const onDragEnd = useCallback(async () => {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    const drag = dragRef.current;
    dragRef.current = null;
    const preview = previewRef.current;
    if (!drag || !drag.moved || !preview) {
      setPreview(null);
      return;
    }
    // El click del navegador llega justo después del pointerup: no abrir editor.
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 150);
    if (preview.start_minute === drag.origStart && preview.end_minute === drag.origEnd) {
      setPreview(null);
      return;
    }
    // Optimista: el bloque se queda donde lo soltaste ANTES de limpiar la
    // vista previa — sin ese orden hay un parpadeo a la posición original
    // mientras responde el servidor. Si el PATCH falla, se revierte.
    setTasks((prev) => prev.map((t) => (
      t.id === drag.taskId
        ? { ...t, start_minute: preview.start_minute, end_minute: preview.end_minute }
        : t
    )));
    setPreview(null);
    try {
      const data = await apiRequest(`/api/day-plan/${drag.taskId}`, {
        method: 'PATCH',
        token,
        body: { start_minute: preview.start_minute, end_minute: preview.end_minute }
      });
      setTasks((prev) => prev.map((t) => (t.id === drag.taskId ? data.task : t)));
    } catch (err) {
      toast.error(err.message || 'No se pudo mover el bloque');
      setTasks((prev) => prev.map((t) => (
        t.id === drag.taskId
          ? { ...t, start_minute: drag.origStart, end_minute: drag.origEnd }
          : t
      )));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const beginDrag = (e, task, mode) => {
    // En táctil el arrastre pelea con el scroll: ahí un toque abre el editor
    // (que tiene selects de hora); el arrastre queda para mouse/lápiz.
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (mode === 'move' && e.target.closest('button, input, label, a')) return;
    e.preventDefault();
    dragRef.current = {
      taskId: task.id,
      mode,
      startY: e.clientY,
      origStart: task.start_minute,
      origEnd: task.end_minute,
      moved: false
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  };

  const moveToDate = async (task, targetDate) => {
    if (!targetDate || targetDate === date) return;
    try {
      await apiRequest(`/api/day-plan/${task.id}`, { method: 'PATCH', token, body: { task_date: targetDate } });
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setEditorId(null);
      const [y, m, d] = targetDate.split('-').map(Number);
      const label = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
      toast.success(`Bloque movido al ${label}`);
    } catch (err) {
      toast.error(err.message || 'No se pudo mover');
    }
  };

  const saveEditor = async () => {
    if (!editorTask || !editDraft?.title?.trim()) return;
    try {
      const data = await apiRequest(`/api/day-plan/${editorTask.id}`, {
        method: 'PATCH',
        token,
        body: {
          title: editDraft.title.trim(),
          task_type: editDraft.task_type,
          start_minute: editDraft.start_minute,
          end_minute: editDraft.end_minute
        }
      });
      setTasks((prev) => prev.map((t) => (t.id === editorTask.id ? data.task : t)));
      toast.success('Bloque actualizado');
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    }
  };

  // La respuesta de cada operación de checklist trae task_done (true/false)
  // cuando el bloque tiene lista: el bloque se marca hecho solo al completar.
  const applySubtaskResult = (taskId, mutate, taskDone) => {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      const subtasks = mutate([...(t.subtasks || [])]);
      const is_done = typeof taskDone === 'boolean' ? taskDone : t.is_done;
      return { ...t, subtasks, is_done };
    }));
  };

  const addSubtask = async () => {
    if (!editorTask || !newSubtask.trim()) return;
    try {
      const data = await apiRequest(`/api/day-plan/${editorTask.id}/subtasks`, {
        method: 'POST', token, body: { title: newSubtask.trim() }
      });
      applySubtaskResult(editorTask.id, (subs) => [...subs, data.subtask], data.task_done);
      setNewSubtask('');
    } catch (err) {
      toast.error(err.message || 'No se pudo agregar');
    }
  };

  const toggleSubtask = async (task, subtask) => {
    try {
      const data = await apiRequest(`/api/day-plan/subtasks/${subtask.id}`, {
        method: 'PATCH', token, body: { is_done: !subtask.is_done }
      });
      applySubtaskResult(task.id, (subs) => subs.map((s) => (s.id === subtask.id ? data.subtask : s)), data.task_done);
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar');
    }
  };

  const removeSubtask = async (task, subtask) => {
    try {
      const data = await apiRequest(`/api/day-plan/subtasks/${subtask.id}`, { method: 'DELETE', token });
      applySubtaskResult(task.id, (subs) => subs.filter((s) => s.id !== subtask.id), data.task_done);
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  const tasksByUser = useMemo(() => {
    const map = new Map();
    for (const task of tasks) {
      if (!map.has(task.user_id)) map.set(task.user_id, []);
      map.get(task.user_id).push(task);
    }
    return map;
  }, [tasks]);

  // My column first, then people WITH a plan, then the rest — the meeting
  // reads left to right.
  const columns = useMemo(() => {
    const score = (member) => (member.id === myId ? 2 : (tasksByUser.has(member.id) ? 1 : 0));
    return [...team].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'es'));
  }, [team, tasksByUser, myId]);

  // Colors follow the roster POSITION, not the user id: id % palette made two
  // people whose ids differ by 12 share a color. Position guarantees every
  // teammate a distinct color (up to the palette size).
  const colorByUserId = useMemo(() => {
    const map = new Map();
    team.forEach((member, index) => {
      map.set(member.id, USER_COLORS[index % USER_COLORS.length]);
    });
    return map;
  }, [team]);

  const planned = team.filter((member) => tasksByUser.has(member.id)).length;
  const doneCount = tasks.filter((t) => t.is_done).length;
  const boardHeight = ((DAY_END - DAY_START) / 60) * HOUR_PX;
  const hourMarks = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) hourMarks.push(m);

  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    const formatted = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(y, m - 1, d));
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [date]);

  return (
    <div className="container dayplan-page">
      <div className="dayplan-head">
        <div>
          <h2 className="dayplan-title">Plan del día</h2>
          <p className="dayplan-subtitle">{dateLabel}{isToday ? ' · hoy' : ''}</p>
        </div>
        <div className="dayplan-nav">
          <button type="button" className="btn btn-secondary" onClick={() => shiftDay(-1)} aria-label="Día anterior">‹</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="btn btn-secondary" onClick={() => shiftDay(1)} aria-label="Día siguiente">›</button>
          {!isToday && (
            <button type="button" className="btn btn-primary" onClick={() => setDate(toDateText(new Date()))}>Hoy</button>
          )}
        </div>
      </div>

      <div className="card dayplan-add">
        <span className="dayplan-add-label">Mi tarea:</span>
        <input
          type="text"
          maxLength={120}
          placeholder="¿Qué vas a hacer? (ej: Armar pedidos de Santa Cruz)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
        />
        <select
          className={`dayplan-type-select ${taskType !== 'tarea' ? `is-${taskType}` : ''}`}
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
          title="Tipo de tarea"
        >
          {Object.entries(TASK_TYPE_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.icon ? `${meta.icon} ${meta.label}` : meta.label}
            </option>
          ))}
        </select>
        <select value={startMinute} onChange={(e) => {
          const v = Number(e.target.value);
          setStartMinute(v);
          if (endMinute <= v) setEndMinute(Math.min(v + 60, DAY_END));
        }}>
          {TIME_OPTIONS.filter((m) => m < DAY_END).map((m) => (
            <option key={m} value={m}>{minuteLabel(m)}</option>
          ))}
        </select>
        <span className="dayplan-add-sep">→</span>
        <select value={endMinute} onChange={(e) => setEndMinute(Number(e.target.value))}>
          {TIME_OPTIONS.filter((m) => m > startMinute).map((m) => (
            <option key={m} value={m}>{minuteLabel(m)}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={saving || !title.trim()} onClick={addTask}>
          {saving ? '…' : '+ Agregar'}
        </button>
      </div>

      <div className="dayplan-meta">
        <span><strong>{planned}</strong>/{team.length} con plan</span>
        <span><strong>{tasks.length}</strong> tareas</span>
        <span><strong>{doneCount}</strong> hechas</span>
        <span className="dayplan-legend">
          <span className="dayplan-legend-chip is-3s">🧹 3S</span>
          <span className="dayplan-legend-chip is-kaizen">💡 Kaizen</span>
          <span className="dayplan-legend-chip is-plan">📋 Plan</span>
          <span className="dayplan-legend-note">1 de cada una por persona, cada día</span>
        </span>
      </div>

      {loading ? (
        <p className="dashboard-muted">Cargando plan…</p>
      ) : (
        <div className="dayplan-board">
          <div className="dayplan-time-col">
            <div className="dayplan-time-spacer" />
            {hourMarks.map((m) => (
              <div key={m} className="dayplan-hour-label" style={{ height: HOUR_PX }}>{minuteLabel(m)}</div>
            ))}
          </div>
          {columns.map((member) => {
            const memberTasks = assignLanes(tasksByUser.get(member.id) || []);
            const color = colorByUserId.get(member.id) || USER_COLORS[0];
            const isMine = member.id === myId;
            const memberDone = memberTasks.filter((t) => t.is_done).length;
            const has3s = memberTasks.some((t) => t.task_type === '3s');
            const hasKaizen = memberTasks.some((t) => t.task_type === 'kaizen');
            return (
              <div key={member.id} className={`dayplan-col ${isMine ? 'is-mine' : ''}`}>
                <div className="dayplan-col-head" style={{ borderTopColor: color }}>
                  <span className="dayplan-col-name">{member.name}{isMine ? ' (yo)' : ''}</span>
                  <span className="dayplan-col-sub">
                    <span className={`dayplan-col-count ${memberTasks.length === 0 ? 'is-empty' : ''}`}>
                      {memberTasks.length === 0 ? 'por planificar' : `${memberDone}/${memberTasks.length} ✓`}
                    </span>
                    <span className="dayplan-col-lean">
                      <span className={`dayplan-lean-dot ${has3s ? 'ok' : ''}`} title={has3s ? '3S planificada' : 'Falta su 3S de hoy'}>🧹</span>
                      <span className={`dayplan-lean-dot ${hasKaizen ? 'ok' : ''}`} title={hasKaizen ? 'Kaizen planificado' : 'Falta su Kaizen de hoy'}>💡</span>
                    </span>
                  </span>
                </div>
                <div className="dayplan-col-body" style={{ height: boardHeight }}>
                  {hourMarks.slice(1, -1).map((m) => (
                    <div key={m} className="dayplan-hour-line" style={{ top: ((m - DAY_START) / 60) * HOUR_PX }} />
                  ))}
                  {isToday && nowMinute >= DAY_START && nowMinute <= DAY_END && (
                    <div className="dayplan-now-line" style={{ top: ((nowMinute - DAY_START) / 60) * HOUR_PX }} />
                  )}
                  {memberTasks.map((task) => {
                    // Mientras se arrastra, el bloque se dibuja en su posición
                    // tentativa; al soltar se confirma con el PATCH.
                    const isDragging = dragPreview?.taskId === task.id;
                    const dispStart = isDragging ? dragPreview.start_minute : task.start_minute;
                    const dispEnd = isDragging ? dragPreview.end_minute : task.end_minute;
                    const top = Math.max(0, ((dispStart - DAY_START) / 60) * HOUR_PX);
                    const height = Math.max(24, ((Math.min(dispEnd, DAY_END) - Math.max(dispStart, DAY_START)) / 60) * HOUR_PX - 3);
                    const width = 100 / task.laneCount;
                    const type = TASK_TYPE_META[task.task_type] ? task.task_type : 'tarea';
                    const typeMeta = TASK_TYPE_META[type];
                    // Tareas que vienen de Planificación (Programa→Operación→
                    // Misión→Tarea): checkbox visible y look propio; el check
                    // se sincroniza con la sección de Programas.
                    const isPlan = Boolean(task.planning_task_id);
                    const subtasks = task.subtasks || [];
                    const subDone = subtasks.filter((s) => s.is_done).length;
                    const progressPct = subtasks.length > 0 ? Math.round((subDone / subtasks.length) * 100) : null;
                    const canEdit = isMine || isAdmin;
                    return (
                      <div
                        key={task.id}
                        className={`dayplan-task ${task.is_done ? 'is-done' : ''} ${type !== 'tarea' ? `type-${type}` : ''} ${isPlan ? 'type-plan' : ''} ${canEdit ? 'is-editable' : ''} ${isDragging ? 'is-dragging' : ''}`}
                        style={{
                          top,
                          height,
                          left: `${task.lane * width}%`,
                          width: `calc(${width}% - 4px)`,
                          // Regular tasks wear the person's color; 3S/Kaizen and
                          // planning tasks use the fixed team-wide look from CSS.
                          background: type === 'tarea' && !isPlan ? color : undefined
                        }}
                        title={`${minuteLabel(task.start_minute)}–${minuteLabel(task.end_minute)} · ${isPlan ? 'Planificación · ' : typeMeta.icon ? `${typeMeta.label} · ` : ''}${task.title}${canEdit ? ' · clic para editar · arrastra para mover' : ''}`}
                        onClick={canEdit ? () => { if (!suppressClickRef.current) openEditor(task); } : undefined}
                        onPointerDown={canEdit ? (e) => beginDrag(e, task, 'move') : undefined}
                        role={canEdit ? 'button' : undefined}
                      >
                        <span className="dayplan-task-toprow">
                          <span className="dayplan-task-time">{minuteLabel(dispStart)}–{minuteLabel(dispEnd)}</span>
                          {isPlan ? (
                            <span className="dayplan-task-badge is-plan">📋 PLAN</span>
                          ) : type !== 'tarea' && (
                            <span className={`dayplan-task-badge is-${type}`}>{typeMeta.icon} {typeMeta.badge}</span>
                          )}
                        </span>
                        {isPlan ? (
                          <label className="dayplan-task-checkline" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={task.is_done}
                              disabled={!isMine}
                              onChange={() => toggleDone(task)}
                            />
                            <span className="dayplan-task-title">{task.title}</span>
                          </label>
                        ) : (
                          <span className="dayplan-task-title">{task.title}</span>
                        )}
                        {progressPct !== null && (
                          <span className="dayplan-task-progress">
                            <span className="dayplan-task-progress-bar">
                              <span style={{ width: `${progressPct}%` }} />
                            </span>
                            <span className="dayplan-task-progress-text">{subDone}/{subtasks.length} · {progressPct}%</span>
                          </span>
                        )}
                        {isMine && (
                          <span className="dayplan-task-actions" onClick={(e) => e.stopPropagation()}>
                            {subtasks.length === 0 && (
                              <button type="button" title={task.is_done ? 'Marcar pendiente' : 'Marcar hecha'} onClick={() => toggleDone(task)}>
                                {task.is_done ? '↺' : '✓'}
                              </button>
                            )}
                            <button type="button" title="Eliminar" onClick={() => removeTask(task)}>✕</button>
                          </span>
                        )}
                        {canEdit && (
                          <span
                            className="dayplan-task-resize"
                            title="Arrastra para cambiar la hora fin"
                            onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, task, 'resize'); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editorTask && editDraft && (
        <div className="dpe-overlay" onClick={() => setEditorId(null)}>
          <div className="dpe-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dpe-head">
              <h3>Editar bloque</h3>
              <button type="button" className="dpe-close" onClick={() => setEditorId(null)} aria-label="Cerrar">✕</button>
            </div>

            <input
              type="text"
              className="dpe-title"
              maxLength={120}
              value={editDraft.title}
              onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
            />

            <div className="dpe-row">
              <select
                className="dayplan-type-select"
                value={editDraft.task_type}
                onChange={(e) => setEditDraft({ ...editDraft, task_type: e.target.value })}
              >
                {Object.entries(TASK_TYPE_META).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.icon ? `${meta.icon} ${meta.label}` : meta.label}</option>
                ))}
              </select>
              <select
                value={editDraft.start_minute}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setEditDraft({
                    ...editDraft,
                    start_minute: v,
                    end_minute: editDraft.end_minute <= v ? Math.min(v + 60, DAY_END) : editDraft.end_minute
                  });
                }}
              >
                {TIME_OPTIONS.filter((m) => m < DAY_END).map((m) => <option key={m} value={m}>{minuteLabel(m)}</option>)}
              </select>
              <span className="dayplan-add-sep">→</span>
              <select
                value={editDraft.end_minute}
                onChange={(e) => setEditDraft({ ...editDraft, end_minute: Number(e.target.value) })}
              >
                {TIME_OPTIONS.filter((m) => m > editDraft.start_minute).map((m) => <option key={m} value={m}>{minuteLabel(m)}</option>)}
              </select>
              <button type="button" className="btn btn-primary dpe-save" disabled={!editDraft.title.trim()} onClick={saveEditor}>
                Guardar
              </button>
            </div>

            <div className="dpe-checklist">
              <h4>Checklist del bloque {editorTask.subtasks?.length > 0 && (
                <span className="dpe-checklist-count">
                  {editorTask.subtasks.filter((s) => s.is_done).length}/{editorTask.subtasks.length}
                </span>
              )}</h4>
              {(editorTask.subtasks || []).length === 0 && (
                <p className="dpe-empty">Agrega varias tareas dentro de este horario: el bloque mostrará el % de avance y se marcará hecho al completarlas todas.</p>
              )}
              <ul className="dpe-subtasks">
                {(editorTask.subtasks || []).map((subtask) => (
                  <li key={subtask.id} className={subtask.is_done ? 'is-done' : ''}>
                    <label>
                      <input type="checkbox" checked={subtask.is_done} onChange={() => toggleSubtask(editorTask, subtask)} />
                      <span>{subtask.title}</span>
                    </label>
                    <button type="button" className="dpe-sub-delete" title="Quitar" onClick={() => removeSubtask(editorTask, subtask)}>✕</button>
                  </li>
                ))}
              </ul>
              <div className="dpe-subtask-add">
                <input
                  type="text"
                  maxLength={120}
                  placeholder="Nueva tarea de la lista…"
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSubtask(); }}
                />
                <button type="button" className="btn btn-secondary" disabled={!newSubtask.trim()} onClick={addSubtask}>+ Agregar</button>
              </div>
            </div>

            <div className="dpe-move">
              <span className="dpe-move-label">Pasar a:</span>
              <button
                type="button"
                className="btn btn-secondary dpe-move-btn"
                onClick={() => {
                  const [y, m, d] = date.split('-').map(Number);
                  moveToDate(editorTask, toDateText(new Date(y, m - 1, d + 1)));
                }}
              >
                → Mañana
              </button>
              <input
                type="date"
                value={moveDate}
                min={toDateText(new Date())}
                onChange={(e) => setMoveDate(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary dpe-move-btn"
                disabled={!moveDate || moveDate === date}
                onClick={() => moveToDate(editorTask, moveDate)}
              >
                Mover
              </button>
            </div>

            <div className="dpe-foot">
              <button type="button" className="dpe-delete" onClick={() => removeTask(editorTask)}>Eliminar bloque</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
