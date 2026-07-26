import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { BOARD_STAGES, STAGE_LABEL, groupIntoBatches, sedeTotals } from './productionShared';
import { boliviaToday } from './campaignShared';

// The production board: only factory stages. Planning lives in /produccion-planificacion
// (cards enter here when their tentative date arrives) and reception in /recepcion.
// El ritmo lo marca el mínimo de inventario y la fecha de Planificación (deadline),
// no el cronómetro: las tarjetas muestran su fecha, no el tiempo transcurrido.
// `onCommissionChanged` refreshes the nav commission box: approving pieces at the
// QC gate feeds commissions; kept as a cheap refresh after quality runs.

// "2026-06-04" → "4 jun" sin pasar por Date (evita corrimientos de zona horaria).
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const formatDeadline = (isoDate) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  return `${Number(match[3])} ${MONTH_SHORT[Number(match[2]) - 1] || ''}`;
};

export default function ProductionKanban({ token, onCommissionChanged }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [activeStage, setActiveStage] = useState('corte_laser');
  const [expandedKey, setExpandedKey] = useState(null);
  const [notice, setNotice] = useState('');
  const [batchTasks, setBatchTasks] = useState([]);
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

  // Aviso fugaz cuando un lote avanza solo (p. ej. al completar el conteo).
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const boardStageKeys = useMemo(() => BOARD_STAGES.map((s) => s.key), []);
  const batches = useMemo(
    () => groupIntoBatches(cards, { stages: boardStageKeys }),
    [cards, boardStageKeys]
  );

  const itemsByStage = useMemo(() => {
    const grouped = Object.fromEntries(BOARD_STAGES.map((s) => [s.key, []]));
    for (const batch of batches.values()) {
      if (grouped[batch.stage]) grouped[batch.stage].push(batch);
    }
    return grouped;
  }, [batches]);

  const totalInProduction = useMemo(
    () => [...batches.values()].reduce((sum, b) => sum + b.total_qty, 0),
    [batches]
  );
  const receptionCount = useMemo(() => cards.filter((c) => c.stage === 'recepcion').length, [cards]);
  const planningCount = useMemo(() => cards.filter((c) => c.stage === 'planificacion').length, [cards]);

  // Carga por columna: lotes y piezas. La columna con más piezas (habiendo
  // alguna) es el cuello de botella.
  const colStats = useMemo(() => {
    const stats = {};
    for (const stage of BOARD_STAGES) {
      const items = itemsByStage[stage.key] || [];
      stats[stage.key] = {
        lots: items.length,
        pieces: items.reduce((sum, b) => sum + b.total_qty, 0)
      };
    }
    const maxPieces = Math.max(...Object.values(stats).map((s) => s.pieces), 0);
    const bottleneck = maxPieces > 0
      ? Object.keys(stats).find((key) => stats[key].pieces === maxPieces)
      : null;
    return { stats, bottleneck };
  }, [itemsByStage]);

  const expandedBatch = expandedKey ? batches.get(expandedKey) || null : null;

  // Measurement tasks for the expanded batch (merged across its cards).
  useEffect(() => {
    setBatchTasks([]);
    setTaskInputs({});
    const memberIds = expandedBatch ? expandedBatch.members.map((m) => m.id) : [];
    if (memberIds.length === 0) return;
    let active = true;
    Promise.all(memberIds.map((id) =>
      apiRequest(`/api/production/kanban/cards/${id}/tasks`, { token }).catch(() => ({ tasks: [] }))
    )).then((results) => {
      if (active) setBatchTasks(results.flatMap((r) => (Array.isArray(r?.tasks) ? r.tasks : [])));
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
      setBatchTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err.message || 'No se pudo registrar la medición');
    } finally {
      setTaskBusyId(null);
    }
  };

  const nextStageOfBatch = (batch) => {
    const route = batch?.route || [];
    const idx = route.indexOf(batch.stage);
    return idx >= 0 && idx < route.length - 1 ? route[idx + 1] : null;
  };

  // Etapa anterior en la ruta (sin volver a planificación): el camino de
  // regreso cuando se avanzó por error o hay retrabajo.
  const prevStageOfBatch = (batch) => {
    const route = batch?.route || [];
    const idx = route.indexOf(batch.stage);
    const prev = idx > 0 ? route[idx - 1] : null;
    return prev && prev !== 'planificacion' ? prev : null;
  };

  // Completar la etapa: el conteo es la verdad. Hacia Embalado pasa por la
  // puerta de calidad con todas las piezas aprobadas (contarlas ES aprobarlas);
  // hacia cualquier otra etapa es un movimiento normal de la ruta.
  const completeStage = async (batch, targetStage) => {
    const next = targetStage || nextStageOfBatch(batch);
    if (!batch || !next) return;
    setBusyKey(batch.key);
    setError('');
    try {
      if (next === 'embalado') {
        for (const color of batch.color_list) {
          await apiRequest('/api/production/kanban/qc-gate', {
            method: 'POST',
            token,
            body: { card_ids: color.members.map((m) => m.id), passed: color.qty, rejected: 0 }
          });
        }
        // Approved pieces feed the monthly QC commission — refresh the nav box.
        if (typeof onCommissionChanged === 'function') onCommissionChanged();
      } else {
        await apiRequest('/api/production/kanban/batch-stage', {
          method: 'PATCH',
          token,
          body: { card_ids: batch.members.map((m) => m.id), stage: next }
        });
      }
      setExpandedKey(null);
      setNotice(`${batch.display_name} → ${STAGE_LABEL[next] || next} ✓`);
      await loadBoard();
    } catch (err) {
      setError(err.message || 'No se pudo mover el lote');
      await loadBoard();
    } finally {
      setBusyKey('');
    }
  };

  // Piece counter: optimistic local update (mirrors the server's fill-by-id
  // distribution); on failure, reload the board. `scope` is either the whole
  // batch or one color of it. Al completar el total del lote, avanza solo a
  // la siguiente etapa (después de que el avance quede guardado).
  const adjustProgress = (batch, scopeMembers, scopeProcessed, scopeTotal, delta) => {
    const target = Math.min(scopeTotal, Math.max(0, scopeProcessed + delta));
    if (target === scopeProcessed) return;
    const ordered = [...scopeMembers].sort((a, b) => Number(a.id) - Number(b.id));
    const shares = new Map();
    let remaining = target;
    for (const member of ordered) {
      const share = Math.min(remaining, Number(member.required_qty || 0));
      shares.set(member.id, share);
      remaining -= share;
    }
    setCards((prev) => prev.map((c) => (shares.has(c.id) ? { ...c, processed_count: shares.get(c.id) } : c)));
    const request = apiRequest('/api/production/kanban/batch-progress', {
      method: 'PATCH',
      token,
      body: { card_ids: scopeMembers.map((m) => m.id), delta }
    });
    const batchProcessedAfter = batch.processed + (target - scopeProcessed);
    if (delta > 0 && batchProcessedAfter >= batch.total_qty && nextStageOfBatch(batch)) {
      request.then(() => completeStage(batch)).catch(() => {});
    }
    request.catch((err) => {
      setError(err.message || 'No se pudo registrar el avance');
      loadBoard();
    });
  };

  // La tarjeta lo es todo (sin popup): nombre, deadline de Planificación,
  // barra + contador. Tocarla la expande para lo que no cabe en la cara:
  // contadores por color en Pintado, tareas de medición y Avanzar/Devolver.
  const renderBatchCard = (batch) => {
    const pct = batch.total_qty > 0 ? Math.round((batch.processed / batch.total_qty) * 100) : 0;
    const countsPerColor = batch.is_variant_group && batch.stage === 'pintado';
    const deadline = formatDeadline(batch.planned_date);
    const overdue = Boolean(batch.planned_date) && String(batch.planned_date).slice(0, 10) < boliviaToday();
    const isExpanded = expandedKey === batch.key;
    const toggle = () => setExpandedKey(isExpanded ? null : batch.key);
    return (
      <div
        key={batch.key}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={`prod-card ${isExpanded ? 'is-expanded' : ''} ${busyKey === batch.key ? 'is-busy' : ''}`}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <div className="prod-card-top">
          <span className="prod-card-name">{batch.display_name}</span>
          {deadline && (
            <span className={`prod-card-deadline ${overdue ? 'is-overdue' : ''}`} title="Fecha planificada">
              📅 {deadline}
            </span>
          )}
        </div>
        <span className="prod-card-sede">
          {batch.is_variant_group
            ? batch.color_list.map((c) => `${c.label} ${c.qty}`).join(' · ')
            : sedeTotals(batch).map((s) => `${s.sede} ${s.qty}`).join(' · ')}
        </span>
        <div className="prod-card-progress">
          <div className="prod-card-bar">
            <div className={`prod-card-fill ${pct >= 100 ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="prod-card-count">{batch.processed}/{batch.total_qty}</span>
        </div>
        <div className="prod-card-foot">
          {countsPerColor ? (
            <span className="prod-card-percolor">conteo por color ↓</span>
          ) : (
            <div className="prod-card-counter" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label={`Restar una pieza de ${batch.display_name}`}
                disabled={batch.processed <= 0}
                onClick={() => adjustProgress(batch, batch.members, batch.processed, batch.total_qty, -1)}
              >
                −
              </button>
              <button
                type="button"
                className="is-plus"
                aria-label={`Sumar una pieza de ${batch.display_name}`}
                disabled={batch.processed >= batch.total_qty}
                onClick={() => adjustProgress(batch, batch.members, batch.processed, batch.total_qty, 1)}
              >
                +
              </button>
            </div>
          )}
          <span className="prod-card-meta">
            {batch.pending_tasks > 0 && (
              <span className="prod-card-task-badge" title="Tareas de medición pendientes">
                {batch.pending_tasks} tarea{batch.pending_tasks > 1 ? 's' : ''}
              </span>
            )}
            <span className="prod-card-chevron" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
          </span>
        </div>

        {isExpanded && (
          <div className="prod-card-extra" onClick={(e) => e.stopPropagation()}>
            {countsPerColor && batch.color_list.map((color) => (
              <div key={color.sku} className="prod-card-color-row">
                <span className="prod-card-color-name">{color.label}</span>
                <div className="prod-card-counter">
                  <button
                    type="button"
                    aria-label={`Restar una pieza de ${color.label}`}
                    disabled={color.processed <= 0}
                    onClick={() => adjustProgress(batch, color.members, color.processed, color.qty, -1)}
                  >
                    −
                  </button>
                  <span className="prod-card-color-count">{color.processed}/{color.qty}</span>
                  <button
                    type="button"
                    className="is-plus"
                    aria-label={`Sumar una pieza de ${color.label}`}
                    disabled={color.processed >= color.qty}
                    onClick={() => adjustProgress(batch, color.members, color.processed, color.qty, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}

            {batchTasks.map((task) => (
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

            {nextStageOfBatch(batch) && (
              <button
                type="button"
                className="btn btn-primary prod-advance-btn"
                disabled={busyKey === batch.key}
                onClick={() => completeStage(batch)}
              >
                Avanzar a {STAGE_LABEL[nextStageOfBatch(batch)]}
              </button>
            )}
            {prevStageOfBatch(batch) && (
              <button
                type="button"
                className="prod-back-btn"
                disabled={busyKey === batch.key}
                onClick={() => completeStage(batch, prevStageOfBatch(batch))}
              >
                ← Devolver a {STAGE_LABEL[prevStageOfBatch(batch)]}
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
        <div className="prod-kpi"><span className="prod-kpi-label">Lotes en planta</span><span className="prod-kpi-value" style={{ color: '#0284c7' }}>{batches.size}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Piezas en producción</span><span className="prod-kpi-value" style={{ color: '#f59e0b' }}>{totalInProduction}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Por planificar</span><span className="prod-kpi-value" style={{ color: '#78716c' }}>{planningCount}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Por recibir</span><span className="prod-kpi-value" style={{ color: '#16a34a' }}>{receptionCount}</span></div>
      </div>

      {error && <div className="card prod-error">{error}</div>}
      {notice && <div className="prod-notice">{notice}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando producción…</div>
      ) : (
        <div className="prod-board">
          <div className="prod-stage-nav" role="tablist" aria-label="Etapas de producción">
            {BOARD_STAGES.map((stage) => {
              const count = itemsByStage[stage.key]?.length || 0;
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
              const items = itemsByStage[stage.key] || [];
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
                    {items.map((batch) => renderBatchCard(batch))}
                    {items.length === 0 && <div className="prod-col-empty">Sin lotes</div>}
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
