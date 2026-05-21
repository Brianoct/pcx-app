import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const STAGES = [
  { key: 'comprar', label: 'Comprar', isPurchase: true },
  { key: 'corte_laser', label: 'Corte Laser' },
  { key: 'punzonado', label: 'Punzonado' },
  { key: 'plegado', label: 'Plegado' },
  { key: 'lavado', label: 'Lavado' },
  { key: 'pintado', label: 'Pintado' },
  { key: 'embalado', label: 'Embalado' }
];
const ROUTE_BY_START = {
  comprar: ['comprar'],
  corte_laser: ['corte_laser', 'plegado', 'lavado', 'pintado', 'embalado'],
  punzonado: ['punzonado', 'plegado', 'lavado', 'pintado', 'embalado']
};
const START_PROCESS_OPTIONS = [
  { value: 'comprar', label: 'Comprar (Reventa)' },
  { value: 'corte_laser', label: 'CNC Laser' },
  { value: 'punzonado', label: 'CNC Punzonadora' }
];

const getRouteByStart = (startProcess = 'corte_laser') =>
  ROUTE_BY_START[startProcess] || ROUTE_BY_START.corte_laser;

function KpiTile({ label, value, accent = '#38bdf8' }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #1e293b 0%, #152034 100%)',
        border: '1px solid rgba(71, 85, 105, 0.55)',
        borderRadius: 12,
        padding: 14
      }}
    >
      <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 6 }}>{label}</div>
      <div style={{ color: accent, fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

export default function ProductionKanban({ token }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingMap, setSavingMap] = useState({});
  const [dragCardId, setDragCardId] = useState(null);
  const [locationFilter, setLocationFilter] = useState('all');

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
    for (const card of cards) {
      if (card?.store_location) options.add(card.store_location);
    }
    return ['all', ...Array.from(options).sort()];
  }, [cards]);

  const visibleCards = useMemo(() => {
    if (locationFilter === 'all') return cards;
    return cards.filter((card) => card.store_location === locationFilter);
  }, [cards, locationFilter]);

  const cardsByStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((stage) => [stage.key, []]));
    for (const card of visibleCards) {
      if (!grouped[card.stage]) continue;
      grouped[card.stage].push(card);
    }
    return grouped;
  }, [visibleCards]);

  const totalRequiredQty = useMemo(
    () => visibleCards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0),
    [visibleCards]
  );

  const setSaving = (key, value) => {
    setSavingMap((prev) => ({ ...prev, [key]: value }));
  };

  const moveCardToStage = async (card, nextStage) => {
    if (!card || !nextStage || card.stage === nextStage) return;
    const route = getRouteByStart(card.start_process);
    if (!route.includes(nextStage)) {
      setError(`La etapa "${nextStage}" no aplica para ${card.product_name || card.sku}.`);
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
      const updatedCard = response?.card;
      if (updatedCard?.id) {
        setCards((prev) => prev.map((item) => (item.id === updatedCard.id ? updatedCard : item)));
      }
    } catch (err) {
      setCards((prev) => prev.map((item) => (item.id === card.id ? { ...item, stage: previousStage } : item)));
      setError(err.message || 'No se pudo mover la tarjeta');
    } finally {
      setSaving(saveKey, false);
    }
  };

  const updateStartProcess = async (card, startProcess) => {
    if (!card || !startProcess || card.start_process === startProcess) return;
    const saveKey = `route:${card.sku}`;
    setSaving(saveKey, true);
    setError('');
    try {
      const response = await apiRequest(`/api/production/kanban/routes/${encodeURIComponent(card.sku)}`, {
        method: 'PATCH',
        token,
        body: { start_process: startProcess }
      });
      const affectedCards = Array.isArray(response?.cards) ? response.cards : [];
      if (affectedCards.length === 0) {
        await loadBoard();
        return;
      }
      const mapById = new Map(affectedCards.map((item) => [item.id, item]));
      setCards((prev) => prev.map((item) => mapById.get(item.id) || item));
    } catch (err) {
      setError(err.message || 'No se pudo actualizar proceso inicial');
    } finally {
      setSaving(saveKey, false);
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 6, color: '#f87171' }}>Kanban de Produccion</h2>
            <p style={{ color: '#94a3b8' }}>
              Tarjetas generadas automaticamente cuando el stock baja del minimo.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              className="filter-select"
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              style={{ minWidth: 200 }}
            >
              {locationOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Todas las sedes' : option}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" onClick={loadBoard} disabled={loading}>
              Actualizar
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16
        }}
      >
        <KpiTile label="Tarjetas activas" value={String(visibleCards.length)} accent="#38bdf8" />
        <KpiTile label="Piezas requeridas" value={String(totalRequiredQty)} accent="#f59e0b" />
        <KpiTile label="En Comprar" value={String(cardsByStage.comprar?.length || 0)} accent="#fb923c" />
        <KpiTile label="En Corte Laser" value={String(cardsByStage.corte_laser?.length || 0)} accent="#22d3ee" />
        <KpiTile label="En Punzonado" value={String(cardsByStage.punzonado?.length || 0)} accent="#a78bfa" />
      </div>

      {error && (
        <div className="card" style={{ borderColor: '#ef4444', color: '#fecaca', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ color: '#94a3b8' }}>Cargando kanban...</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            alignItems: 'start'
          }}
        >
          {STAGES.map((stage) => (
            <div
              key={stage.key}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const card = visibleCards.find((item) => item.id === dragCardId);
                setDragCardId(null);
                if (!card) return;
                moveCardToStage(card, stage.key);
              }}
              style={{
                background: stage.isPurchase
                  ? 'linear-gradient(180deg, rgba(74, 40, 12, 0.88) 0%, rgba(48, 27, 10, 0.95) 100%)'
                  : '#111827',
                border: stage.isPurchase
                  ? '1px solid rgba(251, 146, 60, 0.52)'
                  : '1px solid rgba(71, 85, 105, 0.6)',
                borderRadius: 14,
                minHeight: 280,
                display: 'grid',
                gridTemplateRows: 'auto 1fr'
              }}
            >
              <div
                style={{
                  padding: '12px 12px 10px',
                  borderBottom: stage.isPurchase
                    ? '1px solid rgba(251, 146, 60, 0.42)'
                    : '1px solid rgba(71, 85, 105, 0.6)'
                }}
              >
                <div style={{ color: stage.isPurchase ? '#fdba74' : '#e2e8f0', fontWeight: 700 }}>{stage.label}</div>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>
                  {cardsByStage[stage.key]?.length || 0} tarjeta(s)
                </div>
              </div>
              <div style={{ padding: 10, display: 'grid', gap: 10 }}>
                {(cardsByStage[stage.key] || []).map((card) => {
                  const saveKeyStage = `stage:${card.id}`;
                  const saveKeyRoute = `route:${card.sku}`;
                  const route = getRouteByStart(card.start_process);
                  const isSaving = Boolean(savingMap[saveKeyStage] || savingMap[saveKeyRoute]);
                  return (
                    <article
                      key={card.id}
                      draggable={!isSaving}
                      onDragStart={() => setDragCardId(card.id)}
                      style={{
                        background: card.start_process === 'comprar'
                          ? 'linear-gradient(180deg, #3a2310 0%, #29190d 100%)'
                          : 'linear-gradient(180deg, #1f2937 0%, #172131 100%)',
                        border: card.start_process === 'comprar'
                          ? '1px solid rgba(251, 146, 60, 0.55)'
                          : '1px solid rgba(71, 85, 105, 0.62)',
                        borderRadius: 12,
                        padding: 10,
                        opacity: isSaving ? 0.75 : 1,
                        cursor: isSaving ? 'wait' : 'grab'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#f1f5f9', fontWeight: 700, lineHeight: 1.2 }}>{card.product_name}</div>
                          <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{card.sku}</div>
                        </div>
                        <span
                          style={{
                            background: 'rgba(14, 165, 233, 0.2)',
                            border: '1px solid rgba(56, 189, 248, 0.45)',
                            color: '#bae6fd',
                            borderRadius: 999,
                            minHeight: 24,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            alignSelf: 'flex-start',
                            padding: '2px 10px',
                            lineHeight: 1,
                            fontSize: '0.74rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {card.store_location}
                        </span>
                      </div>
                      <div style={{ color: card.start_process === 'comprar' ? '#fdba74' : '#fbbf24', fontWeight: 700, marginBottom: 8 }}>
                        Piezas requeridas: {Number(card.required_qty || 0)}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: 8 }}>
                        Stock actual: {Number(card.current_stock || 0)} / Minimo: {Number(card.min_stock || 0)}
                      </div>
                      <label style={{ display: 'grid', gap: 4, color: '#94a3b8', fontSize: '0.76rem', marginBottom: 8 }}>
                        Proceso inicial
                        <select
                          value={card.start_process}
                          disabled={isSaving}
                          onChange={(event) => updateStartProcess(card, event.target.value)}
                          style={{
                            minHeight: 36,
                            borderRadius: 8,
                            border: '1px solid #334155',
                            background: '#0f172a',
                            color: '#f1f5f9',
                            padding: '6px 8px',
                            fontSize: '0.85rem'
                          }}
                        >
                          {START_PROCESS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {route.map((step) => {
                          const stepLabel = STAGES.find((item) => item.key === step)?.label || step;
                          const isCurrent = card.stage === step;
                          return (
                            <button
                              key={`${card.id}-${step}`}
                              type="button"
                              onClick={() => moveCardToStage(card, step)}
                              disabled={isSaving || isCurrent}
                              style={{
                                minHeight: 28,
                                padding: '4px 8px',
                                borderRadius: 999,
                                border: isCurrent ? '1px solid rgba(16,185,129,0.65)' : '1px solid rgba(71,85,105,0.6)',
                                background: isCurrent ? 'rgba(16,185,129,0.2)' : '#111827',
                                color: isCurrent ? '#6ee7b7' : '#cbd5e1',
                                fontSize: '0.72rem',
                                cursor: isCurrent ? 'default' : 'pointer'
                              }}
                            >
                              {stepLabel}
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
                {(cardsByStage[stage.key] || []).length === 0 && (
                  <div
                    style={{
                      border: '1px dashed rgba(100, 116, 139, 0.5)',
                      borderRadius: 10,
                      padding: 14,
                      color: '#64748b',
                      fontSize: '0.82rem',
                      textAlign: 'center'
                    }}
                  >
                    Sin tarjetas en esta etapa
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
