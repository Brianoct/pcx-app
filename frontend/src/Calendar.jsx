import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';
import { useToast } from './ui/toastContext';
import {
  DEFAULT_TYPE_MAP,
  EVENT_TYPE_LIST,
  MONTH_LABELS,
  STATUS_LABELS,
  WEEKDAY_LABELS,
  buildTypeMap,
  eventsOnDay,
  formatDateLong,
  getMonthGrid,
  toDateText,
  todayText
} from './calendarShared';

const emptyForm = (dayText, typeKey = 'meeting', typeMap = DEFAULT_TYPE_MAP) => ({
  id: null,
  title: '',
  event_type: typeKey,
  start_date: dayText,
  end_date: dayText,
  all_day: typeMap[typeKey]?.default_all_day ?? true,
  start_time: '',
  end_time: '',
  visibility: 'team',
  notes: ''
});

export default function Calendar({ token }) {
  const { enqueueWrite } = useOutbox();
  const toast = useToast();
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState([]);
  const [typeList, setTypeList] = useState(EVENT_TYPE_LIST);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => emptyForm(todayText()));
  const [selectedEvent, setSelectedEvent] = useState(null);

  const typeMap = useMemo(() => buildTypeMap(typeList), [typeList]);
  const grid = useMemo(() => getMonthGrid(monthCursor), [monthCursor]);
  const windowBounds = useMemo(() => ({
    start: toDateText(grid[0]),
    end: toDateText(grid[grid.length - 1])
  }), [grid]);

  const filteredEvents = useMemo(() => {
    if (filterType === 'all') return events;
    return events.filter((ev) => ev.event_type === filterType);
  }, [events, filterType]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/calendar/types', { token })
      .then((data) => { if (active && Array.isArray(data) && data.length) setTypeList(data); })
      .catch(() => { /* keep fallback catalog */ });
    return () => { active = false; };
  }, [token]);

  const loadEvents = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ start: windowBounds.start, end: windowBounds.end });
      if (onlyMine) params.set('mine', 'true');
      const [eventsData, summaryData] = await Promise.all([
        apiRequest(`/api/calendar/events?${params.toString()}`, { token }),
        apiRequest(`/api/calendar/summary?year=${monthCursor.getFullYear()}`, { token })
      ]);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setSummary(summaryData || null);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el calendario');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, windowBounds.start, windowBounds.end, onlyMine]);

  const goToToday = () => {
    const now = new Date();
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
  };
  const shiftMonth = (delta) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const openCreate = (dayText) => {
    setSelectedEvent(null);
    setForm(emptyForm(dayText, filterType !== 'all' ? filterType : 'meeting', typeMap));
    setModalOpen(true);
  };

  const openEdit = (event) => {
    setSelectedEvent(event);
    setForm({
      id: event.id,
      title: event.title || '',
      event_type: event.event_type,
      start_date: String(event.start_date).slice(0, 10),
      end_date: String(event.end_date || event.start_date).slice(0, 10),
      all_day: Boolean(event.all_day),
      start_time: event.start_time ? String(event.start_time).slice(0, 5) : '',
      end_time: event.end_time ? String(event.end_time).slice(0, 5) : '',
      visibility: event.visibility || 'team',
      notes: event.notes || ''
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedEvent(null);
  };

  const canEditSelected = !selectedEvent || selectedEvent.is_owner;

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const onTypeChange = (nextType) => {
    setForm((prev) => ({
      ...prev,
      event_type: nextType,
      all_day: typeMap[nextType]?.default_all_day ?? prev.all_day
    }));
  };

  const buildPayload = () => {
    const payload = {
      title: form.title.trim() || (typeMap[form.event_type]?.label || 'Evento'),
      event_type: form.event_type,
      start_date: form.start_date,
      end_date: form.end_date && form.end_date >= form.start_date ? form.end_date : form.start_date,
      all_day: form.all_day,
      visibility: form.visibility,
      notes: form.notes.trim() || null
    };
    if (!form.all_day) {
      payload.start_time = form.start_time || null;
      payload.end_time = form.end_time || null;
    } else {
      payload.start_time = null;
      payload.end_time = null;
    }
    return payload;
  };

  const saveEvent = async (e) => {
    e.preventDefault();
    if (!form.start_date) {
      toast.error('Indica la fecha de inicio');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (form.id) {
        await apiRequest(`/api/calendar/events/${form.id}`, { method: 'PATCH', token, body: payload });
        toast.success('Evento actualizado');
      } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Evento ${payload.title} (${payload.start_date})`,
          path: '/api/calendar/events',
          options: { method: 'POST', token, body: payload, retries: 0 },
          meta: { eventType: payload.event_type, startDate: payload.start_date }
        });
        toast.info('Sin conexión: el evento se sincronizará luego.');
      } else {
        await apiRequest('/api/calendar/events', { method: 'POST', token, body: payload });
        toast.success('Evento creado');
      }
      closeModal();
      await loadEvents();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el evento');
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!form.id) return;
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar este evento?')) return;
    setSaving(true);
    try {
      await apiRequest(`/api/calendar/events/${form.id}`, { method: 'DELETE', token });
      toast.success('Evento eliminado');
      closeModal();
      await loadEvents();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar el evento');
    } finally {
      setSaving(false);
    }
  };

  const today = todayText();
  const currentMonth = monthCursor.getMonth();

  return (
    <div className="container cal-page">
      <div className="cal-toolbar">
        <div className="cal-toolbar-left">
          <button type="button" className="btn" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
          <button type="button" className="btn" onClick={goToToday}>Hoy</button>
          <button type="button" className="btn" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button>
          <h2 className="cal-month-title">{MONTH_LABELS[currentMonth]} {monthCursor.getFullYear()}</h2>
        </div>
        <div className="cal-toolbar-right">
          <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">Todos los tipos</option>
            {typeList.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label className="cal-checkbox">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Solo míos
          </label>
          <button type="button" className="btn btn-primary" onClick={() => openCreate(today)}>+ Nuevo evento</button>
        </div>
      </div>

      {summary && (
        <div className="cal-quota">
          <div className="cal-quota-item">
            <span>Vacaciones disponibles</span>
            <strong>{summary.vacation_remaining} / 14</strong>
          </div>
          <div className="cal-quota-item">
            <span>Enfermedad disponible</span>
            <strong>{summary.sick_remaining} / 5</strong>
          </div>
          <div className="cal-quota-item">
            <span>Días parciales aprobados</span>
            <strong>{summary.partial_used || 0}</strong>
          </div>
        </div>
      )}

      {error && <div className="card cal-error">{error}</div>}

      <div className="cal-legend">
        {typeList.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`cal-legend-item ${filterType === t.key ? 'active' : ''}`}
            onClick={() => setFilterType((prev) => (prev === t.key ? 'all' : t.key))}
          >
            <span className="cal-dot" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="cal-grid card">
        <div className="cal-weekdays">
          {WEEKDAY_LABELS.map((d) => <div key={d} className="cal-weekday">{d}</div>)}
        </div>
        <div className={`cal-days ${loading ? 'is-loading' : ''}`}>
          {grid.map((day) => {
            const dayText = toDateText(day);
            const inMonth = day.getMonth() === currentMonth;
            const isToday = dayText === today;
            const dayEvents = eventsOnDay(filteredEvents, dayText);
            return (
              <div
                key={dayText}
                className={`cal-day ${inMonth ? '' : 'cal-day-muted'} ${isToday ? 'cal-day-today' : ''}`}
                onClick={() => openCreate(dayText)}
                role="button"
                tabIndex={0}
              >
                <div className="cal-day-number">{day.getDate()}</div>
                <div className="cal-day-events">
                  {dayEvents.slice(0, 4).map((ev) => (
                    <button
                      key={`${ev.id}-${dayText}`}
                      type="button"
                      className={`cal-event ${ev.status === 'pending' ? 'is-pending' : ''} ${ev.status === 'rejected' ? 'is-rejected' : ''}`}
                      style={{ background: ev.color || typeMap[ev.event_type]?.color || '#78716c' }}
                      title={`${ev.title} · ${ev.owner_name || ev.owner_email || ''}`}
                      onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                    >
                      {!ev.all_day && ev.start_time ? `${String(ev.start_time).slice(0, 5)} ` : ''}{ev.title}
                    </button>
                  ))}
                  {dayEvents.length > 4 && (
                    <span className="cal-more">+{dayEvents.length - 4} más</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modalOpen && (
        <div className="cal-modal-overlay" onClick={closeModal}>
          <div className="cal-modal card" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-header">
              <h3>{form.id ? (canEditSelected ? 'Editar evento' : 'Detalle del evento') : 'Nuevo evento'}</h3>
              <button type="button" className="cal-modal-close" onClick={closeModal} aria-label="Cerrar">×</button>
            </div>

            {form.id && !canEditSelected ? (
              <div className="cal-detail">
                <p><strong>{form.title}</strong></p>
                <p>{typeMap[form.event_type]?.label || form.event_type}</p>
                <p>{formatDateLong(form.start_date)} → {formatDateLong(form.end_date)}</p>
                {selectedEvent?.owner_name && <p>Responsable: {selectedEvent.owner_name}</p>}
                <p>Estado: {STATUS_LABELS[selectedEvent?.status] || selectedEvent?.status}</p>
                {form.notes && <p className="cal-detail-notes">{form.notes}</p>}
              </div>
            ) : (
              <form onSubmit={saveEvent} className="cal-form">
                <div>
                  <label className="form-label">Título</label>
                  <input
                    className="filter-input"
                    style={{ width: '100%' }}
                    value={form.title}
                    placeholder={typeMap[form.event_type]?.label || 'Evento'}
                    onChange={(e) => updateForm({ title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Tipo</label>
                  <select className="filter-select" style={{ width: '100%' }} value={form.event_type} onChange={(e) => onTypeChange(e.target.value)}>
                    {typeList.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div className="cal-form-row">
                  <div>
                    <label className="form-label">Desde</label>
                    <input type="date" className="filter-input" style={{ width: '100%' }} value={form.start_date}
                      onChange={(e) => updateForm({ start_date: e.target.value, end_date: form.end_date < e.target.value ? e.target.value : form.end_date })} />
                  </div>
                  <div>
                    <label className="form-label">Hasta</label>
                    <input type="date" className="filter-input" style={{ width: '100%' }} value={form.end_date}
                      min={form.start_date}
                      onChange={(e) => updateForm({ end_date: e.target.value })} />
                  </div>
                </div>
                <label className="cal-checkbox">
                  <input type="checkbox" checked={form.all_day} onChange={(e) => updateForm({ all_day: e.target.checked })} />
                  Todo el día
                </label>
                {!form.all_day && (
                  <div className="cal-form-row">
                    <div>
                      <label className="form-label">Hora inicio</label>
                      <input type="time" className="filter-input" style={{ width: '100%' }} value={form.start_time} onChange={(e) => updateForm({ start_time: e.target.value })} />
                    </div>
                    <div>
                      <label className="form-label">Hora fin</label>
                      <input type="time" className="filter-input" style={{ width: '100%' }} value={form.end_time} onChange={(e) => updateForm({ end_time: e.target.value })} />
                    </div>
                  </div>
                )}
                <div>
                  <label className="form-label">Visibilidad</label>
                  <select className="filter-select" style={{ width: '100%' }} value={form.visibility} onChange={(e) => updateForm({ visibility: e.target.value })}>
                    <option value="team">Equipo (visible para coordinar)</option>
                    <option value="personal">Personal (solo yo)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Notas</label>
                  <textarea
                    rows={3}
                    className="cal-textarea"
                    value={form.notes}
                    placeholder="Detalle (opcional)"
                    onChange={(e) => updateForm({ notes: e.target.value })}
                  />
                </div>
                {typeMap[form.event_type]?.category === 'time_off' && (
                  <p className="form-hint">Las solicitudes de tiempo libre quedan pendientes hasta la aprobación de un administrador.</p>
                )}
                <div className="cal-modal-actions">
                  {form.id && (
                    <button type="button" className="btn cal-btn-danger" onClick={deleteEvent} disabled={saving}>Eliminar</button>
                  )}
                  <div className="cal-modal-actions-right">
                    <button type="button" className="btn" onClick={closeModal} disabled={saving}>Cancelar</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Guardando…' : (form.id ? 'Guardar' : 'Crear')}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
