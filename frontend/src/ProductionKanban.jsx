import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { BOARD_STAGES, COLOR_SWATCH, STAGE_LABEL, parseVariantSku, stripColorFromName } from './productionShared';
import { boliviaToday } from './campaignShared';

// El tablero de producción, con flujo pieza a pieza:
//  - Antes de Pintado los colores de un mismo producto viajan como UNA sola
//    tarjeta: físicamente son la misma pieza sin pintar. La tarjeta muestra la
//    mezcla de colores del lote como referencia.
//  - En Pintado la tarjeta lista los colores pendientes y cada color tiene su
//    propio «+»: el departamento de pintura elige qué color pintar primero.
//    (El backend permite pintar cualquier pieza sin pintar del lote del color
//    que haga falta, sin importar a qué color estaba "asignada".)
//  - Después de Pintado cada color es su propia tarjeta: una pieza pintada ya
//    no puede cambiar de color.
//  - «+» empuja piezas a la siguiente estación y «−» las devuelve a la
//    anterior. Entrar a Embalado sigue siendo la puerta de calidad: cada pieza
//    empujada queda registrada como aprobada (alimenta comisiones de QC, de
//    ahí `onCommissionChanged`).
// Planificación vive en /produccion-planificacion y Recepción en /recepcion.

// "2026-06-04" → "4 jun" sin pasar por Date (evita corrimientos de zona horaria).
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const formatDeadline = (isoDate) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  return `${Number(match[3])} ${MONTH_SHORT[Number(match[2]) - 1] || ''}`;
};

const BOARD_STAGE_KEYS = BOARD_STAGES.map((s) => s.key);

// Sedes abreviadas para la cara de la tarjeta de Embalado.
const SEDE_SHORT = { Cochabamba: 'CBBA', 'Santa Cruz': 'SCZ', Lima: 'LIMA' };
const shortSede = (sede) => SEDE_SHORT[String(sede || '').trim()] || String(sede || '—');

const ColorSwatch = ({ code, label }) => (
  <span
    className="prod-color-swatch"
    style={{ background: COLOR_SWATCH[code] || '#d6d3d1' }}
    title={label || undefined}
    aria-hidden="true"
  />
);

const stageQtyOf = (members, stage) =>
  members.reduce((sum, member) => sum + Number(member.stage_qty?.[stage] || 0), 0);

// Agrupa tarjetas por producto base: las variantes de color son el mismo
// fierro hasta Pintado, así que comparten grupo (y las sedes también).
const groupCards = (cards) => {
  const groups = new Map();
  for (const card of cards) {
    if (card.stage === 'planificacion') continue;
    const sku = String(card.sku || '').toUpperCase();
    const variant = parseVariantSku(sku);
    const key = variant ? variant.base : sku;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        members: [],
        colors: new Map(),
        route: Array.isArray(card.route) ? card.route : [],
        total_qty: 0,
        pending_tasks: 0,
        planned_date: null,
        display_name: ''
      });
    }
    const group = groups.get(key);
    group.members.push(card);
    group.total_qty += Number(card.required_qty || 0);
    group.pending_tasks += Number(card.pending_tasks || 0);
    if (card.planned_date && (!group.planned_date || card.planned_date < group.planned_date)) {
      group.planned_date = card.planned_date;
    }
    if (!group.colors.has(sku)) {
      group.colors.set(sku, {
        sku,
        label: variant ? variant.colorLabel : null,
        code: variant ? variant.colorCode : null,
        members: [],
        required: 0
      });
    }
    const color = group.colors.get(sku);
    color.members.push(card);
    color.required += Number(card.required_qty || 0);
  }
  for (const group of groups.values()) {
    group.color_list = [...group.colors.values()]
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
    group.is_variant_group = group.color_list.length > 1;
    const firstCard = group.members[0];
    const variant = parseVariantSku(firstCard.sku);
    group.display_name = group.is_variant_group
      ? stripColorFromName(firstCard.product_name, variant?.colorLabel)
      : (firstCard.product_name || group.key);
  }
  return groups;
};

