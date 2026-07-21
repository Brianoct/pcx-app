import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import InvestmentBox from './InvestmentBox';
import {
  CAMPAIGN_AREAS, AREA_LABELS, areaForRole, canEditCampaigns, canTickAnyArea,
  boliviaToday, formatCampaignDate
} from './campaignShared';

// Live: programación de TikTok Lives. Reutiliza la maquinaria de campañas
// (tareas por área, anuncio al equipo, banner en Inicio) con kind='live':
// una sola fecha + hora, y las áreas afectadas marcan lo suyo como listo.

const emptyForm = () => ({
  id: null,
  name: '',
  objective: '',
  expected_return: '',
  date: '',
  live_time: '20:00',
  tasks: [
    { id: null, area: 'marketing', title: '' },
    { id: null, area: 'ventas', title: '' },
    { id: null, area: 'almacen', title: '' }
  ]
});

const STATUS_META = {
  borrador: { label: 'Borrador', className: 'is-borrador' },
  anunciada: { label: 'Anunciado', className: 'is-anunciada' },
  finalizada: { label: 'Finalizado', className: 'is-finalizada' }
};

export default function LivePanel({ token, role }) {
  const [lives, setLives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState(null);
  const [investmentById, setInvestmentById] = useState({});

  const canEdit = canEditCampaigns(role);
  const tickAny = canTickAnyArea(role);
  const myArea = areaForRole(role);
  const today = boliviaToday();

  const load = useCallback(() => {
    apiRequest('/api/campaigns', { token })
      .then((data) => {
        const all = Array.isArray(data?.campaigns) ? data.campaigns : [];
        setLives(all.filter((c) => c.kind === 'live'));
        setError('');
      })
      .catch((err) => setError(err.message || 'No se pudieron cargar los lives'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const loadInvestment = useCallback(() => {
    if (!canEdit) return;
    apiRequest('/api/campaigns/investment', { token })
      .then((data) => {
        const map = {};
        for (const item of data?.items || []) map[item.id] = item;
        setInvestmentById(map);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canEdit]);

  useEffect(() => { loadInvestment(); }, [loadInvestment]);

  const { upcoming, finished } = useMemo(() => {
    const up = [];
    const fin = [];
    for (const live of lives) (live.status === 'finalizada' ? fin : up).push(live);
    up.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))
      || String(a.live_time || '').localeCompare(String(b.live_time || '')));
    return { upcoming: up, finished: fin };
  }, [lives]);

  const openEdit = (live) => {
    setFormError('');
    setForm({
      id: live.id,
      name: live.name,
      objective: live.objective || '',
      expected_return: live.expected_return ?? '',
      date: live.start_date,
      live_time: live.live_time || '20:00',
      tasks: live.tasks.map((t) => ({ id: t.id, area: t.area, title: t.title }))
    });
  };

  const saveForm = async () => {
    if (!form) return;
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name,
        objective: form.objective,
        start_date: form.date,
        end_date: form.date,
        kind: 'live',
        live_time: form.live_time || null,
        expected_return: form.expected_return === '' ? null : Number(form.expected_return),
        tasks: form.tasks.filter((t) => t.title.trim())
      };
      if (form.id) {
        await apiRequest(`/api/campaigns/${form.id}`, { method: 'PUT', token, body: payload });
      } else {
        await apiRequest('/api/campaigns', { method: 'POST', token, body: payload });
      }
      setForm(null);
      load();
    } catch (err) {
      setFormError(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (live, status) => {
    const messages = {
      anunciada: `¿Anunciar el live "${live.name}" a todo el equipo? Aparecerá en el Inicio de todos.`,
      finalizada: `¿Marcar "${live.name}" como finalizado?`,
      borrador: `¿Volver "${live.name}" a borrador?`
    };
    if (!window.confirm(messages[status])) return;
    try {
      await apiRequest(`/api/campaigns/${live.id}/status`, { method: 'PATCH', token, body: { status } });
      load();
    } catch (err) {
      setError(err.message || 'No se pudo cambiar el estado');
    }
  };

  const removeLive = async (live) => {
    if (!window.confirm(`¿Eliminar el live "${live.name}"?`)) return;
    try {
      await apiRequest(`/api/campaigns/${live.id}`, { method: 'DELETE', token });
      load();
    } catch (err) {
      setError(err.message || 'No se pudo eliminar');
    }
  };

  const toggleTask = async (live, task) => {
    if (live.status === 'finalizada') return;
    setBusyTaskId(task.id);
    try {
      await apiRequest(`/api/campaigns/tasks/${task.id}/done`, { method: 'PATCH', token, body: { done: !task.done } });
      setLives((prev) => prev.map((c) => (
        c.id === live.id
          ? { ...c, tasks: c.tasks.map((t) => (t.id === task.id ? { ...t, done: !task.done } : t)) }
          : c
      )));
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la tarea');
    } finally {
      setBusyTaskId(null);
    }
  };

  if (form) {
    return (
      <div className="container prod-page">
        <div className="card live-form">
          <h2 className="live-form-title"><span className="live-dot" /> {form.id ? 'Editar Live' : 'Nuevo Live'}</h2>
          <p className="plan-sub">
            Programa el TikTok Live y define qué debe tener listo cada área afectada.
            Al <strong>anunciarlo</strong>, todo el equipo lo verá en su Inicio.
          </p>
          <div className="camp-form-grid">
            <label className="camp-field camp-field-wide">
              <span>Título del Live</span>
              <input
                type="text" maxLength={120} value={form.name}
                placeholder="Ej. Live de lanzamiento: organizadores Armonía"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="camp-field">
              <span>Fecha</span>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="camp-field">
              <span>Hora</span>
              <input type="time" value={form.live_time} onChange={(e) => setForm({ ...form, live_time: e.target.value })} />
            </label>
            <label className="camp-field camp-field-wide">
              <span>Qué se mostrará / objetivo (opcional)</span>
              <textarea
                rows={2} value={form.objective}
                placeholder="Ej. Demostración de tableros en vivo, 10% de descuento con el código LIVE10."
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
              />
            </label>
            <label className="camp-field">
              <span>Retorno esperado (Bs)</span>
              <input
                type="number" min="0" step="1" value={form.expected_return}
                placeholder="El camino claro al retorno"
                onChange={(e) => setForm({ ...form, expected_return: e.target.value })}
              />
            </label>
          </div>

          <h3 className="camp-tasks-title">Preparación por área</h3>
          <p className="camp-tasks-hint">
            Qué necesita el live de cada área: productos listos en almacén, stock verificado, guion de ventas…
          </p>
          <div className="camp-task-rows">
            {form.tasks.map((task, index) => (
              <div key={index} className="camp-task-row">
                <select
                  value={task.area}
                  onChange={(e) => {
                    const tasks = [...form.tasks];
                    tasks[index] = { ...task, area: e.target.value };
                    setForm({ ...form, tasks });
                  }}
                >
                  {CAMPAIGN_AREAS.map((area) => (
                    <option key={area} value={area}>{AREA_LABELS[area]}</option>
                  ))}
                </select>
                <input
                  type="text" maxLength={300} value={task.title}
                  placeholder={`Qué debe preparar ${AREA_LABELS[task.area]}…`}
                  onChange={(e) => {
                    const tasks = [...form.tasks];
                    tasks[index] = { ...task, title: e.target.value };
                    setForm({ ...form, tasks });
                  }}
                />
                <button
                  type="button" className="camp-task-remove" title="Quitar fila"
                  onClick={() => setForm({ ...form, tasks: form.tasks.filter((_, i) => i !== index) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button" className="btn btn-secondary camp-add-row"
            onClick={() => setForm({ ...form, tasks: [...form.tasks, { id: null, area: 'marketing', title: '' }] })}
          >
            + Agregar tarea
          </button>

          {formError && <div className="camp-error">{formError}</div>}
          <div className="camp-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button" className="btn btn-primary" onClick={saveForm}
              disabled={saving || !form.name.trim() || !form.date}
            >
              {saving ? 'Guardando…' : (form.id ? 'Guardar cambios' : 'Crear Live')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderLive = (live) => {
    const meta = STATUS_META[live.status] || STATUS_META.borrador;
    const isToday = live.status === 'anunciada' && live.start_date === today;
    const areasWithTasks = CAMPAIGN_AREAS.filter((area) => live.tasks.some((t) => t.area === area));
    const doneCount = live.tasks.filter((t) => t.done).length;
    const allReady = live.tasks.length > 0 && doneCount === live.tasks.length;
    return (
      <div key={live.id} className={`live-card ${isToday ? 'is-today' : ''}`}>
        <div className="live-card-head">
          <div className="live-when">
            <span className="live-when-date">{formatCampaignDate(live.start_date)}</span>
            <span className="live-when-time">{live.live_time || '—'}</span>
          </div>
          <div className="live-card-main">
            <div className="live-card-name">
              {isToday ? <span className="live-badge"><span className="live-dot" /> HOY</span> : null}
              {live.name}
              <span className={`camp-status ${meta.className}`}>{meta.label}</span>
              {allReady && live.status !== 'finalizada' && <span className="camp-status is-ready">✓ Todo listo</span>}
            </div>
            {live.objective && <p className="live-card-objective">{live.objective}</p>}
          </div>
          {canEdit && (
            <div className="camp-card-actions">
              {live.status === 'borrador' && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setStatus(live, 'anunciada')}>
                  📣 Anunciar
                </button>
              )}
              {live.status === 'anunciada' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(live, 'finalizada')}>
                  Finalizar
                </button>
              )}
              {live.status !== 'finalizada' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(live)}>
                  Editar
                </button>
              )}
              <button type="button" className="camp-delete" title="Eliminar" onClick={() => removeLive(live)}>🗑</button>
            </div>
          )}
        </div>

        {live.status === 'borrador' && canEdit && (
          <div className="camp-draft-note">
            Solo Marketing y Admin ven este borrador. Anúncialo para que las áreas afectadas se preparen.
          </div>
        )}

        <div className="camp-areas">
          {areasWithTasks.map((area) => {
            const areaTasks = live.tasks.filter((t) => t.area === area);
            const done = areaTasks.filter((t) => t.done).length;
            const mine = tickAny || myArea === area;
            const locked = live.status === 'finalizada';
            return (
              <div key={area} className={`camp-area ${mine && !locked ? 'is-mine' : ''}`}>
                <div className="camp-area-head">
                  <span className="camp-area-name">
                    {AREA_LABELS[area]}
                    {myArea === area && <span className="camp-area-tag">tu área</span>}
                  </span>
                  <span className={`camp-area-progress ${done === areaTasks.length ? 'is-done' : ''}`}>
                    {done}/{areaTasks.length} listo
                  </span>
                </div>
                <div className="camp-area-bar">
                  <div className="camp-area-bar-fill" style={{ width: `${areaTasks.length ? (done / areaTasks.length) * 100 : 0}%` }} />
                </div>
                <ul className="camp-task-list">
                  {areaTasks.map((task) => (
                    <li key={task.id} className={task.done ? 'is-done' : ''}>
                      <label>
                        <input
                          type="checkbox" checked={task.done}
                          disabled={!mine || locked || busyTaskId === task.id}
                          onChange={() => toggleTask(live, task)}
                        />
                        <span>{task.title}</span>
                      </label>
                      {task.done && task.done_by && <span className="camp-task-by">✓ {task.done_by}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {canEdit && (
          <InvestmentBox
            token={token}
            campaignId={live.id}
            investment={investmentById[live.id]}
            onChanged={loadInvestment}
          />
        )}
      </div>
    );
  };

  return (
    <div className="container prod-page">
      <div className="card plan-intro camp-intro live-intro">
        <div>
          <h2 className="plan-title"><span className="live-dot" /> Live</h2>
          <p className="plan-sub">
            {canEdit
              ? 'Programa los TikTok Lives y avisa a las áreas afectadas qué deben tener listo.'
              : `Aquí ves los lives programados y lo que tu área${myArea ? ` (${AREA_LABELS[myArea]})` : ''} debe preparar.`}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setForm(emptyForm()); }}>
            + Nuevo Live
          </button>
        )}
      </div>

      {error && <div className="camp-error">{error}</div>}
      {loading && <div className="card">Cargando lives…</div>}

      {!loading && upcoming.length === 0 && (
        <div className="card camp-empty">
          {canEdit ? 'No hay lives programados. Crea el primero con “+ Nuevo Live”.' : 'No hay lives programados por ahora.'}
        </div>
      )}

      {upcoming.map(renderLive)}

      {finished.length > 0 && (
        <div className="camp-finished">
          <button type="button" className="camp-finished-toggle" onClick={() => setShowFinished((v) => !v)}>
            {showFinished ? '▾' : '▸'} Lives finalizados ({finished.length})
          </button>
          {showFinished && finished.map(renderLive)}
        </div>
      )}
    </div>
  );
}
