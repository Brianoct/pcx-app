import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { STAGE_LABEL, groupIntoBatches, sedeTotals } from './productionShared';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// Production planning: needs accumulate here (quantity follows the stock) until
// each lote gets a tentative date. The day the date arrives (hora boliviana) the
// lote enters the production board automatically and its quantity freezes.
// Two views: a list with a date picker, and a calendar where you drag each
// lote onto the day it will run.
export default function ProductionPlanning({ token }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [dateDrafts, setDateDrafts] = useState({});
  const [viewMode, setViewMode] = useState('list');
  const [monthCursor, setMonthCursor] = useState(null); // { year, month(0-based) }
  const [draggingKey, setDraggingKey] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null); // touch/click-to-place

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/api/production/kanban', { token });
      setCards(Array.isArray(data?.cards) ? data.cards : []);
    } catch (err) {
      setError(err.message || 'No se pudo cargar planificación');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const planningBatches = useMemo(() => {
    const map = groupIntoBatches(cards, { stages: ['planificacion'] });
    return [...map.values()].sort((a, b) => {
      if (a.planned_date && b.planned_date) return a.planned_date.localeCompare(b.planned_date);
      if (a.planned_date) return -1;
      if (b.planned_date) return 1;
      return b.total_qty - a.total_qty;
    });
  }, [cards]);

  const todayStr = useMemo(() => {
    // "Today" in Bolivia: the server activates lotes with this same cutoff.
    const boliviaNow = new Date(Date.now() - 4 * 3600 * 1000);
    return boliviaNow.toISOString().slice(0, 10);
  }, []);

  // Start the calendar on the current Bolivian month.
  useEffect(() => {
    if (monthCursor) return;
    const [y, m] = todayStr.split('-').map(Number);
    setMonthCursor({ year: y, month: m - 1 });
  }, [todayStr, monthCursor]);

  const setPlannedDate = async (batch, plannedDate) => {
    setBusyKey(batch.key);
    setError('');
    try {
      await apiRequest('/api/production/kanban/batch-planned-date', {
        method: 'PATCH',
        token,
        body: { card_ids: batch.members.map((m) => m.id), planned_date: plannedDate || null }
      });
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo asignar la fecha');
    } finally {
      setBusyKey('');
    }
  };

  const startNow = async (batch) => {
    const route = batch.route || [];
    const nextStage = route[route.indexOf('planificacion') + 1];
    if (!nextStage) return;
    setBusyKey(batch.key);
    setError('');
    try {
      await apiRequest('/api/production/kanban/batch-stage', {
        method: 'PATCH',
        token,
        body: { card_ids: batch.members.map((m) => m.id), stage: nextStage }
      });
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo iniciar la producción');
    } finally {
      setBusyKey('');
    }
  };

  const dateBadge = (batch) => {
    if (!batch.planned_date) return { label: 'Sin fecha', cls: 'is-none' };
    if (batch.planned_date <= todayStr) return { label: 'Entra hoy', cls: 'is-today' };
    return { label: `Programado · ${batch.planned_date}`, cls: 'is-scheduled' };
  };

  // ── Calendar data ──────────────────────────────────────────────────────────
  const scheduledByDate = useMemo(() => {
    const map = new Map();
    for (const batch of planningBatches) {
      if (!batch.planned_date) continue;
      if (!map.has(batch.planned_date)) map.set(batch.planned_date, []);
      map.get(batch.planned_date).push(batch);
    }
    return map;
  }, [planningBatches]);

  const unscheduled = useMemo(() => planningBatches.filter((b) => !b.planned_date), [planningBatches]);

  const weeks = useMemo(() => {
    if (!monthCursor) return [];
    const { year, month } = monthCursor;
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const grid = [];
    for (let i = 0; i < cells.length; i += 7) grid.push(cells.slice(i, i + 7));
    return grid;
  }, [monthCursor]);

  const shiftMonth = (delta) => {
    setMonthCursor((prev) => {
      if (!prev) return prev;
      const next = new Date(prev.year, prev.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  // Unified "place this lote on this date" (null = back to no date). Used by
  // both drag-drop and click-to-place. Guards past dates.
  const placeOn = (batch, dateStr) => {
    setSelectedKey(null);
    setDraggingKey(null);
    if (!batch) return;
    if (dateStr && dateStr < todayStr) return;
    if ((batch.planned_date || null) === (dateStr || null)) return;
    setPlannedDate(batch, dateStr);
  };

  const onDayClick = (dateStr) => {
    if (!selectedKey) return;
    placeOn(planningBatches.find((b) => b.key === selectedKey), dateStr);
  };

  const monthLabel = monthCursor ? `${MONTHS[monthCursor.month]} ${monthCursor.year}` : '';

  const renderMiniCard = (batch, { onCalendar = false } = {}) => {
    const badge = dateBadge(batch);
    return (
      <button
        key={batch.key}
        type="button"
        draggable
        className={`plan-chip-card ${selectedKey === batch.key ? 'is-selected' : ''} ${draggingKey === batch.key ? 'is-dragging' : ''} ${busyKey === batch.key ? 'is-busy' : ''}`}
        onDragStart={(e) => { setDraggingKey(batch.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', batch.key); }}
        onDragEnd={() => setDraggingKey(null)}
        onClick={() => setSelectedKey((prev) => (prev === batch.key ? null : batch.key))}
        title={onCalendar ? 'Arrastra a otro día o al panel “Sin programar”' : 'Arrastra a un día o selecciona y toca un día'}
      >
        <span className="plan-chip-name">{batch.display_name}</span>
        <span className="plan-chip-qty">{batch.total_qty} pzas</span>
        {!onCalendar && badge.cls === 'is-none' && batch.is_variant_group && (
          <span className="plan-chip-colors">{batch.color_list.map((c) => c.label).join(' · ')}</span>
        )}
      </button>
    );
  };

  return (
    <div className="container prod-page">
      <div className="card plan-intro">
        <div className="plan-intro-head">
          <div>
            <h2 className="plan-title">Planificación de producción</h2>
            <p className="plan-sub">
              Las necesidades se acumulan aquí y la cantidad se ajusta sola con el stock.
              Asígnale una fecha: ese día el lote entra al tablero de producción y su cantidad
              queda fija. Mientras tanto, sigue acumulando piezas.
            </p>
          </div>
          <div className="plan-modes" role="tablist" aria-label="Vista de planificación">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              className={`plan-mode-btn ${viewMode === 'list' ? 'is-active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              Lista
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'calendar'}
              className={`plan-mode-btn ${viewMode === 'calendar' ? 'is-active' : ''}`}
              onClick={() => setViewMode('calendar')}
            >
              Calendario
            </button>
          </div>
        </div>
      </div>

      {error && <div className="card prod-error">{error}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando planificación…</div>
      ) : planningBatches.length === 0 ? (
        <div className="card" style={{ color: '#78716c' }}>
          No hay necesidades por planificar. Cuando el stock baje del mínimo, aparecerán aquí.
        </div>
      ) : viewMode === 'list' ? (
        <div className="plan-list">
          {planningBatches.map((batch) => {
            const badge = dateBadge(batch);
            const draft = dateDrafts[batch.key] ?? batch.planned_date ?? '';
            const firstStage = (batch.route || []).find((s) => s !== 'planificacion');
            return (
              <div key={batch.key} className="plan-item">
                <div className="plan-item-info">
                  <div className="plan-item-topline">
                    <span className="plan-item-name">{batch.display_name}</span>
                    <span className={`plan-badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="plan-item-sku">{batch.display_sku}</div>
                  <div className="plan-item-breakdown">
                    <span className="plan-item-qty">{batch.total_qty} pzas</span>
                    {batch.is_variant_group && batch.color_list.map((c) => (
                      <span key={c.sku} className="plan-chip">{c.label} {c.qty}</span>
                    ))}
                    {sedeTotals(batch).map((s) => (
                      <span key={s.sede} className="plan-chip is-sede">{s.sede} {s.qty}</span>
                    ))}
                  </div>
                </div>
                <div className="plan-item-actions">
                  <label className="plan-date-field">
                    <span>Fecha tentativa</span>
                    <input
                      type="date"
                      value={draft}
                      min={todayStr}
                      onChange={(e) => setDateDrafts((prev) => ({ ...prev, [batch.key]: e.target.value }))}
                    />
                  </label>
                  <div className="plan-btn-row">
                    <button
                      type="button"
                      className="btn btn-primary plan-btn"
                      disabled={busyKey === batch.key || !draft || draft === (batch.planned_date || '')}
                      onClick={() => setPlannedDate(batch, draft)}
                    >
                      Guardar fecha
                    </button>
                    {batch.planned_date && (
                      <button
                        type="button"
                        className="btn btn-secondary plan-btn"
                        disabled={busyKey === batch.key}
                        onClick={() => {
                          setDateDrafts((prev) => ({ ...prev, [batch.key]: '' }));
                          setPlannedDate(batch, null);
                        }}
                      >
                        Quitar fecha
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary plan-btn plan-btn-start"
                      disabled={busyKey === batch.key || !firstStage}
                      onClick={() => startNow(batch)}
                      title={firstStage ? `Pasa ahora mismo a ${STAGE_LABEL[firstStage]}` : undefined}
                    >
                      Iniciar ahora →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="plan-calendar-wrap">
          <div
            className={`plan-backlog ${draggingKey ? 'is-droptarget' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); placeOn(planningBatches.find((b) => b.key === draggingKey), null); }}
          >
            <div className="plan-backlog-title">
              Sin programar <span className="plan-backlog-count">{unscheduled.length}</span>
            </div>
            <p className="plan-backlog-hint">
              Arrastra un lote a un día (o tócalo y luego toca el día). Suéltalo aquí para quitarle la fecha.
            </p>
            <div className="plan-backlog-list">
              {unscheduled.length === 0
                ? <div className="plan-backlog-empty">Todo está programado 🎉</div>
                : unscheduled.map((batch) => renderMiniCard(batch))}
            </div>
          </div>

          <div className="plan-cal">
            <div className="plan-cal-head">
              <button type="button" className="plan-cal-navbtn" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
              <span className="plan-cal-month">{monthLabel}</span>
              <button type="button" className="plan-cal-navbtn" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button>
            </div>
            <div className="plan-cal-weekdays">
              {WEEKDAYS.map((w) => <span key={w} className="plan-cal-weekday">{w}</span>)}
            </div>
            <div className="plan-cal-grid">
              {weeks.map((week, wi) => (
                <div key={wi} className="plan-cal-week">
                  {week.map((day, di) => {
                    if (day === null) return <div key={di} className="plan-cal-day is-blank" />;
                    const dateStr = isoDate(monthCursor.year, monthCursor.month, day);
                    const isPast = dateStr < todayStr;
                    const isToday = dateStr === todayStr;
                    const dayBatches = scheduledByDate.get(dateStr) || [];
                    const droppable = !isPast;
                    return (
                      <div
                        key={di}
                        className={`plan-cal-day ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${selectedKey && droppable ? 'is-placeable' : ''}`}
                        onDragOver={(e) => { if (droppable) e.preventDefault(); }}
                        onDrop={(e) => { if (!droppable) return; e.preventDefault(); placeOn(planningBatches.find((b) => b.key === draggingKey), dateStr); }}
                        onClick={() => droppable && onDayClick(dateStr)}
                      >
                        <span className="plan-cal-daynum">{day}{isToday ? ' · hoy' : ''}</span>
                        <div className="plan-cal-daycards">
                          {dayBatches.map((batch) => renderMiniCard(batch, { onCalendar: true }))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="plan-cal-foot">
              El día programado, el lote entra solo al tablero y su cantidad se congela.
              Arrastra entre días para reprogramar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