// Un "chunk" es una tarjeta visible del tablero: el grupo (o un color del
// grupo) en una estación concreta.
const buildChunks = (groups) => {
  const chunks = [];
  for (const group of groups.values()) {
    const route = group.route;
    const paintIdx = route.indexOf('pintado');
    const splitByColor = group.is_variant_group && paintIdx >= 0;
    for (const stage of BOARD_STAGE_KEYS) {
      const idx = route.indexOf(stage);
      if (idx < 0) continue;
      const nextStage = idx < route.length - 1 ? route[idx + 1] : null;
      const prevCandidate = idx > 0 ? route[idx - 1] : null;
      const prevStage = prevCandidate && prevCandidate !== 'planificacion' ? prevCandidate : null;

      if (splitByColor && stage === 'pintado') {
        // Pintado: pool de piezas sin pintar + lista de colores pendientes.
        const pool = stageQtyOf(group.members, 'pintado');
        if (pool <= 0) continue;
        const afterStages = route.slice(paintIdx + 1);
        const colors = group.color_list.map((color) => {
          const beyond = afterStages.reduce((sum, s) => sum + stageQtyOf(color.members, s), 0);
          return { ...color, remaining: Math.max(0, color.required - beyond) };
        });
        chunks.push({
          kind: 'paint',
          key: `${group.key}::pintado`,
          group,
          stage,
          qty: pool,
          members: group.members,
          colors,
          nextStage,
          prevStage
        });
        continue;
      }

      if (splitByColor && idx > paintIdx) {
        // Después de Pintado: cada color es su propia tarjeta.
        for (const color of group.color_list) {
          const qty = stageQtyOf(color.members, stage);
          if (qty <= 0) continue;
          chunks.push({
            kind: 'color',
            key: `${color.sku}::${stage}`,
            group,
            color,
            stage,
            qty,
            members: color.members,
            nextStage,
            prevStage
          });
        }
        continue;
      }

      // Antes de Pintado (o producto sin variantes): una sola tarjeta.
      const qty = stageQtyOf(group.members, stage);
      if (qty <= 0) continue;
      chunks.push({
        kind: 'pool',
        key: `${group.key}::${stage}`,
        group,
        stage,
        qty,
        members: group.members,
        nextStage,
        prevStage
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

  const groups = useMemo(() => groupCards(cards), [cards]);
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

  // Tareas de medición del chunk expandido (por tarjeta miembro).
  useEffect(() => {
    setChunkTasks([]);
    setTaskInputs({});
    const memberIds = expandedChunk ? expandedChunk.members.map((m) => m.id) : [];
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

  // La respuesta del push trae las tarjetas afectadas (incluidos hermanos que
  // prestaron piezas en Pintado); se funden en el estado sin recargar todo.
  const mergeServerCards = (updated) => {
    const byId = new Map(updated.map((card) => [Number(card.id), card]));
    setCards((prev) => prev.map((card) => {
      const next = byId.get(Number(card.id));
      return next ? { ...card, stage: next.stage, stage_qty: next.stage_qty } : card;
    }));
  };

  const pushPieces = async (chunk, { members, fromStage, direction, qty }) => {
    if (busyKey) return;
    setBusyKey(chunk.key);
    setError('');
    try {
      const res = await apiRequest('/api/production/kanban/push', {
        method: 'POST',
        token,
        body: {
          card_ids: members.map((m) => m.id),
          from_stage: fromStage,
          qty,
          direction
        }
      });
      if (Array.isArray(res?.cards)) mergeServerCards(res.cards);
      if (res?.to_stage === 'embalado' && direction === 'forward' && typeof onCommissionChanged === 'function') {
        onCommissionChanged();
      }
      if (res?.to_stage === 'recepcion') {
        setNotice(`${chunk.group.display_name}: ${res.moved} pza${res.moved === 1 ? '' : 's'} → Recepción ✓`);
      }
    } catch (err) {
      setError(err.message || 'No se pudieron mover las piezas');
      loadBoard();
    } finally {
      setBusyKey('');
    }
  };

  const cardShell = (chunk, children) => {
    const { group } = chunk;
    const deadline = formatDeadline(group.planned_date);
    const overdue = Boolean(group.planned_date) && String(group.planned_date).slice(0, 10) < boliviaToday();
    const isExpanded = expandedKey === chunk.key;
    const toggle = () => setExpandedKey(isExpanded ? null : chunk.key);
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
            {chunk.kind === 'color' && chunk.color.code && (
              <ColorSwatch code={chunk.color.code} label={chunk.color.label} />
            )}
          </span>
          {deadline && (
            <span className={`prod-card-deadline ${overdue ? 'is-overdue' : ''}`} title="Fecha planificada">
              📅 {deadline}
            </span>
          )}
        </div>
        {children({ isExpanded })}
      </div>
    );
  };

  const renderMeta = (chunk, isExpanded, hintText) => (
    <span className="prod-card-meta">
      {hintText && <span className="prod-card-nexthint">{hintText}</span>}
      {chunk.group.pending_tasks > 0 && (
        <span className="prod-card-task-badge" title="Tareas de medición pendientes">
          {chunk.group.pending_tasks} tarea{chunk.group.pending_tasks > 1 ? 's' : ''}
        </span>
      )}
      <span className="prod-card-chevron" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
    </span>
  );

  const renderExpandedCommon = (chunk, { showAdvanceAll = true } = {}) => (
    <>
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

      {showAdvanceAll && chunk.nextStage && chunk.qty > 1 && (
        <button
          type="button"
          className="btn btn-primary prod-advance-btn"
          disabled={busyKey === chunk.key}
          onClick={() => {
            pushPieces(chunk, { members: chunk.members, fromStage: chunk.stage, direction: 'forward', qty: chunk.qty });
            setExpandedKey(null);
          }}
        >
          Avanzar las {chunk.qty} a {STAGE_LABEL[chunk.nextStage]}
        </button>
      )}
    </>
  );

  // Tarjeta normal (antes de Pintado, o producto sin variantes, o un color
  // después de Pintado): contador −/cantidad/+ que empuja piezas.
  const renderCounterCard = (chunk) => cardShell(chunk, ({ isExpanded }) => (
    <>
      <span className="prod-card-sede">
        {chunk.stage === 'embalado'
          ? (chunk.members
              .map((member) => ({ sede: shortSede(member.store_location), qty: Number(member.stage_qty?.embalado || 0) }))
              .filter((row) => row.qty > 0)
              .map((row) => `${row.sede} ${row.qty}`)
              .join(' · ') || `${chunk.qty} pzas`)
          : `${chunk.qty} de ${chunk.group.total_qty} del lote`}
      </span>
      <div className="prod-card-foot">
        <div className="prod-card-counter" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label={`Devolver una pieza a ${STAGE_LABEL[chunk.prevStage] || 'la etapa anterior'}`}
            title={chunk.prevStage ? `Devolver 1 a ${STAGE_LABEL[chunk.prevStage]}` : 'Sin etapa anterior'}
            disabled={!chunk.prevStage || chunk.qty <= 0 || Boolean(busyKey)}
            onClick={() => pushPieces(chunk, { members: chunk.members, fromStage: chunk.stage, direction: 'back', qty: 1 })}
          >
            −
          </button>
          <span className="prod-chunk-qty">{chunk.qty}</span>
          <button
            type="button"
            className="is-plus"
            aria-label={`Empujar una pieza a ${STAGE_LABEL[chunk.nextStage] || 'la siguiente etapa'}`}
            title={chunk.nextStage ? `Empujar 1 a ${STAGE_LABEL[chunk.nextStage]}` : 'Sin etapa siguiente'}
            disabled={!chunk.nextStage || chunk.qty <= 0 || Boolean(busyKey)}
            onClick={() => pushPieces(chunk, { members: chunk.members, fromStage: chunk.stage, direction: 'forward', qty: 1 })}
          >
            +
          </button>
        </div>
        {renderMeta(chunk, isExpanded, chunk.nextStage ? `+ → ${STAGE_LABEL[chunk.nextStage]}` : null)}
      </div>
      {isExpanded && (
        <div className="prod-card-extra" onClick={(e) => e.stopPropagation()}>
          {renderExpandedCommon(chunk)}
        </div>
      )}
    </>
  ));

  // Tarjeta de Pintado con variantes: pool de piezas sin pintar y un «+» por
  // color — pintura decide el orden. El «−» devuelve una pieza sin pintar.
  const renderPaintCard = (chunk) => cardShell(chunk, ({ isExpanded }) => (
    <>
      <span className="prod-card-sede">
        {chunk.qty} sin pintar · lote de {chunk.group.total_qty}
      </span>
      <div className="prod-paint-rows" onClick={(e) => e.stopPropagation()}>
        {chunk.colors.map((color) => (
          <div key={color.sku} className="prod-card-color-row">
            <ColorSwatch code={color.code} label={color.label} />
            <span className="prod-card-color-name">{color.label || color.sku}</span>
            <span
              className="prod-card-color-count"
              title={color.remaining > 0 ? `Faltan ${color.remaining} por pintar` : 'Color completo'}
            >
              {color.remaining > 0 ? color.remaining : '✓'}
            </span>
            <div className="prod-card-counter prod-paint-counter">
              <button
                type="button"
                className="is-plus"
                aria-label={`Pintar una pieza de ${color.label || color.sku}`}
                title={`Pintar 1 ${color.label || color.sku} → ${STAGE_LABEL[chunk.nextStage] || 'siguiente'}`}
                disabled={Boolean(busyKey) || chunk.qty <= 0 || color.remaining <= 0 || !chunk.nextStage}
                onClick={() => pushPieces(chunk, { members: color.members, fromStage: 'pintado', direction: 'forward', qty: 1 })}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="prod-card-foot">
        <div className="prod-card-counter" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label={`Devolver una pieza sin pintar a ${STAGE_LABEL[chunk.prevStage] || 'la etapa anterior'}`}
            title={chunk.prevStage ? `Devolver 1 sin pintar a ${STAGE_LABEL[chunk.prevStage]}` : 'Sin etapa anterior'}
            disabled={!chunk.prevStage || chunk.qty <= 0 || Boolean(busyKey)}
            onClick={() => pushPieces(chunk, { members: chunk.members, fromStage: 'pintado', direction: 'back', qty: 1 })}
          >
            −
          </button>
        </div>
        {renderMeta(chunk, isExpanded, `+ pinta → ${STAGE_LABEL[chunk.nextStage] || ''}`)}
      </div>
      {isExpanded && (
        <div className="prod-card-extra" onClick={(e) => e.stopPropagation()}>
          {renderExpandedCommon(chunk, { showAdvanceAll: false })}
        </div>
      )}
    </>
  ));

  const renderChunkCard = (chunk) => (chunk.kind === 'paint' ? renderPaintCard(chunk) : renderCounterCard(chunk));

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
