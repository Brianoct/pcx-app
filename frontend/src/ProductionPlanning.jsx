import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { STAGE_LABEL, groupIntoBatches, sedeTotals } from './productionShared';

// Production planning: needs accumulate here (quantity follows the stock) until
// each lote gets a tentative date. The day the date arrives (hora boliviana) the
// lote enters the production board automatically and its quantity freezes.
export default function ProductionPlanning({ token }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [dateDrafts, setDateDrafts] = useState({});

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

  return (
    <div className="container prod-page">
      <div className="card plan-intro">
        <h2 className="plan-title">Planificación de producción</h2>
        <p className="plan-sub">
          Las necesidades se acumulan aquí y la cantidad se ajusta sola con el stock.
          Asigna una fecha tentativa: ese día el lote entra al tablero de producción y su
          cantidad queda fija. También puedes iniciarlo ahora mismo.
        </p>
      </div>

      {error && <div className="card prod-error">{error}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando planificación…</div>
      ) : planningBatches.length === 0 ? (
        <div className="card" style={{ color: '#78716c' }}>
          No hay necesidades por planificar. Cuando el stock baje del mínimo, aparecerán aquí.
        </div>
      ) : (
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
      )}
    </div>
  );
}
