import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { BOARD_STAGES, STAGE_LABEL, parseVariantSku } from './productionShared';
import { boliviaToday } from './campaignShared';

// El tablero de producción, con flujo pieza a pieza:
//  - Cada tarjeta es UN producto con su color (los colores ya no viajan
//    agrupados: cada color tiene su propia tarjeta en el tablero).
//  - Un producto puede tener piezas en varias estaciones a la vez; el botón
//    «+» empuja una pieza a la siguiente estación (baja aquí, sube allá) y
//    «−» la devuelve a la anterior (retrabajo).
//  - Entrar a Embalado sigue siendo la puerta de calidad: cada pieza empujada
//    queda registrada como aprobada (alimenta las comisiones de QC, de ahí
//    `onCommissionChanged`).
// Planificación vive en /produccion-planificacion y Recepción en /recepcion.

// "2026-06-04" → "4 jun" sin pasar por Date (evita corrimientos de zona horaria).
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const formatDeadline = (isoDate) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  return `${Number(match[3])} ${MONTH_SHORT[Number(match[2]) - 1] || ''}`;
};

const BOARD_STAGE_KEYS = BOARD_STAGES.map((s) => s.key);

// Agrupa tarjetas por SKU (las sedes de un mismo SKU son el mismo producto
// físico). Cada color es su propio grupo: tarjetas kanban separadas por color.
const groupBySku = (cards) => {
  const groups = new Map();
  for (const card of cards) {
    if (card.stage === 'planificacion') continue;
    const sku = String(card.sku || '').toUpperCase();
    if (!groups.has(sku)) {
      const variant = parseVariantSku(sku);
      groups.set(sku, {
        sku,
        display_name: card.product_name || sku,
        color_label: variant ? variant.colorLabel : null,
        route: Array.isArray(card.route) ? card.route : [],
        members: [],
        total_qty: 0,
        pending_tasks: 0,
        planned_date: null
      });
    }
    const group = groups.get(sku);
    group.members.push(card);
    group.total_qty += Number(card.required_qty || 0);
    group.pending_tasks += Number(card.pending_tasks || 0);
    if (card.planned_date && (!group.planned_date || card.planned_date < group.planned_date)) {
      group.planned_date = card.planned_date;
    }
  }
  return groups;
};

// Un "chunk" es la presencia de un grupo en una estación: cuántas piezas de
// ese producto/color están ahí ahora mismo.
const buildChunks = (groups) => {
  const chunks = [];
  for (const group of groups.values()) {
    for (const stage of BOARD_STAGE_KEYS) {
      const qty = group.members.reduce(
        (sum, member) => sum + Number(member.stage_qty?.[stage] || 0),
        0
      );
      if (qty <= 0) continue;
      const route = group.route;
      const idx = route.indexOf(stage);
      const nextStage = idx >= 0 && idx < route.length - 1 ? route[idx + 1] : null;
      const prevCandidate = idx > 0 ? route[idx - 1] : null;
      chunks.push({
        key: `${group.sku}::${stage}`,
        group,
        stage,
        qty,
        nextStage,
        prevStage: prevCandidate && prevCandidate !== 'planificacion' ? prevCandidate : null
      });
    }
  }
  return chunks;
};

