import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import {
  CAMPAIGN_AREAS, AREA_LABELS, areaForRole, canEditCampaigns, canTickAnyArea,
  boliviaToday, campaignIsActive, formatCampaignDate
} from './campaignShared';

// Campañas: Marketing organiza campañas (1-2 por mes) y comunica a cada área
// sus responsabilidades. Todos ven el plan; cada área marca lo suyo como listo
// y Marketing sigue el avance en tiempo real.

const emptyForm = () => ({
  id: null,
  name: '',
  objective: '',
  start_date: '',
  end_date: '',
  tasks: CAMPAIGN_AREAS.map((area) => ({ id: null, area, title: '' }))
});

const STATUS_META = {
  borrador: { label: 'Borrador', className: 'is-borrador' },
  anunciada: { label: 'Anunciada', className: 'is-anunciada' },
  finalizada: { label: 'Finalizada', className: 'is-finalizada' }
};

export default function CampaignsPanel({ token, role }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null = list view
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState(null);

  const canEdit = canEditCampaigns(role);
  const tickAny = canTickAnyArea(role);
  const myArea = areaForRole(role);
  const today = boliviaToday();

  const load = useCallback(() => {
    apiRequest('/api/campaigns', { token })
      .then((data) => {
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
        setError('');
      })
      .catch((err) => setError(err.message || 'No se pudieron cargar las campañas'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const { current, finished } = useMemo(() => {
    const cur = [];
    const fin = [];
    for (const c of campaigns) (c.status === 'finalizada' ? fin : cur).push(c);
    cur.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    return { current: cur, finished: fin };
  }, [campaigns]);

  const openCreate = () => { setFormError(''); setForm(emptyForm()); };
  const openEdit = (campaign) => {
    setFormError('');
    setForm({
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective || '',
      start_date: campaign.start_date,
      end_date: campaign.end_date,
      tasks: campaign.tasks.map((t) => ({ id: t.id, area: t.area, title: t.title }))
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
        start_date: form.start_date,
        end_date: form.end_date,
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

  const setStatus = async (campaign, status) => {
    const messages = {
      anunciada: `¿Anunciar "${campaign.name}" a todo el equipo? Aparecerá en el Inicio de todos.`,
      finalizada: `¿Finalizar "${campaign.name}"? Las listas quedarán cerradas.`,
      borrador: `¿Volver "${campaign.name}" a borrador?`
    };
    if (!window.confirm(messages[status])) return;
    try {
      await apiRequest(`/api/campaigns/${campaign.id}/status`, { method: 'PATCH', token, body: { status } });
      load();
    } catch (err) {
      setError(err.message || 'No se pudo cambiar el estado');
    }
  };

  const removeCampaign = async (campaign) => {
    if (!window.confirm(`¿Eliminar la campaña "${campaign.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await apiRequest(`/api/campaigns/${campaign.id}`, { method: 'DELETE', token });
      load();
    } catch (err) {
      setError(err.message || 'No se pudo eliminar');
    }
  };

  const toggleTask = async (campaign, task) => {
    if (campaign.status === 'finalizada') return;
    setBusyTaskId(task.id);
    try {
      await apiRequest(`/api/campaigns/tasks/${task.id}/done`, { method: 'PATCH', token, body: { done: !task.done } });
      setCampaigns((prev) => prev.map((c) => (
        c.id === campaign.id
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
        <div className="card camp-form">
          <h2 className="plan-title">{form.id ? 'Editar campaña' : 'Nueva campaña'}</h2>
          <p className="plan-sub">
            Define la campaña y lo que cada área debe tener listo. Al <strong>anunciarla</strong>,
            todo el equipo la verá en su Inicio con sus responsabilidades.
          </p>
          <div className="camp-form-grid">
            <label className="camp-field camp-field-wide">
              <span>Nombre de la campaña</span>
              <input
                type="text"
                value={form.name}
                maxLength={120}
                placeholder="Ej. Campaña Día de la Madre"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="camp-field">
              <span>Inicio</span>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </label>
            <label className="camp-field">
              <span>Fin</span>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </label>
            <label className="camp-field camp-field-wide">
              <span>Objetivo (opcional)</span>
              <textarea
                rows={2}
                value={form.objective}
                placeholder="Ej. Impulsar la línea Armonía con 20% de descuento y sorteos en tienda."
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
              />
            </label>
          </div>

          <h3 className="camp-tasks-title">Responsabilidades por área</h3>
          <p className="camp-tasks-hint">
            Escribe qué debe preparar cada área. Puedes agregar varias tareas para la misma área.
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
                  type="text"
                  value={task.title}
                  maxLength={300}
                  placeholder={`Qué debe tener listo ${AREA_LABELS[task.area]}…`}
                  onChange={(e) => {
                    const tasks = [...form.tasks];
                    tasks[index] = { ...task, title: e.target.value };
                    setForm({ ...form, tasks });
                  }}
                />
                <button
                  type="button"
                  className="camp-task-remove"
                  title="Quitar fila"
                  onClick={() => setForm({ ...form, tasks: form.tasks.filter((_, i) => i !== index) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary camp-add-row"
            onClick={() => setForm({ ...form, tasks: [...form.tasks, { id: null, area: 'ventas', title: '' }] })}
          >
            + Agregar tarea
          </button>

          {formError && <div className="camp-error">{formError}</div>}
          <div className="camp-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={saveForm} disabled={saving || !form.name.trim()}>
              {saving ? 'Guardando…' : (form.id ? 'Guardar cambios' : 'Crear campaña')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderCampaign = (campaign) => {
    const active = campaignIsActive(campaign, today);
    const meta = STATUS_META[campaign.status] || STATUS_META.borrador;
    const areasWithTasks = CAMPAIGN_AREAS.filter((area) => campaign.tasks.some((t) => t.area === area));
    const doneCount = campaign.tasks.filter((t) => t.done).length;
    const allReady = campaign.tasks.length > 0 && doneCount === campaign.tasks.length;
    return (
      <div key={campaign.id} className={`camp-card ${active ? 'is-active' : ''}`}>
        <div className="camp-card-head">
          <div>
            <div className="camp-card-name">
              {campaign.name}
              <span className={`camp-status ${active ? 'is-activa' : meta.className}`}>
                {active ? 'En curso' : meta.label}
              </span>
              {allReady && campaign.status !== 'finalizada' && (
                <span className="camp-status is-ready">✓ Todo listo</span>
              )}
            </div>
            <div className="camp-card-dates">
              {formatCampaignDate(campaign.start_date)} — {formatCampaignDate(campaign.end_date)}
              {campaign.created_by ? ` · creada por ${campaign.created_by}` : ''}
            </div>
            {campaign.objective && <p className="camp-card-objective">{campaign.objective}</p>}
          </div>
          {canEdit && (
            <div className="camp-card-actions">
              {campaign.status === 'borrador' && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setStatus(campaign, 'anunciada')}>
                  📣 Anunciar
                </button>
              )}
              {campaign.status === 'anunciada' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(campaign, 'finalizada')}>
                  Finalizar
                </button>
              )}
              {campaign.status === 'finalizada' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(campaign, 'anunciada')}>
                  Reabrir
                </button>
              )}
              {campaign.status !== 'finalizada' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(campaign)}>
                  Editar
                </button>
              )}
              <button type="button" className="camp-delete" title="Eliminar campaña" onClick={() => removeCampaign(campaign)}>
                🗑
              </button>
            </div>
          )}
        </div>

        {campaign.status === 'borrador' && canEdit && (
          <div className="camp-draft-note">
            Solo Marketing y Admin ven este borrador. Anúnciala para que todo el equipo la reciba.
          </div>
        )}

        {areasWithTasks.length === 0 && (
          <div className="camp-empty-tasks">Sin responsabilidades definidas todavía.</div>
        )}

        <div className="camp-areas">
          {areasWithTasks.map((area) => {
            const areaTasks = campaign.tasks.filter((t) => t.area === area);
            const done = areaTasks.filter((t) => t.done).length;
            const mine = tickAny || myArea === area;
            const locked = campaign.status === 'finalizada';
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
                  <div
                    className="camp-area-bar-fill"
                    style={{ width: `${areaTasks.length ? (done / areaTasks.length) * 100 : 0}%` }}
                  />
                </div>
                <ul className="camp-task-list">
                  {areaTasks.map((task) => (
                    <li key={task.id} className={task.done ? 'is-done' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={task.done}
                          disabled={!mine || locked || busyTaskId === task.id}
                          onChange={() => toggleTask(campaign, task)}
                        />
                        <span>{task.title}</span>
                      </label>
                      {task.done && task.done_by && (
                        <span className="camp-task-by">✓ {task.done_by}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="container prod-page">
      <div className="card plan-intro camp-intro">
        <div>
          <h2 className="plan-title">Campañas</h2>
          <p className="plan-sub">
            {canEdit
              ? 'Organiza cada campaña y comunica a todas las áreas qué deben tener listo.'
              : `Aquí ves las campañas del negocio y las responsabilidades de tu área${myArea ? ` (${AREA_LABELS[myArea]})` : ''}. Marca lo tuyo cuando esté listo.`}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + Nueva campaña
          </button>
        )}
      </div>

      {error && <div className="camp-error">{error}</div>}
      {loading && <div className="card">Cargando campañas…</div>}

      {!loading && current.length === 0 && (
        <div className="card camp-empty">
          {canEdit
            ? 'No hay campañas en curso. Crea la primera con “+ Nueva campaña”.'
            : 'No hay campañas en curso por ahora.'}
        </div>
      )}

      {current.map(renderCampaign)}

      {finished.length > 0 && (
        <div className="camp-finished">
          <button type="button" className="camp-finished-toggle" onClick={() => setShowFinished((v) => !v)}>
            {showFinished ? '▾' : '▸'} Campañas finalizadas ({finished.length})
          </button>
          {showFinished && finished.map(renderCampaign)}
        </div>
      )}
    </div>
  );
}
