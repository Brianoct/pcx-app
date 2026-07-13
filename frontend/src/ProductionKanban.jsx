import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { BOARD_STAGES, STAGE_LABEL, groupIntoBatches, sedeTotals, stopwatchSince } from './productionShared';

// The production board: only factory stages. Planning lives in /produccion-planificacion
// (cards enter here when their tentative date arrives) and reception in /recepcion.
// `onCommissionChanged` refreshes the nav commission box: approving pieces at the
// QC gate used to feed commissions; kept as a cheap refresh after quality runs.
export default function ProductionKanban({ token, onCommissionChanged }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [activeStage, setActiveStage] = useState('corte_laser');
  const [detailKey, setDetailKey] = useState(null);
  const [qcForm, setQcForm] = useState({});
  const [actionMsg, setActionMsg] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [sheetTasks, setSheetTasks] = useState([]);
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

  const detailBatch = detailKey ? batches.get(detailKey) || null : null;

  useEffect(() => {
    setQcForm({});
    setActionMsg('');
  }, [detailKey]);

  // Ticking clock for the sheet's stopwatch (only runs while a sheet is open).
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!detailKey) return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [detailKey]);

  // Measurement tasks for the open batch (merged across its cards).
  useEffect(() => {
    setSheetTasks([]);
    setTaskInputs({});
    const memberIds = detailBatch ? detailBatch.members.map((m) => m.id) : [];
    if (memberIds.length === 0) return;
    let active = true;
    Promise.all(memberIds.map((id) =>
      apiRequest(`/api/production/kanban/cards/${id}/tasks`, { token }).catch(() => ({ tasks: [] }))
    )).then((results) => {
      if (active) setSheetTasks(results.flatMap((r) => (Array.isArray(r?.tasks) ? r.tasks : [])));
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, token]);

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
      setSheetTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err.message || 'No se pudo registrar la medición');
    } finally {
      setTaskBusyId(null);
    }
  };

  // Piece counter: optimistic local update (mirrors the server's fill-by-id
  // distribution) + fire-and-forget PATCH; on failure, reload the board.
  // `scope` is either the whole batch or one color of it.
  const adjustProgress = (scopeMembers, scopeProcessed, scopeTotal, delta) => {
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
    apiRequest('/api/production/kanban/batch-progress', {
      method: 'PATCH',
      token,
      body: { card_ids: scopeMembers.map((m) => m.id), delta }
    }).catch((err) => {
      setError(err.message || 'No se pudo registrar el avance');
      loadBoard();
    });
  };

  const moveBatch = async (batch, nextStage) => {
    if (!batch || !nextStage || batch.stage === nextStage) return;
    setBusyKey(batch.key);
    setError('');
    setActionMsg('');
    try {
      await apiRequest('/api/production/kanban/batch-stage', {
        method: 'PATCH',
        token,
        body: { card_ids: batch.members.map((m) => m.id), stage: nextStage }
      });
      setDetailKey(null);
      await loadBoard();
    } catch (err) {
      if (err?.payload?.code === 'qc_gate_required') {
        setActionMsg('Registra el control de calidad para pasar a embalado (abajo).');
      } else {
        setError(err.message || 'No se pudo mover el lote');
      }
    } finally {
      setBusyKey('');
    }
  };

  // QC gate: one submit per color (the backend records quality per SKU), all
  // colors of the lote in one go. Single-color lotes keep the simple form.
  const submitQcGate = async (batch) => {
    const rows = batch.color_list.map((color) => ({
      color,
      passed: Number.parseInt(qcForm[color.sku]?.passed, 10) || 0,
      rejected: Number.parseInt(qcForm[color.sku]?.rejected, 10) || 0
    }));
    if (rows.every((r) => r.passed <= 0 && r.rejected <= 0)) {
      setActionMsg('Ingresa al menos una pieza aprobada o rechazada.');
      return;
    }
    const overQty = rows.find((r) => r.passed > r.color.qty);
    if (overQty) {
      setActionMsg(`Aprobadas de ${overQty.color.label} (${overQty.passed}) no puede superar sus piezas (${overQty.color.qty}).`);
      return;
    }
    setActionSaving(true);
    setActionMsg('');
    try {
      for (const row of rows) {
        if (row.passed <= 0 && row.rejected <= 0) continue;
        await apiRequest('/api/production/kanban/qc-gate', {
          method: 'POST',
          token,
          body: { card_ids: row.color.members.map((m) => m.id), passed: row.passed, rejected: row.rejected }
        });
      }
      // Approved pieces feed the monthly QC commission — refresh the nav box.
      if (typeof onCommissionChanged === 'function') onCommissionChanged();
      setDetailKey(null);
      await loadBoard();
    } catch (err) {
      setActionMsg(err.message || 'No se pudo registrar el control de calidad');
      await loadBoard();
    } finally {
      setActionSaving(false);
    }
  };

  const nextStageOfBatch = (batch) => {
    const route = batch?.route || [];
    const idx = route.indexOf(batch.stage);
    return idx >= 0 && idx < route.length - 1 ? route[idx + 1] : null;
  };

  const renderBatchCard = (batch) => (
    <button
      key={batch.key}
      type="button"
      className="prod-card"
      onClick={() => setDetailKey(batch.key)}
      disabled={busyKey === batch.key}
    >
      <span className="prod-card-name">{batch.display_name}</span>
      <span className="prod-card-qty">
        {batch.total_qty} pzas
        {batch.pending_tasks > 0 && (
          <span className="prod-card-task-badge" title="Tareas de medición pendientes">
            {batch.pending_tasks} tarea{batch.pending_tasks > 1 ? 's' : ''}
          </span>
        )}
      </span>
      <span className="prod-card-sede">
        {batch.is_variant_group
          ? batch.color_list.map((c) => `${c.label} ${c.qty}`).join(' · ')
          : sedeTotals(batch).map((s) => `${s.sede} ${s.qty}`).join(' · ')}
      </span>
    </button>
  );

  return (
    <div className="container prod-page">
      <div className="prod-kpis">
        <div className="prod-kpi"><span className="prod-kpi-label">Lotes en planta</span><span className="prod-kpi-value" style={{ color: '#0284c7' }}>{batches.size}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Piezas en producción</span><span className="prod-kpi-value" style={{ color: '#f59e0b' }}>{totalInProduction}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Por planificar</span><span className="prod-kpi-value" style={{ color: '#78716c' }}>{planningCount}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Por recibir</span><span className="prod-kpi-value" style={{ color: '#16a34a' }}>{receptionCount}</span></div>
      </div>

      {error && <div className="card prod-error">{error}</div>}

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
              return (
                <section
                  key={stage.key}
                  className={`prod-col ${activeStage === stage.key ? 'is-active' : ''}`}
                >
                  <header className="prod-col-head">
                    <span className="prod-col-name">{stage.label}</span>
                    <span className="prod-col-count">{items.length}</span>
                  </header>
                  <div className="prod-col-body">
                    {items.map((batch) => renderBatchCard(batch))}
                    {items.length === 0 && <div className="prod-col-empty">Sin tarjetas</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {detailBatch && (
        <div className="prod-sheet-overlay" onClick={() => setDetailKey(null)}>
          <div className="prod-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="prod-sheet-handle" aria-hidden="true" />
            <div className="prod-sheet-head">
              <div>
                <div className="prod-sheet-title">{detailBatch.display_name}</div>
                <div className="prod-sheet-sku">
                  {detailBatch.display_sku}
                  {detailBatch.is_variant_group
                    ? ` · ${detailBatch.color_list.length} colores`
                    : ` · lote de ${detailBatch.members.length} sede${detailBatch.members.length > 1 ? 's' : ''}`}
                </div>
              </div>
              <button type="button" className="prod-sheet-close" onClick={() => setDetailKey(null)} aria-label="Cerrar">✕</button>
            </div>

            <div className="prod-hero">
              <div className="prod-hero-qty">{detailBatch.total_qty}</div>
              <div className="prod-hero-label">piezas a producir</div>
              <div className="prod-sede-chips">
                {detailBatch.is_variant_group
                  ? detailBatch.color_list.map((color) => (
                    <span key={color.sku} className="prod-sede-chip">
                      {color.label} <strong>{color.qty}</strong>
                    </span>
                  ))
                  : sedeTotals(detailBatch).map((s) => (
                    <span key={s.sede} className="prod-sede-chip">
                      {s.sede} <strong>{s.qty}</strong>
                    </span>
                  ))}
              </div>
              {detailBatch.is_variant_group && (
                <div className="prod-sede-secondary">
                  {sedeTotals(detailBatch).map((s) => `${s.sede} ${s.qty}`).join(' · ')}
                </div>
              )}
            </div>

            {stopwatchSince(detailBatch.oldest_move, clock) && (
              <div className="prod-stopwatch">
                <span className="prod-stopwatch-label">En {STAGE_LABEL[detailBatch.stage] || detailBatch.stage}</span>
                <span className="prod-stopwatch-time">{stopwatchSince(detailBatch.oldest_move, clock)}</span>
              </div>
            )}

            {/* Pintado on a multi-color lote: one counter per color. Any other
                stage (or single-color lote): one counter for the whole batch. */}
            {detailBatch.is_variant_group && detailBatch.stage === 'pintado' ? (
              <div className="prod-counter">
                <span className="prod-counter-label">Piezas pintadas por color</span>
                {detailBatch.color_list.map((color) => (
                  <div key={color.sku} className="prod-counter-color-row">
                    <span className="prod-counter-color-name">{color.label}</span>
                    <div className="prod-counter-controls is-compact">
                      <button
                        type="button"
                        className="prod-counter-btn is-small"
                        aria-label={`Restar una pieza de ${color.label}`}
                        disabled={color.processed <= 0}
                        onClick={() => adjustProgress(color.members, color.processed, color.qty, -1)}
                      >
                        −
                      </button>
                      <span className="prod-counter-display is-small">
                        {color.processed}
                        <span className="prod-counter-total">/{color.qty}</span>
                      </span>
                      <button
                        type="button"
                        className="prod-counter-btn is-small is-plus"
                        aria-label={`Sumar una pieza de ${color.label}`}
                        disabled={color.processed >= color.qty}
                        onClick={() => adjustProgress(color.members, color.processed, color.qty, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="prod-counter">
                <span className="prod-counter-label">Piezas procesadas en esta etapa</span>
                <div className="prod-counter-controls">
                  <button
                    type="button"
                    className="prod-counter-btn"
                    aria-label="Restar una pieza"
                    disabled={detailBatch.processed <= 0}
                    onClick={() => adjustProgress(detailBatch.members, detailBatch.processed, detailBatch.total_qty, -1)}
                  >
                    −
                  </button>
                  <span className="prod-counter-display">
                    {detailBatch.processed}
                    <span className="prod-counter-total">/{detailBatch.total_qty}</span>
                  </span>
                  <button
                    type="button"
                    className="prod-counter-btn is-plus"
                    aria-label="Sumar una pieza"
                    disabled={detailBatch.processed >= detailBatch.total_qty}
                    onClick={() => adjustProgress(detailBatch.members, detailBatch.processed, detailBatch.total_qty, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <div className="prod-sheet-section-label">Mover lote a</div>
            <div className="prod-move-chips">
              {detailBatch.route.filter((step) => step !== 'planificacion').map((step) => {
                const isCurrent = detailBatch.stage === step;
                return (
                  <button
                    key={step}
                    type="button"
                    className={`prod-move-chip ${isCurrent ? 'is-current' : ''}`}
                    disabled={isCurrent || busyKey === detailBatch.key || step === 'embalado'}
                    title={step === 'embalado' ? 'A embalado se pasa registrando el control de calidad' : undefined}
                    onClick={() => moveBatch(detailBatch, step)}
                  >
                    {STAGE_LABEL[step] || step}
                  </button>
                );
              })}
            </div>

            {nextStageOfBatch(detailBatch) && nextStageOfBatch(detailBatch) !== 'embalado' && (
              <button
                type="button"
                className="btn btn-primary prod-advance-btn"
                disabled={busyKey === detailBatch.key}
                onClick={() => moveBatch(detailBatch, nextStageOfBatch(detailBatch))}
              >
                Avanzar a {STAGE_LABEL[nextStageOfBatch(detailBatch)]}
              </button>
            )}

            {/* The quality stop: inspecting is what moves the batch into embalado.
                Multi-color lotes inspect per color (quality records live per SKU). */}
            {nextStageOfBatch(detailBatch) === 'embalado' && (
              <div className="prod-qc">
                <div className="prod-sheet-section-label">Control de calidad → Embalado</div>
                <p className="prod-qc-note">
                  Inspecciona el lote ({detailBatch.total_qty} pzas). Solo las aprobadas pasan a embalado;
                  las rechazadas se registran y la necesidad se regenera sola.
                </p>
                {detailBatch.color_list.map((color) => (
                  <div key={color.sku} className={detailBatch.is_variant_group ? 'prod-qc-color-row' : ''}>
                    {detailBatch.is_variant_group && (
                      <span className="prod-qc-color-name">{color.label} · {color.qty} pzas</span>
                    )}
                    <div className="prod-qc-fields">
                      <label className="prod-qc-field">
                        <span className="prod-qc-field-label">Aprobadas</span>
                        <input
                          type="number" min="0" inputMode="numeric" className="prod-qc-input"
                          value={qcForm[color.sku]?.passed ?? ''}
                          onChange={(e) => setQcForm((prev) => ({ ...prev, [color.sku]: { ...prev[color.sku], passed: e.target.value } }))}
                          placeholder={String(color.qty)}
                        />
                      </label>
                      <label className="prod-qc-field">
                        <span className="prod-qc-field-label">Rechazadas</span>
                        <input
                          type="number" min="0" inputMode="numeric" className="prod-qc-input"
                          value={qcForm[color.sku]?.rejected ?? ''}
                          onChange={(e) => setQcForm((prev) => ({ ...prev, [color.sku]: { ...prev[color.sku], rejected: e.target.value } }))}
                          placeholder="0"
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {actionMsg && <div className="prod-qc-msg">{actionMsg}</div>}
                <button
                  type="button"
                  className="btn btn-primary prod-qc-btn"
                  disabled={actionSaving}
                  onClick={() => submitQcGate(detailBatch)}
                >
                  {actionSaving ? 'Guardando…' : 'Registrar calidad y pasar a embalado'}
                </button>
              </div>
            )}

            {sheetTasks.length > 0 && (
              <div className="prod-tasks">
                <div className="prod-sheet-section-label">Tareas de medición</div>
                {sheetTasks.map((task) => (
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