export default function ProductionKanban({ token, onCommissionChanged }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [activeStage, setActiveStage] = useState('corte_laser');
  const [expandedKey, setExpandedKey] = useState(null);
  const [notice, setNotice] = useState('');
  const [chunkTasks, setChunkTasks] = useState([]);
  const [taskInputs, setTaskInputs] = useState({});
  const [taskBusyId, setTaskBusyId] = useState(null);

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

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const groups = useMemo(() => groupBySku(cards), [cards]);
  const chunks = useMemo(() => buildChunks(groups), [groups]);

  const chunksByStage = useMemo(() => {
    const grouped = Object.fromEntries(BOARD_STAGES.map((s) => [s.key, []]));
    for (const chunk of chunks) {
      if (grouped[chunk.stage]) grouped[chunk.stage].push(chunk);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => b.qty - a.qty || a.group.display_name.localeCompare(b.group.display_name));
    }
    return grouped;
  }, [chunks]);

  const totalInProduction = useMemo(
    () => chunks.reduce((sum, chunk) => sum + chunk.qty, 0),
    [chunks]
  );
  const receptionPieces = useMemo(
    () => cards.reduce((sum, card) => sum + Number(card.stage_qty?.recepcion || 0), 0),
    [cards]
  );
  const planningCount = useMemo(() => cards.filter((c) => c.stage === 'planificacion').length, [cards]);

  // Carga por columna: productos y piezas. La columna con más piezas (habiendo
  // alguna) es el cuello de botella.
  const colStats = useMemo(() => {
    const stats = {};
    for (const stage of BOARD_STAGES) {
      const items = chunksByStage[stage.key] || [];
      stats[stage.key] = {
        lots: items.length,
        pieces: items.reduce((sum, chunk) => sum + chunk.qty, 0)
      };
    }
    const maxPieces = Math.max(...Object.values(stats).map((s) => s.pieces), 0);
    const bottleneck = maxPieces > 0
      ? Object.keys(stats).find((key) => stats[key].pieces === maxPieces)
      : null;
    return { stats, bottleneck };
  }, [chunksByStage]);

  const expandedChunk = expandedKey ? chunks.find((chunk) => chunk.key === expandedKey) || null : null;

  // Tareas de medición del grupo expandido (por tarjeta miembro).
  useEffect(() => {
    setChunkTasks([]);
    setTaskInputs({});
    const memberIds = expandedChunk ? expandedChunk.group.members.map((m) => m.id) : [];
    if (memberIds.length === 0) return;
    let active = true;
    Promise.all(memberIds.map((id) =>
      apiRequest(`/api/production/kanban/cards/${id}/tasks`, { token }).catch(() => ({ tasks: [] }))
    )).then((results) => {
      if (active) setChunkTasks(results.flatMap((r) => (Array.isArray(r?.tasks) ? r.tasks : [])));
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, token]);

  const resolveTask = async (task, skip) => {
    const qty = Number(taskInputs[task.id]);
    if (!skip && (!Number.isFinite(qty) || qty < 0)) {
      setError('Ingresa la cantidad usada para registrar la medición.');
      return;
    }
    setTaskBusyId(task.id);
    setError('');
    try {
      await apiRequest(`/api/production/tasks/${task.id}/${skip ? 'skip' : 'complete'}`, {
        method: 'POST',
        token,
        body: skip ? {} : { qty_used: qty }
      });
      setChunkTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err.message || 'No se pudo registrar la medición');
    } finally {
      setTaskBusyId(null);
    }
  };

  // Refleja localmente lo que hará el servidor (reparto en orden de id) para
  // que el tablero responda al toque sin recargar; si el request falla, se
  // recarga y la verdad vuelve del servidor.
  const applyPushLocally = (chunk, toStage, qty) => {
    const ordered = [...chunk.group.members].sort((a, b) => Number(a.id) - Number(b.id));
    const shares = new Map();
    let remaining = qty;
    for (const member of ordered) {
      const available = Number(member.stage_qty?.[chunk.stage] || 0);
      const share = Math.min(remaining, available);
      if (share > 0) shares.set(member.id, share);
      remaining -= share;
    }
    setCards((prev) => prev.map((card) => {
      const share = shares.get(card.id);
      if (!share) return card;
      const dist = { ...(card.stage_qty || {}) };
      dist[chunk.stage] = Math.max(0, Number(dist[chunk.stage] || 0) - share);
      if (dist[chunk.stage] === 0) delete dist[chunk.stage];
      dist[toStage] = Number(dist[toStage] || 0) + share;
      return { ...card, stage_qty: dist };
    }));
  };

  const pushPieces = (chunk, direction, qty = 1) => {
    const toStage = direction === 'forward' ? chunk.nextStage : chunk.prevStage;
    if (!toStage) return;
    const moveQty = Math.min(qty, chunk.qty);
    if (moveQty <= 0) return;
    applyPushLocally(chunk, toStage, moveQty);
    if (direction === 'forward' && toStage === 'embalado' && typeof onCommissionChanged === 'function') {
      onCommissionChanged();
    }
    if (toStage === 'recepcion') {
      setNotice(`${chunk.group.display_name}: ${moveQty} pza${moveQty === 1 ? '' : 's'} → Recepción ✓`);
    }
    apiRequest('/api/production/kanban/push', {
      method: 'POST',
      token,
      body: {
        card_ids: chunk.group.members.map((m) => m.id),
        from_stage: chunk.stage,
        qty: moveQty,
        direction
      }
    }).catch((err) => {
      setError(err.message || 'No se pudieron mover las piezas');
      loadBoard();
    });
  };

  // Tarjeta por producto+color en cada estación: la cara muestra cuántas
  // piezas hay AQUÍ y los botones que las empujan. Expandida: detalle por
  // sede, tareas de medición y «Avanzar todo».
  const renderChunkCard = (chunk) => {
    const { group } = chunk;
    const deadline = formatDeadline(group.planned_date);
    const overdue = Boolean(group.planned_date) && String(group.planned_date).slice(0, 10) < boliviaToday();
    const isExpanded = expandedKey === chunk.key;
    const toggle = () => setExpandedKey(isExpanded ? null : chunk.key);
    const sedeRows = group.members
      .map((member) => ({
        sede: member.store_location || '—',
        qty: Number(member.stage_qty?.[chunk.stage] || 0)
      }))
      .filter((row) => row.qty > 0);
    return (
      <div
        key={chunk.key}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={`prod-card ${isExpanded ? 'is-expanded' : ''} ${busyKey === chunk.key ? 'is-busy' : ''}`}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <div className="prod-card-top">
          <span className="prod-card-name">
            {group.display_name}
            {group.color_label && <span className="prod-card-colorchip">{group.color_label}</span>}
          </span>
          {deadline && (
            <span className={`prod-card-deadline ${overdue ? 'is-overdue' : ''}`} title="Fecha planificada">
              📅 {deadline}
            </span>
          )}
        </div>
        <span className="prod-card-sede">
          {chunk.qty} de {group.total_qty} pza{group.total_qty === 1 ? '' : 's'} del lote en esta estación
        </span>
        <div className="prod-card-foot">
          <div className="prod-card-counter" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label={`Devolver una pieza a ${STAGE_LABEL[chunk.prevStage] || 'la etapa anterior'}`}
              title={chunk.prevStage ? `Devolver 1 a ${STAGE_LABEL[chunk.prevStage]}` : 'Sin etapa anterior'}
              disabled={!chunk.prevStage || chunk.qty <= 0}
              onClick={() => pushPieces(chunk, 'back', 1)}
            >
              −
            </button>
            <span className="prod-chunk-qty">{chunk.qty}</span>
            <button
              type="button"
              className="is-plus"
              aria-label={`Empujar una pieza a ${STAGE_LABEL[chunk.nextStage] || 'la siguiente etapa'}`}
              title={chunk.nextStage ? `Empujar 1 a ${STAGE_LABEL[chunk.nextStage]}` : 'Sin etapa siguiente'}
              disabled={!chunk.nextStage || chunk.qty <= 0}
              onClick={() => pushPieces(chunk, 'forward', 1)}
            >
              +
            </button>
          </div>
          <span className="prod-card-meta">
            {chunk.nextStage && (
              <span className="prod-card-nexthint">+ → {STAGE_LABEL[chunk.nextStage]}</span>
            )}
            {group.pending_tasks > 0 && (
              <span className="prod-card-task-badge" title="Tareas de medición pendientes">
                {group.pending_tasks} tarea{group.pending_tasks > 1 ? 's' : ''}
              </span>
            )}
            <span className="prod-card-chevron" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
          </span>
        </div>

        {isExpanded && (
          <div className="prod-card-extra" onClick={(e) => e.stopPropagation()}>
            {sedeRows.length > 1 && (
              <div className="prod-card-sede-detail">
                {sedeRows.map((row) => (
                  <span key={row.sede}>{row.sede}: {row.qty}</span>
                ))}
              </div>
            )}

            {chunkTasks.map((task) => (
              <div key={task.id} className="prod-task">
                <div className="prod-task-question">
                  ¿Cuánto <strong>{task.material_name}</strong> usaste en {STAGE_LABEL[task.process] || task.process} para este lote
                  {task.batch_qty > 0 ? ` (${task.batch_qty} pzas)` : ''}?
                </div>
                <div className="prod-task-controls">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="prod-task-input"
                    placeholder="0"
                    value={taskInputs[task.id] ?? ''}
                    onChange={(e) => setTaskInputs((prev) => ({ ...prev, [task.id]: e.target.value }))}
                  />
                  <span className="prod-task-unit">{task.unit_measure}</span>
                  <button
                    type="button"
                    className="btn btn-primary prod-task-save"
                    disabled={taskBusyId === task.id || taskInputs[task.id] === undefined || taskInputs[task.id] === ''}
                    onClick={() => resolveTask(task, false)}
                  >
                    {taskBusyId === task.id ? '…' : 'Registrar'}
                  </button>
                  <button
                    type="button"
                    className="prod-task-skip"
                    disabled={taskBusyId === task.id}
                    onClick={() => resolveTask(task, true)}
                  >
                    Omitir
                  </button>
                </div>
              </div>
            ))}

            {chunk.nextStage && chunk.qty > 1 && (
              <button
                type="button"
                className="btn btn-primary prod-advance-btn"
                disabled={busyKey === chunk.key}
                onClick={() => {
                  setBusyKey(chunk.key);
                  pushPieces(chunk, 'forward', chunk.qty);
                  setExpandedKey(null);
                  setBusyKey('');
                }}
              >
                Avanzar las {chunk.qty} a {STAGE_LABEL[chunk.nextStage]}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container prod-page">
      <div className="prod-kpis">
        <div className="prod-kpi"><span className="prod-kpi-label">Productos en planta</span><span className="prod-kpi-value" style={{ color: '#0284c7' }}>{groups.size}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Piezas en producción</span><span className="prod-kpi-value" style={{ color: '#f59e0b' }}>{totalInProduction}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Por planificar</span><span className="prod-kpi-value" style={{ color: '#78716c' }}>{planningCount}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Piezas por recibir</span><span className="prod-kpi-value" style={{ color: '#16a34a' }}>{receptionPieces}</span></div>
      </div>

      {error && <div className="card prod-error">{error}</div>}
      {notice && <div className="prod-notice">{notice}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando producción…</div>
      ) : (
        <div className="prod-board">
          <div className="prod-stage-nav" role="tablist" aria-label="Etapas de producción">
            {BOARD_STAGES.map((stage) => {
              const count = chunksByStage[stage.key]?.length || 0;
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

          <div className="prod-columns">
            {BOARD_STAGES.map((stage) => {
              const items = chunksByStage[stage.key] || [];
              const stats = colStats.stats[stage.key];
              const isBottleneck = colStats.bottleneck === stage.key;
              return (
                <section
                  key={stage.key}
                  className={`prod-col ${activeStage === stage.key ? 'is-active' : ''} ${isBottleneck ? 'is-bottleneck' : ''}`}
                >
                  <header className="prod-col-head">
                    <div className="prod-col-title">
                      <span className="prod-col-name">{stage.label}</span>
                      {stats.lots > 0 && <span className="prod-col-load">{stats.pieces} pzas</span>}
                    </div>
                    <span className={`prod-col-count ${items.length === 0 ? 'is-zero' : ''}`}>{items.length}</span>
                  </header>
                  <div className="prod-col-body">
                    {items.map((chunk) => renderChunkCard(chunk))}
                    {items.length === 0 && <div className="prod-col-empty">Sin piezas</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
