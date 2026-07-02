import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

// Board (display) order — must match backend PRODUCTION_KANBAN_STAGES.
const STAGES = [
  { key: 'impresion_3d', label: 'Impresión 3D' },
  { key: 'corte_laser', label: 'Corte Láser' },
  { key: 'punzonado', label: 'Punzonado' },
  { key: 'plegado', label: 'Plegado' },
  { key: 'soldado', label: 'Soldado' },
  { key: 'lavado', label: 'Lavado' },
  { key: 'pintado', label: 'Pintado' },
  { key: 'embalado', label: 'Embalado' }
];

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const STAGE_ORDER = STAGES.map((s) => s.key);

// A card carries its own `route` from the backend (welded products include
// soldado). Fall back to the full board order if it's ever missing.
const cardRoute = (card) => (Array.isArray(card?.route) && card.route.length ? card.route : STAGE_ORDER);

export default function ProductionKanban({ token }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingMap, setSavingMap] = useState({});
  const [locationFilter, setLocationFilter] = useState('all');
  const [activeStage, setActiveStage] = useState(STAGES[0].key);
  const [detailId, setDetailId] = useState(null);

  const loadBoard = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/api/production/kanban', { token });
      setCards(Array.isArray(data?.cards) ? data.cards : []);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el tablero de producción');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const locationOptions = useMemo(() => {
    const options = new Set();
    for (const card of cards) if (card?.store_location) options.add(card.store_location);
    return ['all', ...Array.from(options).sort()];
  }, [cards]);

  const visibleCards = useMemo(() => (
    locationFilter === 'all' ? cards : cards.filter((c) => c.store_location === locationFilter)
  ), [cards, locationFilter]);

  const cardsByStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((s) => [s.key, []]));
    for (const card of visibleCards) {
      if (grouped[card.stage]) grouped[card.stage].push(card);
    }
    return grouped;
  }, [visibleCards]);

  const totalRequiredQty = useMemo(
    () => visibleCards.reduce((sum, c) => sum + Number(c.required_qty || 0), 0),
    [visibleCards]
  );

  const detailCard = useMemo(
    () => visibleCards.find((c) => c.id === detailId) || null,
    [visibleCards, detailId]
  );

  const setSaving = (key, value) => setSavingMap((prev) => ({ ...prev, [key]: value }));

  const moveCardToStage = async (card, nextStage) => {
    if (!card || !nextStage || card.stage === nextStage) return;
    if (!cardRoute(card).includes(nextStage)) {
      setError(`La etapa "${STAGE_LABEL[nextStage] || nextStage}" no aplica para ${card.product_name || card.sku}.`);
      return;
    }
    const saveKey = `stage:${card.id}`;
    setSaving(saveKey, true);
    setError('');
    const previousStage = card.stage;
    setCards((prev) => prev.map((item) => (item.id === card.id ? { ...item, stage: nextStage } : item)));
    try {
      const response = await apiRequest(`/api/production/kanban/cards/${card.id}/stage`, {
        method: 'PATCH',
        token,
        body: { stage: nextStage }
      });
      const updated = response?.card;
      if (updated?.id) {
        setCards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
    } catch (err) {
      setCards((prev) => prev.map((item) => (item.id === card.id ? { ...item, stage: previousStage } : item)));
      setError(err.message || 'No se pudo mover la tarjeta');
    } finally {
      setSaving(saveKey, false);
    }
  };

  const nextStageOf = (card) => {
    const route = cardRoute(card);
    const idx = route.indexOf(card.stage);
    return idx >= 0 && idx < route.length - 1 ? route[idx + 1] : null;
  };

  return (
    <div className="container prod-page">
      <div className="card prod-head">
        <div className="prod-head-row">
          <div>
            <h2 className="prod-title">Producción</h2>
            <p className="prod-sub">Las tarjetas aparecen cuando el stock baja del mínimo y desaparecen al reponer.</p>
          </div>
          <div className="prod-head-controls">
            <select
              className="filter-select"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
            >
              {locationOptions.map((option) => (
                <option key={option} value={option}>{option === 'all' ? 'Todas las sedes' : option}</option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" onClick={loadBoard} disabled={loading}>
              Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="prod-kpis">
        <div className="prod-kpi"><span className="prod-kpi-label">Tarjetas activas</span><span className="prod-kpi-value" style={{ color: '#0284c7' }}>{visibleCards.length}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Piezas requeridas</span><span className="prod-kpi-value" style={{ color: '#f59e0b' }}>{totalRequiredQty}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Listas para embalar</span><span className="prod-kpi-value" style={{ color: '#16a34a' }}>{cardsByStage.embalado?.length || 0}</span></div>
      </div>

      {error && <div className="card prod-error">{error}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando producción…</div>
      ) : (
        <div className="prod-board">
          {/* Portrait: horizontal stage selector (hidden in landscape/desktop) */}
          <div className="prod-stage-nav" role="tablist" aria-label="Etapas de producción">
            {STAGES.map((stage) => {
              const count = cardsByStage[stage.key]?.length || 0;
              return (
                <button
                  key={stage.key}
                  type="button"
                  role="tab"
                  aria-selected={activeStage === stage.key}
                  className={`prod-stage-pill ${activeStage === stage.key ? 'is-active' : ''}`}
                  onClick={() => setActiveStage(stage.key)}
                >
                  {stage.label}
                  <span className="prod-stage-pill-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Columns — all shown in landscape/desktop; only the active one in portrait */}
          <div className="prod-columns">
            {STAGES.map((stage) => {
              const stageCards = cardsByStage[stage.key] || [];
              return (
                <section
                  key={stage.key}
                  className={`prod-col ${activeStage === stage.key ? 'is-active' : ''}`}
                >
                  <header className="prod-col-head">
                    <span className="prod-col-name">{stage.label}</span>
                    <span className="prod-col-count">{stageCards.length}</span>
                  </header>
                  <div className="prod-col-body">
                    {stageCards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        className="prod-card"
                        onClick={() => setDetailId(card.id)}
                        disabled={Boolean(savingMap[`stage:${card.id}`])}
                      >
                        <span className="prod-card-name">{card.product_name}</span>
                        <span className="prod-card-qty">{Number(card.required_qty || 0)} pzas</span>
                        {locationFilter === 'all' && (
                          <span className="prod-card-sede">{card.store_location}</span>
                        )}
                      </button>
                    ))}
                    {stageCards.length === 0 && <div className="prod-col-empty">Sin tarjetas</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {detailCard && (
        <div className="prod-sheet-overlay" onClick={() => setDetailId(null)}>
          <div className="prod-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="prod-sheet-handle" aria-hidden="true" />
            <div className="prod-sheet-head">
              <div>
                <div className="prod-sheet-title">{detailCard.product_name}</div>
                <div className="prod-sheet-sku">{detailCard.sku} · {detailCard.store_location}</div>
              </div>
              <button type="button" className="prod-sheet-close" onClick={() => setDetailId(null)} aria-label="Cerrar">✕</button>
            </div>

            <div className="prod-sheet-facts">
              <div><span className="prod-fact-label">Reponer</span><span className="prod-fact-value" style={{ color: '#b45309' }}>{Number(detailCard.required_qty || 0)} pzas</span></div>
              <div><span className="prod-fact-label">Stock actual</span><span className="prod-fact-value">{Number(detailCard.current_stock || 0)}</span></div>
              <div><span className="prod-fact-label">Mínimo</span><span className="prod-fact-value">{Number(detailCard.min_stock || 0)}</span></div>
            </div>

            {/* Route progress */}
            <div className="prod-sheet-section-label">Ruta de producción</div>
            <div className="prod-route">
              {cardRoute(detailCard).map((step, i) => {
                const routeArr = cardRoute(detailCard);
                const currentIdx = routeArr.indexOf(detailCard.stage);
                const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo';
                return (
                  <span key={step} className={`prod-route-step is-${state}`}>{STAGE_LABEL[step] || step}</span>
                );
              })}
            </div>

            {/* Move controls */}
            <div className="prod-sheet-section-label">Mover a etapa</div>
            <div className="prod-move-chips">
              {cardRoute(detailCard).map((step) => {
                const isCurrent = detailCard.stage === step;
                const saving = Boolean(savingMap[`stage:${detailCard.id}`]);
                return (
                  <button
                    key={step}
                    type="button"
                    className={`prod-move-chip ${isCurrent ? 'is-current' : ''}`}
                    disabled={isCurrent || saving}
                    onClick={() => moveCardToStage(detailCard, step)}
                  >
                    {STAGE_LABEL[step] || step}
                  </button>
                );
              })}
            </div>

            {nextStageOf(detailCard) && (
              <button
                type="button"
                className="btn btn-primary prod-advance-btn"
                disabled={Boolean(savingMap[`stage:${detailCard.id}`])}
                onClick={() => moveCardToStage(detailCard, nextStageOf(detailCard))}
              >
                Avanzar a {STAGE_LABEL[nextStageOf(detailCard)]}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
