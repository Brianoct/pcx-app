import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const STAGES = [
  { key: 'corte_laser', label: 'Corte Laser' },
  { key: 'impresion_3d', label: 'Impresión 3D' },
  { key: 'punzonado', label: 'Punzonado' },
  { key: 'lavado', label: 'Lavado' },
  { key: 'plegado', label: 'Plegado' },
  { key: 'embalado', label: 'Embalado' }
];

const STAGE_LABEL = Object.fromEntries(STAGES.map((stage) => [stage.key, stage.label]));

const ROUTE_BY_START = {
  corte_laser: ['corte_laser', 'lavado', 'plegado', 'embalado'],
  impresion_3d: ['impresion_3d', 'embalado'],
  punzonado: ['punzonado', 'lavado', 'plegado', 'embalado']
};

const getRouteByStart = (startProcess = 'corte_laser') =>
  ROUTE_BY_START[startProcess] || ROUTE_BY_START.corte_laser;

function KpiTile({ label, value, accent = '#0284c7' }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #f5f1ec 100%)',
        border: '1px solid rgba(214, 204, 192, 0.55)',
        borderRadius: 12,
        padding: 12
      }}
    >
      <div style={{ color: '#78716c', fontSize: '0.78rem', marginBottom: 4 }}>{label}</div>
      <div style={{ color: accent, fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
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

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 6, color: '#dc2626' }}>Kanban de Producción</h2>
            <p style={{ color: '#78716c' }}>
              Las tarjetas aparecen cuando el stock baja del mínimo y desaparecen al reponerlo en inventario.
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12,
          marginBottom: 16
        }}
      >
        <KpiTile label="Tarjetas activas" value={String(visibleCards.length)} accent="#0284c7" />
        <KpiTile label="Piezas requeridas" value={String(totalRequiredQty)} accent="#f59e0b" />
        <KpiTile label="Listas para embalar" value={String(cardsByStage.embalado?.length || 0)} accent="#16a34a" />
      </div>

      {error && (
        <div className="card" style={{ borderColor: '#ef4444', color: '#b91c1c', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando kanban...</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
                background: '#f5f1ec',
                border: '1px solid rgba(214, 204, 192, 0.6)',
                borderRadius: 12,
                minHeight: 200,
                display: 'grid',
                gridTemplateRows: 'auto 1fr'
              }}
            >
              <div
                style={{
                  padding: '9px 10px 8px',
                  borderBottom: '1px solid rgba(214, 204, 192, 0.6)'
                }}
              >
                <div style={{ color: '#292524', fontWeight: 700, fontSize: '0.88rem' }}>{stage.label}</div>
                <div style={{ color: '#a8a29e', fontSize: '0.72rem' }}>
                  {cardsByStage[stage.key]?.length || 0} tarjeta(s)
                </div>
              </div>
              <div style={{ padding: 8, display: 'grid', gap: 8 }}>
                {(cardsByStage[stage.key] || []).map((card) => {
                  const saveKeyStage = `stage:${card.id}`;
                  const route = getRouteByStart(card.start_process);
                  const isSaving = Boolean(savingMap[saveKeyStage]);
                  return (
                    <article
                      key={card.id}
                      draggable={!isSaving}
                      onDragStart={() => setDragCardId(card.id)}
                      style={{
                        background: '#ffffff',
                        border: '1px solid rgba(214, 204, 192, 0.62)',
                        borderRadius: 9,
                        padding: 8,
                        opacity: isSaving ? 0.7 : 1,
                        cursor: isSaving ? 'wait' : 'grab'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#292524', fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>
                            {card.product_name}
                          </div>
                          <div style={{ color: '#a8a29e', fontSize: '0.7rem' }}>{card.sku}</div>
                        </div>
                        <span
                          style={{
                            background: 'rgba(14, 165, 233, 0.16)',
                            border: '1px solid rgba(56, 189, 248, 0.42)',
                            color: '#0369a1',
                            borderRadius: 999,
                            padding: '1px 8px',
                            fontSize: '0.68rem',
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}
                        >
                          {card.store_location}
                        </span>
                      </div>
                      <div style={{ color: '#b45309', fontWeight: 700, fontSize: '0.8rem', margin: '6px 0' }}>
                        Reponer: {Number(card.required_qty || 0)} pzas
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {route.map((step) => {
                          const isCurrent = card.stage === step;
                          return (
                            <button
                              key={`${card.id}-${step}`}
                              type="button"
                              onClick={() => moveCardToStage(card, step)}
                              disabled={isSaving || isCurrent}
                              title={isCurrent ? 'Etapa actual' : `Mover a ${STAGE_LABEL[step] || step}`}
                              style={{
                                padding: '2px 7px',
                                borderRadius: 999,
                                border: isCurrent ? '1px solid rgba(16,185,129,0.65)' : '1px solid rgba(214,204,192,0.6)',
                                background: isCurrent ? 'rgba(16,185,129,0.18)' : '#f5f1ec',
                                color: isCurrent ? '#047857' : '#57534e',
                                fontSize: '0.66rem',
                                cursor: isCurrent ? 'default' : 'pointer'
                              }}
                            >
                              {STAGE_LABEL[step] || step}
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
                      border: '1px dashed rgba(100, 116, 139, 0.45)',
                      borderRadius: 9,
                      padding: 10,
                      color: '#a8a29e',
                      fontSize: '0.74rem',
                      textAlign: 'center'
                    }}
                  >
                    Sin tarjetas
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
