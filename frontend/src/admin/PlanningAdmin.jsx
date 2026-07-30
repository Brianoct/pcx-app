// Planificación estratégica: Programa (área) → Operación → Misión → Tarea.
// Una operación (ej: "Instalar fábrica en Lima") reúne misiones por área;
// cada misión tiene objetivo y tareas con fecha. Las tareas se envían al
// Plan del día, donde aparecen con checkbox y el check se sincroniza.
import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../apiClient';
import { useToast } from '../ui/toastContext';

const AREA_META = {
  marketing: { label: 'Marketing', icon: '📣' },
  ventas: { label: 'Ventas', icon: '💼' },
  almacen: { label: 'Almacén', icon: '📦' },
  produccion: { label: 'Producción', icon: '🏭' },
  admin: { label: 'Desarrollo', icon: '🛠️' }
};

const STATUS_META = {
  activa: { label: 'Activa', cls: 'is-activa' },
  pausada: { label: 'Pausada', cls: 'is-pausada' },
  completada: { label: 'Completada', cls: 'is-completada' }
};

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const todayText = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const shortDate = (text) => {
  if (!text) return '';
  const [, m, d] = String(text).split('-').map(Number);
  return `${d} ${MONTH_SHORT[(m || 1) - 1]}`;
};

export default function PlanningAdmin({ token }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [opForm, setOpForm] = useState({ name: '', description: '', start_date: '', end_date: '' });
  const [showOpForm, setShowOpForm] = useState(false);
  const [missionForms, setMissionForms] = useState({});   // area -> {name, objective} | undefined
  const [taskForms, setTaskForms] = useState({});         // missionId -> {title, due_date} | undefined
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/api/planning', { token });
      setData(res);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar la planificación');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const operations = data?.operations || [];
  const areas = data?.areas || Object.keys(AREA_META);
  const selected = operations.find((op) => op.id === selectedId)
    || operations.find((op) => op.status !== 'completada')
    || operations[0]
    || null;

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo completar la acción');
    } finally {
      setBusy(false);
    }
  };

  const createOperation = () => {
    if (!opForm.name.trim()) return;
    run(async () => {
      const res = await apiRequest('/api/planning/operations', {
        method: 'POST', token,
        body: {
          name: opForm.name.trim(),
          description: opForm.description.trim(),
          start_date: opForm.start_date || '',
          end_date: opForm.end_date || ''
        }
      });
      setOpForm({ name: '', description: '', start_date: '', end_date: '' });
      setShowOpForm(false);
      setSelectedId(res?.operation?.id || null);
    }, 'Operación creada');
  };

  const setOperationStatus = (op, status) => {
    run(() => apiRequest(`/api/planning/operations/${op.id}`, { method: 'PATCH', token, body: { status } }));
  };

  const deleteOperation = (op) => {
    if (!window.confirm(`¿Eliminar la operación "${op.name}" con todas sus misiones y tareas?`)) return;
    run(() => apiRequest(`/api/planning/operations/${op.id}`, { method: 'DELETE', token }), 'Operación eliminada');
  };

  const createMission = (area) => {
    const form = missionForms[area];
    if (!form?.name?.trim() || !selected) return;
    run(async () => {
      await apiRequest('/api/planning/missions', {
        method: 'POST', token,
        body: { operation_id: selected.id, area, name: form.name.trim(), objective: (form.objective || '').trim() }
      });
      setMissionForms((prev) => ({ ...prev, [area]: undefined }));
    }, 'Misión creada');
  };

  const deleteMission = (mission) => {
    if (!window.confirm(`¿Eliminar la misión "${mission.name}" con sus tareas?`)) return;
    run(() => apiRequest(`/api/planning/missions/${mission.id}`, { method: 'DELETE', token }), 'Misión eliminada');
  };

  const createTask = (missionId) => {
    const form = taskForms[missionId];
    if (!form?.title?.trim()) return;
    run(async () => {
      await apiRequest('/api/planning/tasks', {
        method: 'POST', token,
        body: { mission_id: missionId, title: form.title.trim(), due_date: form.due_date || '' }
      });
      setTaskForms((prev) => ({ ...prev, [missionId]: { title: '', due_date: form.due_date || '' } }));
    });
  };

  const toggleTask = (task) => {
    run(() => apiRequest(`/api/planning/tasks/${task.id}`, {
      method: 'PATCH', token, body: { is_done: !task.is_done }
    }));
  };

  const deleteTask = (task) => {
    if (!window.confirm(`¿Eliminar la tarea "${task.title}"?`)) return;
    run(() => apiRequest(`/api/planning/tasks/${task.id}`, { method: 'DELETE', token }));
  };

  const sendToDayPlan = (task) => {
    run(() => apiRequest(`/api/planning/tasks/${task.id}/to-dayplan`, { method: 'POST', token, body: {} }),
      'Agregada a tu Plan del día 📋');
  };

  if (!data) return <p className="dashboard-muted">Cargando planificación…</p>;

  const today = todayText();

  return (
    <div className="plan-admin">
      <div className="plan-head">
        <div>
          <h3 className="plan-title">Planificación estratégica</h3>
          <p className="plan-sub">Programa (área) → Operación → Misión → Tarea · las tareas van al Plan del día</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowOpForm((v) => !v)}>
          {showOpForm ? 'Cancelar' : '+ Nueva operación'}
        </button>
      </div>

      {showOpForm && (
        <div className="card plan-op-form">
          <input
            type="text" maxLength={120} placeholder="Nombre de la operación (ej: Instalar fábrica en Lima, Perú)"
            value={opForm.name} onChange={(e) => setOpForm({ ...opForm, name: e.target.value })}
          />
          <input
            type="text" maxLength={500} placeholder="Descripción (opcional)"
            value={opForm.description} onChange={(e) => setOpForm({ ...opForm, description: e.target.value })}
          />
          <div className="plan-op-form-dates">
            <label>Inicio
              <input type="date" value={opForm.start_date} onChange={(e) => setOpForm({ ...opForm, start_date: e.target.value })} />
            </label>
            <label>Fin
              <input type="date" value={opForm.end_date} onChange={(e) => setOpForm({ ...opForm, end_date: e.target.value })} />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy || !opForm.name.trim()} onClick={createOperation}>
              Crear operación
            </button>
          </div>
        </div>
      )}

      {operations.length === 0 ? (
        <div className="card plan-empty">
          <p>Aún no hay operaciones. Crea la primera — por ejemplo: <em>"Instalar fábrica en Lima, Perú"</em> — y luego agrega misiones por área con sus tareas.</p>
        </div>
      ) : (
        <div className="plan-ops-row">
          {operations.map((op) => {
            const statusMeta = STATUS_META[op.status] || STATUS_META.activa;
            const pct = op.task_count > 0 ? Math.round((op.done_count / op.task_count) * 100) : 0;
            return (
              <button
                key={op.id} type="button"
                className={`plan-op-card ${selected?.id === op.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(op.id)}
              >
                <span className="plan-op-card-top">
                  <strong>{op.name}</strong>
                  <span className={`plan-status-chip ${statusMeta.cls}`}>{statusMeta.label}</span>
                </span>
                {(op.start_date || op.end_date) && (
                  <span className="plan-op-dates">
                    {op.start_date ? shortDate(op.start_date) : '…'} → {op.end_date ? shortDate(op.end_date) : '…'}
                  </span>
                )}
                <span className="plan-op-progress">
                  <span className="plan-op-progress-bar"><span style={{ width: `${pct}%` }} /></span>
                  <span className="plan-op-progress-text">{op.done_count}/{op.task_count} tareas</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="plan-detail">
          <div className="plan-detail-head">
            <div>
              <h4 className="plan-detail-title">{selected.name}</h4>
              {selected.description && <p className="plan-detail-desc">{selected.description}</p>}
            </div>
            <div className="plan-detail-actions">
              <select
                value={selected.status}
                onChange={(e) => setOperationStatus(selected, e.target.value)}
                disabled={busy}
                title="Estado de la operación"
              >
                {Object.entries(STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary plan-danger" disabled={busy} onClick={() => deleteOperation(selected)}>
                Eliminar
              </button>
            </div>
          </div>

          <div className="plan-areas">
            {areas.map((area) => {
              const meta = AREA_META[area] || { label: area, icon: '•' };
              const missions = selected.missions.filter((m) => m.area === area);
              const form = missionForms[area];
              return (
                <section key={area} className="plan-area card">
                  <div className="plan-area-head">
                    <span className="plan-area-name">{meta.icon} {meta.label}</span>
                    <button
                      type="button" className="btn btn-secondary plan-mini-btn"
                      onClick={() => setMissionForms((prev) => ({
                        ...prev,
                        [area]: prev[area] ? undefined : { name: '', objective: '' }
                      }))}
                    >
                      {form ? 'Cancelar' : '+ Misión'}
                    </button>
                  </div>

                  {form && (
                    <div className="plan-mission-form">
                      <input
                        type="text" maxLength={120} placeholder="Nombre de la misión"
                        value={form.name}
                        onChange={(e) => setMissionForms((prev) => ({ ...prev, [area]: { ...form, name: e.target.value } }))}
                      />
                      <input
                        type="text" maxLength={500} placeholder="Objetivo (¿qué queremos lograr?)"
                        value={form.objective}
                        onChange={(e) => setMissionForms((prev) => ({ ...prev, [area]: { ...form, objective: e.target.value } }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') createMission(area); }}
                      />
                      <button type="button" className="btn btn-primary plan-mini-btn" disabled={busy || !form.name.trim()} onClick={() => createMission(area)}>
                        Crear
                      </button>
                    </div>
                  )}

                  {missions.length === 0 && !form && (
                    <p className="plan-area-empty">Sin misiones todavía.</p>
                  )}

                  {missions.map((mission) => {
                    const taskForm = taskForms[mission.id];
                    return (
                      <div key={mission.id} className="plan-mission">
                        <div className="plan-mission-head">
                          <div className="plan-mission-info">
                            <strong>{mission.name}</strong>
                            {mission.objective && <span className="plan-mission-objective">🎯 {mission.objective}</span>}
                          </div>
                          <span className="plan-mission-side">
                            <span className="plan-mission-count">{mission.done_count}/{mission.tasks.length} ✓</span>
                            <button type="button" className="plan-icon-btn" title="Eliminar misión" onClick={() => deleteMission(mission)}>✕</button>
                          </span>
                        </div>

                        <ul className="plan-tasks">
                          {mission.tasks.map((task) => {
                            const overdue = !task.is_done && task.due_date && task.due_date < today;
                            return (
                              <li key={task.id} className={`plan-task ${task.is_done ? 'is-done' : ''}`}>
                                <label className="plan-task-check">
                                  <input type="checkbox" checked={task.is_done} disabled={busy} onChange={() => toggleTask(task)} />
                                  <span className="plan-task-title">{task.title}</span>
                                </label>
                                {task.due_date && (
                                  <span className={`plan-task-due ${overdue ? 'is-overdue' : ''}`}>📅 {shortDate(task.due_date)}</span>
                                )}
                                {task.in_my_day ? (
                                  <span className="plan-task-inday" title="Ya está en tu Plan del día">📋 En tu día</span>
                                ) : (
                                  <button type="button" className="plan-mini-btn btn btn-secondary" disabled={busy} onClick={() => sendToDayPlan(task)} title="Enviar a mi Plan del día">
                                    → Mi día
                                  </button>
                                )}
                                <button type="button" className="plan-icon-btn" title="Eliminar tarea" onClick={() => deleteTask(task)}>✕</button>
                              </li>
                            );
                          })}
                        </ul>

                        <div className="plan-task-form">
                          <input
                            type="text" maxLength={120} placeholder="Nueva tarea…"
                            value={taskForm?.title || ''}
                            onChange={(e) => setTaskForms((prev) => ({ ...prev, [mission.id]: { ...(taskForm || {}), title: e.target.value } }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') createTask(mission.id); }}
                          />
                          <input
                            type="date"
                            value={taskForm?.due_date || ''}
                            title="Fecha límite"
                            onChange={(e) => setTaskForms((prev) => ({ ...prev, [mission.id]: { ...(taskForm || {}), due_date: e.target.value } }))}
                          />
                          <button type="button" className="btn btn-secondary plan-mini-btn" disabled={busy || !taskForm?.title?.trim()} onClick={() => createTask(mission.id)}>
                            + Tarea
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
