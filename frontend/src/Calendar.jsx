// Plan del día: the team's workday at a glance. In the morning meeting each
// person logs their tasks for today with a time frame; everyone's day shows
// side by side, one column per person. Replaces the old event calendar.
import { useState, useEffect, useMemo, useCallback } from 'react';
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
  const [startMinute, setStartMinute] = useState(8 * 60);
  const [endMinute, setEndMinute] = useState(9 * 60);
  const [saving, setSaving] = useState(false);
  const [nowMinute, setNowMinute] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());

  const isToday = date === toDateText(new Date());
  const myId = Number(user?.id);

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
        body: { date, title: title.trim(), start_minute: startMinute, end_minute: endMinute }
      });
      setTasks((prev) => [...prev, data.task]);
      setTitle('');
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
        <span className="dayplan-meta-hint">Toca ✓ en tus tareas al completarlas</span>
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
            const color = USER_COLORS[member.id % USER_COLORS.length];
            const isMine = member.id === myId;
            const memberDone = memberTasks.filter((t) => t.is_done).length;
            return (
              <div key={member.id} className={`dayplan-col ${isMine ? 'is-mine' : ''}`}>
                <div className="dayplan-col-head" style={{ borderTopColor: color }}>
                  <span className="dayplan-col-name">{member.name}{isMine ? ' (yo)' : ''}</span>
                  <span className={`dayplan-col-count ${memberTasks.length === 0 ? 'is-empty' : ''}`}>
                    {memberTasks.length === 0 ? 'sin plan' : `${memberDone}/${memberTasks.length} ✓`}
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
                    const top = Math.max(0, ((task.start_minute - DAY_START) / 60) * HOUR_PX);
                    const height = Math.max(24, ((Math.min(task.end_minute, DAY_END) - Math.max(task.start_minute, DAY_START)) / 60) * HOUR_PX - 3);
                    const width = 100 / task.laneCount;
                    return (
                      <div
                        key={task.id}
                        className={`dayplan-task ${task.is_done ? 'is-done' : ''}`}
                        style={{
                          top,
                          height,
                          left: `${task.lane * width}%`,
                          width: `calc(${width}% - 4px)`,
                          background: color
                        }}
                        title={`${minuteLabel(task.start_minute)}–${minuteLabel(task.end_minute)} · ${task.title}`}
                      >
                        <span className="dayplan-task-time">{minuteLabel(task.start_minute)}–{minuteLabel(task.end_minute)}</span>
                        <span className="dayplan-task-title">{task.title}</span>
                        {isMine && (
                          <span className="dayplan-task-actions">
                            <button type="button" title={task.is_done ? 'Marcar pendiente' : 'Marcar hecha'} onClick={() => toggleDone(task)}>
                              {task.is_done ? '↺' : '✓'}
                            </button>
                            <button type="button" title="Eliminar" onClick={() => removeTask(task)}>✕</button>
                          </span>
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
    </div>
  );
}
