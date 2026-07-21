import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { canEditCampaigns, boliviaToday } from './campaignShared';
import { useToast } from './ui/toastContext';

// Calendario de Marketing: un mes a la vista con las Campañas (barras que
// abarcan su rango), los Lives (chip con hora) y los eventos propios del
// equipo (sesiones de fotos, ferias…). Click en un item → sus detalles.

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const pad2 = (n) => String(n).padStart(2, '0');
const dateText = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

const emptyEvent = (date) => ({ id: null, title: '', event_date: date, event_time: '', note: '' });

export default function MarketingCalendar({ token, role }) {
  const toast = useToast();
  const navigate = useNavigate();
  const today = boliviaToday();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventForm, setEventForm] = useState(null);   // crear/editar evento
  const [eventDetail, setEventDetail] = useState(null); // ver evento (solo lectura)
  const [saving, setSaving] = useState(false);

  const canEdit = canEditCampaigns(role);

  const load = useCallback(() => {
    Promise.all([
      apiRequest('/api/campaigns', { token }),
      apiRequest('/api/marketing-events', { token })
    ])
      .then(([camp, ev]) => {
        setCampaigns(Array.isArray(camp?.campaigns) ? camp.campaigns : []);
        setEvents(Array.isArray(ev?.events) ? ev.events : []);
      })
      .catch((err) => toast.error(err.message || 'No se pudo cargar el calendario'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // items por día del mes visible
  const { weeks, itemsByDay } = useMemo(() => {
    const { year, month } = cursor;
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leading = (first.getDay() + 6) % 7; // lunes = 0
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const weekRows = [];
    for (let i = 0; i < cells.length; i += 7) weekRows.push(cells.slice(i, i + 7));

    const map = new Map();
    const push = (day, item) => {
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(item);
    };
    for (const c of campaigns) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = dateText(year, month, d);
        if (dt >= c.start_date && dt <= c.end_date) {
          push(d, {
            type: c.kind === 'live' ? 'live' : 'campana',
            id: c.id,
            title: c.name,
            time: c.live_time,
            status: c.status,
            isStart: dt === c.start_date
          });
        }
      }
    }
    for (const e of events) {
      const [ey, em, ed] = e.event_date.split('-').map(Number);
      if (ey === year && em === month + 1) {
        push(ed, { type: 'evento', id: e.id, title: e.title, time: e.event_time, event: e });
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
    }
    return { weeks: weekRows, itemsByDay: map };
  }, [cursor, campaigns, events]);

  const shiftMonth = (delta) => {
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const openItem = (item) => {
    if (item.type === 'campana') navigate('/campanas');
    else if (item.type === 'live') navigate('/live');
    else if (canEdit) setEventForm({ ...item.event });
    else setEventDetail(item.event);
  };

  const saveEvent = async () => {
    if (!eventForm?.title.trim() || !eventForm.event_date || saving) return;
    setSaving(true);
    try {
      if (eventForm.id) {
        await apiRequest(`/api/marketing-events/${eventForm.id}`, { method: 'PUT', token, body: eventForm });
      } else {
        await apiRequest('/api/marketing-events', { method: 'POST', token, body: eventForm });
      }
      toast.success(eventForm.id ? 'Evento actualizado' : 'Evento agregado al calendario');
      setEventForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!eventForm?.id) return;
    if (!window.confirm(`¿Eliminar "${eventForm.title}"?`)) return;
    try {
      await apiRequest(`/api/marketing-events/${eventForm.id}`, { method: 'DELETE', token });
      toast.success('Evento eliminado');
      setEventForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  if (loading) return <div className="container prod-page"><p className="dashboard-muted">Cargando calendario…</p></div>;

  return (
    <div className="container prod-page">
      <div className="card plan-intro camp-intro">
        <div>
          <h2 className="plan-title">Calendario de Marketing</h2>
          <p className="plan-sub">
            Campañas, lives y eventos del equipo en un solo mes.
            {canEdit ? ' Toca un día para agregar un evento; toca un item para abrirlo.' : ' Toca un item para ver sus detalles.'}
          </p>
        </div>
        <div className="mkcal-legend">
          <span className="mkcal-chip is-campana">Campaña</span>
          <span className="mkcal-chip is-live">● Live</span>
          <span className="mkcal-chip is-evento">◆ Evento</span>
        </div>
      </div>

      <div className="mkcal-nav">
        <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
        <h3 className="mkcal-month">{MONTHS[cursor.month]} {cursor.year}</h3>
        <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button>
      </div>

      <div className="mkcal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="mkcal-weekday">{w}</div>)}
        {weeks.flat().map((day, index) => {
          if (day === null) return <div key={`x${index}`} className="mkcal-cell is-empty" />;
          const dt = dateText(cursor.year, cursor.month, day);
          const items = itemsByDay.get(day) || [];
          return (
            <div
              key={dt}
              className={`mkcal-cell ${dt === today ? 'is-today' : ''}`}
              onClick={() => { if (canEdit) setEventForm(emptyEvent(dt)); }}
              role={canEdit ? 'button' : undefined}
            >
              <span className="mkcal-daynum">{day}</span>
              {items.map((item, i) => (
                <button
                  key={`${item.type}${item.id}-${i}`}
                  type="button"
                  className={`mkcal-item is-${item.type} ${item.status === 'borrador' ? 'is-draft' : ''}`}
                  title={`${item.title}${item.time ? ` · ${item.time}` : ''}`}
                  onClick={(e) => { e.stopPropagation(); openItem(item); }}
                >
                  {item.type === 'live' && <span className="mkcal-live-dot" />}
                  {item.type === 'evento' && '◆ '}
                  {item.time ? `${item.time} ` : ''}
                  {item.type === 'campana' && !item.isStart ? '· ' : ''}
                  {item.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <p className="pipe-hint">
          Las campañas se editan en <strong>Campañas</strong> y los lives en <strong>Live</strong> —
          aquí se abren con un toque. Los eventos ◆ son solo del calendario.
        </p>
      )}

      {eventForm && (
        <div className="mkcal-modal-backdrop" onClick={() => setEventForm(null)}>
          <div className="mkcal-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{eventForm.id ? 'Editar evento' : 'Nuevo evento'}</h3>
            <div className="camp-form-grid">
              <label className="camp-field camp-field-wide">
                <span>Título</span>
                <input
                  type="text" maxLength={160} value={eventForm.title}
                  placeholder="Ej. Sesión de fotos línea Acero"
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                />
              </label>
              <label className="camp-field">
                <span>Fecha</span>
                <input type="date" value={eventForm.event_date} onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })} />
              </label>
              <label className="camp-field">
                <span>Hora (opcional)</span>
                <input type="time" value={eventForm.event_time || ''} onChange={(e) => setEventForm({ ...eventForm, event_time: e.target.value })} />
              </label>
              <label className="camp-field camp-field-wide">
                <span>Nota (opcional)</span>
                <textarea rows={2} maxLength={1000} value={eventForm.note} onChange={(e) => setEventForm({ ...eventForm, note: e.target.value })} />
              </label>
            </div>
            <div className="camp-form-actions">
              {eventForm.id && (
                <button type="button" className="camp-delete" title="Eliminar evento" onClick={deleteEvent}>🗑</button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setEventForm(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={saveEvent} disabled={saving || !eventForm.title.trim() || !eventForm.event_date}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventDetail && (
        <div className="mkcal-modal-backdrop" onClick={() => setEventDetail(null)}>
          <div className="mkcal-modal" onClick={(e) => e.stopPropagation()}>
            <h3>◆ {eventDetail.title}</h3>
            <p className="mkcal-detail-line">
              📅 {eventDetail.event_date}{eventDetail.event_time ? ` · ${eventDetail.event_time}` : ''}
            </p>
            {eventDetail.note && <p className="mkcal-detail-note">{eventDetail.note}</p>}
            {eventDetail.author && <p className="mkcal-detail-line">Creado por {eventDetail.author}</p>}
            <div className="camp-form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEventDetail(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
