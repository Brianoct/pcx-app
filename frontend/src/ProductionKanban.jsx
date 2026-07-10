import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

// Board (display) order — must match backend PRODUCTION_KANBAN_STAGES.
const STAGES = [
  { key: 'planificacion', label: 'Planificación' },
  { key: 'impresion_3d', label: 'Impresión 3D' },
  { key: 'corte_laser', label: 'Corte Láser' },
  { key: 'punzonado', label: 'Punzonado' },
  { key: 'plegado', label: 'Plegado' },
  { key: 'soldado', label: 'Soldado' },
  { key: 'lavado', label: 'Lavado' },
  { key: 'pintado', label: 'Pintado' },
  { key: 'embalado', label: 'Embalado' },
  { key: 'recepcion', label: 'Recepción' }
];

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const STAGE_ORDER = STAGES.map((s) => s.key);

// A card carries its own `route` from the backend (welded products include
// soldado). Fall back to the full board order if it's ever missing.
const cardRoute = (card) => (Array.isArray(card?.route) && card.route.length ? card.route : STAGE_ORDER);

// Live stopwatch since the batch entered its stage: "03:27:45" / "1d 03:27:45".
const pad2 = (n) => String(n).padStart(2, '0');
const stopwatchSince = (since, now) => {
  if (!since) return null;
  let secs = Math.floor((now - new Date(since).getTime()) / 1000);
  if (!Number.isFinite(secs)) return null;
  if (secs < 0) secs = 0;
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  return `${days > 0 ? `${days}d ` : ''}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
};

// One SKU in one stage = one "mother card" (the factory runs a single batch;
// the per-sede split only matters at Recepción, where cards go solo).
const groupIntoBatches = (cards) => {
  const batches = new Map();
  for (const card of cards) {
    if (card.stage === 'recepcion') continue;
    const key = `${card.sku}::${card.stage}`;
    if (!batches.has(key)) {
      batches.set(key, {
        key,
        sku: card.sku,
        product_name: card.product_name,
        stage: card.stage,
        route: cardRoute(card),
        members: [],
        total_qty: 0,
        processed: 0,
        pending_tasks: 0,
        qty_frozen: false,
        oldest_move: null
      });
    }
    const batch = batches.get(key);
    batch.members.push(card);
    batch.total_qty += Number(card.required_qty || 0);
    batch.processed += Number(card.processed_count || 0);
    batch.pending_tasks += Number(card.pending_tasks || 0);
    batch.qty_frozen = batch.qty_frozen || Boolean(card.qty_frozen);
    const since = card.last_moved_at || card.created_at;
    if (since && (!batch.oldest_move || new Date(since) < new Date(batch.oldest_move))) {
      batch.oldest_move = since;
    }
  }
  return batches;
};

export default function ProductionKanban({ token }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [activeStage, setActiveStage] = useState('planificacion');
  const [detailKey, setDetailKey] = useState(null); // batch key or "card:<id>"
  const [qcForm, setQcForm] = useState({ passed: '', rejected: '' });
  const [receiveForm, setReceiveForm] = useState({ intact: '', damaged: '' });
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

  const batches = useMemo(() => groupIntoBatches(cards), [cards]);

  const receptionCards = useMemo(() => cards.filter((card) => card.stage === 'recepcion'), [cards]);

  const itemsByStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((s) => [s.key, []]));
    for (const batch of batches.values()) {
      if (grouped[batch.stage]) grouped[batch.stage].push(batch);
    }
    for (const card of receptionCards) grouped.recepcion.push(card);
    return grouped;
  }, [batches, receptionCards]);

  const totalRequiredQty = useMemo(
    () => cards.reduce((sum, c) => sum + Number(c.required_qty || 0), 0),
    [cards]
  );

  const detailBatch = detailKey && !detailKey.startsWith('card:') ? batches.get(detailKey) || null : null;
  const detailCard = detailKey?.startsWith('card:')
    ? cards.find((c) => `card:${c.id}` === detailKey) || null
    : null;

  useEffect(() => {
    setQcForm({ passed: '', rejected: '' });
    setReceiveForm({ intact: '', damaged: '' });
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

  // Piece counter: optimistic local update (mirrors the server's fill-by-id
  // distribution) + fire-and-forget PATCH; on failure, reload the board.
  const adjustProgress = (batch, delta) => {
    const target = Math.min(batch.total_qty, Math.max(0, batch.processed + delta));
    if (target === batch.processed) return;
    const ordered = [...batch.members].sort((a, b) => Number(a.id) - Number(b.id));
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
      body: { card_ids: batch.members.map((m) => m.id), delta }
    }).catch((err) => {
      setError(err.message || 'No se pudo registrar el avance');
      loadBoard();
    });
  };

  // Measurement tasks for the open batch (merged across its sede cards).
  useEffect(() => {
    setSheetTasks([]);
    setTaskInputs({});
    const memberIds = detailBatch ? detailBatch.members.map((m) => m.id) : (detailCard ? [detailCard.id] : []);
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

  const submitQcGate = async (batch) => {
    const passed = Number.parseInt(qcForm.passed, 10) || 0;
    const rejected = Number.parseInt(qcForm.rejected, 10) || 0;
    if (passed <= 0 && rejected <= 0) {
      setActionMsg('Ingresa al menos una pieza aprobada o rechazada.');
      return;
    }
    setActionSaving(true);
    setActionMsg('');
    try {
      const res = await apiRequest('/api/production/kanban/qc-gate', {
        method: 'POST',
        token,
        body: { card_ids: batch.members.map((m) => m.id), passed, rejected }
      });
      setActionMsg(res?.message || 'Calidad registrada');
      setDetailKey(null);
      await loadBoard();
    } catch (err) {
      setActionMsg(err.message || 'No se pudo registrar el control de calidad');
    } finally {
      setActionSaving(false);
    }
  };

  const submitReceive = async (card) => {
    const intact = Number.parseInt(receiveForm.intact, 10) || 0;
    const damaged = Number.parseInt(receiveForm.damaged, 10) || 0;
    if (intact <= 0 && damaged <= 0) {
      setActionMsg('Registra al menos una pieza recibida o dañada.');
      return;
    }
    setActionSaving(true);
    setActionMsg('');
    try {
      const res = await apiRequest(`/api/production/kanban/cards/${card.id}/receive`, {
        method: 'POST',
        token,
        body: { intact, damaged }
      });
      setActionMsg(`Recibidas ${res?.intact} intactas en ${res?.store_location}${res?.damaged > 0 ? ` · ${res.damaged} dañadas registradas` : ''}.`);
      setDetailKey(null);
      await loadBoard();
    } catch (err) {
      setActionMsg(err.message || 'No se pudo confirmar la recepción');
    } finally {
      setActionSaving(false);
    }
  };

  const nextStageOfBatch = (batch) => {
    const route = batch?.route || STAGE_ORDER;
    const idx = route.indexOf(batch.stage);
    return idx >= 0 && idx < route.length - 1 ? route[idx + 1] : null;
  };

  const renderBatchCard = (batch) => (
    <button
      key={batch.key}
      type="button"
      className={`prod-card ${batch.stage === 'planificacion' ? 'is-planning' : ''}`}
      onClick={() => setDetailKey(batch.key)}
      disabled={busyKey === batch.key}
    >
      <span className="prod-card-name">{batch.product_name}</span>
      <span className="prod-card-qty">
        {batch.total_qty} pzas
        {batch.pending_tasks > 0 && (
          <span className="prod-card-task-badge" title="Tareas de medición pendientes">
            {batch.pending_tasks} tarea{batch.pending_tasks > 1 ? 's' : ''}
          </span>
        )}
      </span>
      <span className="prod-card-sede">
        {batch.members.map((m) => `${m.store_location} ${m.required_qty}`).join(' · ')}
      </span>
    </button>
  );

  const renderReceptionCard = (card) => (
    <button
      key={`card:${card.id}`}
      type="button"
      className="prod-card is-reception"
      onClick={() => setDetailKey(`card:${card.id}`)}
    >
      <span className="prod-card-name">{card.product_name}</span>
      <span className="prod-card-qty">{Number(card.required_qty || 0)} pzas en camino</span>
      <span className="prod-card-sede">→ {card.store_location}</span>
    </button>
  );

  return (
    <div className="container prod-page">
      <div className="prod-kpis">
        <div className="prod-kpi"><span className="prod-kpi-label">Lotes en planta</span><span className="prod-kpi-value" style={{ color: '#0284c7' }}>{[...batches.values()].filter((b) => b.stage !== 'planificacion').length}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Piezas requeridas</span><span className="prod-kpi-value" style={{ color: '#f59e0b' }}>{totalRequiredQty}</span></div>
        <div className="prod-kpi"><span className="prod-kpi-label">Por recibir</span><span className="prod-kpi-value" style={{ color: '#16a34a' }}>{receptionCards.length}</span></div>
      </div>

      {error && <div className="card prod-error">{error}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando producción…</div>
      ) : (
        <div className="prod-board">
          <div className="prod-stage-nav" role="tablist" aria-label="Etapas de producción">
            {STAGES.map((stage) => {
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
            {STAGES.map((stage) => {
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
                    {stage.key === 'recepcion'
                      ? items.map((card) => renderReceptionCard(card))
                      : items.map((batch) => renderBatchCard(batch))}
                    {items.length === 0 && <div className="prod-col-empty">Sin tarjetas</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {(detailBatch || detailCard) && (
        <div className="prod-sheet-overlay" onClick={() => setDetailKey(null)}>
          <div className="prod-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="prod-sheet-handle" aria-hidden="true" />
            <div className="prod-sheet-head">
              <div>
                <div className="prod-sheet-title">{(detailBatch || detailCard).product_name}</div>
                <div className="prod-sheet-sku">
                  {(detailBatch || detailCard).sku}
                  {detailCard ? ` · ${detailCard.store_location}` : ` · lote de ${detailBatch.members.length} sede${detailBatch.members.length > 1 ? 's' : ''}`}
                </div>
              </div>
              <button type="button" className="prod-sheet-close" onClick={() => setDetailKey(null)} aria-label="Cerrar">✕</button>
            </div>

            {detailBatch && (
              <>
                <div className="prod-hero">
                  <div className="prod-hero-qty">{detailBatch.total_qty}</div>
                  <div className="prod-hero-label">piezas a producir</div>
                  {detailBatch.members.length > 1 && (
                    <div className="prod-sede-chips">
                      {detailBatch.members.map((member) => (
                        <span key={member.id} className="prod-sede-chip">
                          {member.store_location} <strong>{member.required_qty}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  {detailBatch.members.length === 1 && (
                    <div className="prod-sede-chips">
                      <span className="prod-sede-chip">{detailBatch.members[0].store_location}</span>
                    </div>
                  )}
                </div>

                {detailBatch.stage === 'planificacion' && (
                  <div className="prod-planning-note">
                    Cantidad <strong>ajustable</strong>: se recalcula con el stock hasta que inicies producción.
                  </div>
                )}

                {stopwatchSince(detailBatch.oldest_move, clock) && (
                  <div className="prod-stopwatch">
                    <span className="prod-stopwatch-label">En {STAGE_LABEL[detailBatch.stage] || detailBatch.stage}</span>
                    <span className="prod-stopwatch-time">{stopwatchSince(detailBatch.oldest_move, clock)}</span>
                  </div>
                )}

                {detailBatch.stage !== 'planificacion' && (
                  <div className="prod-counter">
                    <span className="prod-counter-label">Piezas procesadas en esta etapa</span>
                    <div className="prod-counter-controls">
                      <button
                        type="button"
                        className="prod-counter-btn"
                        aria-label="Restar una pieza"
                        disabled={detailBatch.processed <= 0}
                        onClick={() => adjustProgress(detailBatch, -1)}
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
                        onClick={() => adjustProgress(detailBatch, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                <div className="prod-sheet-section-label">Mover lote a</div>
                <div className="prod-move-chips">
                  {detailBatch.route.map((step) => {
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
                    {detailBatch.stage === 'planificacion'
                      ? `Iniciar producción → ${STAGE_LABEL[nextStageOfBatch(detailBatch)]}`
                      : `Avanzar a ${STAGE_LABEL[nextStageOfBatch(detailBatch)]}`}
                  </button>
                )}

                {/* The quality stop: inspecting is what moves the batch into embalado. */}
                {nextStageOfBatch(detailBatch) === 'embalado' && (
                  <div className="prod-qc">
                    <div className="prod-sheet-section-label">Control de calidad → Embalado</div>
                    <p className="prod-qc-note">
                      Inspecciona el lote ({detailBatch.total_qty} pzas). Solo las aprobadas pasan a embalado;
                      las rechazadas se registran y la necesidad se regenera sola.
                    </p>
                    <div className="prod-qc-fields">
                      <label className="prod-qc-field">
                        <span className="prod-qc-field-label">Aprobadas</span>
                        <input
                          type="number" min="0" inputMode="numeric" className="prod-qc-input"
                          value={qcForm.passed}
                          onChange={(e) => setQcForm((prev) => ({ ...prev, passed: e.target.value }))}
                          placeholder={String(detailBatch.total_qty)}
                        />
                      </label>
                      <label className="prod-qc-field">
                        <span className="prod-qc-field-label">Rechazadas</span>
                        <input
                          type="number" min="0" inputMode="numeric" className="prod-qc-input"
                          value={qcForm.rejected}
                          onChange={(e) => setQcForm((prev) => ({ ...prev, rejected: e.target.value }))}
                          placeholder="0"
                        />
                      </label>
                    </div>
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
              </>
            )}

            {detailCard && (
              <>
                <div className="prod-hero">
                  <div className="prod-hero-qty">{Number(detailCard.required_qty || 0)}</div>
                  <div className="prod-hero-label">piezas en camino</div>
                  <div className="prod-sede-chips">
                    <span className="prod-sede-chip">→ {detailCard.store_location}</span>
                  </div>
                </div>
                {stopwatchSince(detailCard.last_moved_at || detailCard.created_at, clock) && (
                  <div className="prod-stopwatch">
                    <span className="prod-stopwatch-label">En Recepción</span>
                    <span className="prod-stopwatch-time">{stopwatchSince(detailCard.last_moved_at || detailCard.created_at, clock)}</span>
                  </div>
                )}
                <div className="prod-qc">
                  <div className="prod-sheet-section-label">Confirmar recepción en {detailCard.store_location}</div>
                  <p className="prod-qc-note">
                    Cuenta lo que llegó. Solo las piezas intactas entran al stock; las dañadas en el
                    transporte se registran y la reposición se regenera sola.
                  </p>
                  <div className="prod-qc-fields">
                    <label className="prod-qc-field">
                      <span className="prod-qc-field-label">Intactas</span>
                      <input
                        type="number" min="0" inputMode="numeric" className="prod-qc-input"
                        value={receiveForm.intact}
                        onChange={(e) => setReceiveForm((prev) => ({ ...prev, intact: e.target.value }))}
                        placeholder={String(detailCard.required_qty || 0)}
                      />
                    </label>
                    <label className="prod-qc-field">
                      <span className="prod-qc-field-label">Dañadas</span>
                      <input
                        type="number" min="0" inputMode="numeric" className="prod-qc-input"
                        value={receiveForm.damaged}
                        onChange={(e) => setReceiveForm((prev) => ({ ...prev, damaged: e.target.value }))}
                        placeholder="0"
                      />
                    </label>
                  </div>
                  {actionMsg && <div className="prod-qc-msg">{actionMsg}</div>}
                  <button
                    type="button"
                    className="btn btn-primary prod-qc-btn"
                    disabled={actionSaving}
                    onClick={() => submitReceive(detailCard)}
                  >
                    {actionSaving ? 'Guardando…' : 'Confirmar recepción'}
                  </button>
                </div>
              </>
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
