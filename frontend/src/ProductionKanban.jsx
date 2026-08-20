import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { BOARD_STAGES, COLOR_SWATCH, STAGE_LABEL, parseVariantSku, stripColorFromName } from './productionShared';
import { boliviaToday } from './campaignShared';

// El tablero de producción, por LOTES completos:
//  - Un lote (producto base: sus colores y sedes juntos) es UNA tarjeta y se
//    mueve entero de estación en estación con el botón «→ siguiente etapa».
//    Nada de gotear piezas: menos tarjetas, menos confusión.
//  - Los colores del lote se muestran (solo como referencia, con muestras)
//    recién desde Pintado: antes son el mismo fierro sin pintar.
//  - La sede (CBBA/SCZ) se muestra recién en Embalado, que es donde importa
//    separar qué va a cada almacén.
//  - «Hechas n/N» registra avance DENTRO de la estación sin mover piezas
//    (se reinicia al cambiar de etapa).
//  - Entrar a Embalado pasa por el control de calidad: un modal registra
//    aprobadas/rechazadas por color (alimenta comisiones de QC, de ahí
//    `onCommissionChanged`).
// Planificación vive en /produccion-planificacion y Recepción en /recepcion.

// "2026-06-04" → "4 jun" sin pasar por Date (evita corrimientos de zona horaria).
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const formatDeadline = (isoDate) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  return `${Number(match[3])} ${MONTH_SHORT[Number(match[2]) - 1] || ''}`;
};

// Sedes abreviadas para la cara de la tarjeta en Embalado.
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

// Agrupa tarjetas por producto base: las variantes de color son el mismo
// fierro hasta Pintado, y las sedes se separan recién al embalar — así que
// todas viajan juntas como un solo lote.
const groupCards = (cards) => {
  const groups = new Map();
  for (const card of cards) {
    if (card.stage === 'planificacion' || card.stage === 'recepcion') continue;
    const sku = String(card.sku || '').toUpperCase();
    const variant = parseVariantSku(sku);
    const key = variant ? variant.base : sku;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        members: [],
        route: Array.isArray(card.route) ? card.route : [],
        total_qty: 0,
        planned_date: null,
        display_name: '',
        is_variant_group: false
      });
    }
    const group = groups.get(key);
    group.members.push(card);
    group.total_qty += Number(card.required_qty || 0);
    if (card.planned_date && (!group.planned_date || card.planned_date < group.planned_date)) {
      group.planned_date = card.planned_date;
    }
  }
  for (const group of groups.values()) {
    const skus = new Set(group.members.map((m) => String(m.sku || '').toUpperCase()));
    group.is_variant_group = skus.size > 1;
    const firstCard = group.members[0];
    const variant = parseVariantSku(firstCard.sku);
    group.display_name = group.is_variant_group
      ? stripColorFromName(firstCard.product_name, variant?.colorLabel)
      : (firstCard.product_name || group.key);
  }
  return groups;
};

// Mezcla de colores de un conjunto de tarjetas (para mostrarla desde Pintado).
const colorMixOf = (members) => {
  const mix = new Map();
  for (const member of members) {
    const sku = String(member.sku || '').toUpperCase();
    const variant = parseVariantSku(sku);
    if (!mix.has(sku)) {
      mix.set(sku, {
        sku,
        label: variant ? variant.colorLabel : (member.product_name || sku),
        code: variant ? variant.colorCode : null,
        qty: 0,
        members: []
      });
    }
    const row = mix.get(sku);
    row.qty += Number(member.required_qty || 0);
    row.members.push(member);
  }
  return [...mix.values()].sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
};

// Un "lote" es una tarjeta visible: los miembros del grupo que están en una
// estación. Normalmente el grupo entero está en UNA estación (una tarjeta);
// si por historia quedó repartido, cada parte avanza y se van juntando.
const buildLots = (groups) => {
  const lots = [];
  for (const group of groups.values()) {
    const route = group.route;
    const paintIdx = route.indexOf('pintado');
    const byStage = new Map();
    for (const member of group.members) {
      if (!byStage.has(member.stage)) byStage.set(member.stage, []);
      byStage.get(member.stage).push(member);
    }
    for (const [stage, members] of byStage.entries()) {
      const idx = route.indexOf(stage);
      if (idx < 0) continue;
      const nextStage = idx < route.length - 1 ? route[idx + 1] : null;
      const prevCandidate = idx > 0 ? route[idx - 1] : null;
      const prevStage = prevCandidate && prevCandidate !== 'planificacion' ? prevCandidate : null;
      lots.push({
        key: `${group.key}::${stage}`,
        group,
        stage,
        members,
        qty: members.reduce((sum, m) => sum + Number(m.required_qty || 0), 0),
        processed: members.reduce((sum, m) => sum + Number(m.processed_count || 0), 0),
        pendingTasks: members.reduce((sum, m) => sum + Number(m.pending_tasks || 0), 0),
        // Colores: referencia visible recién desde Pintado.
        colors: group.is_variant_group && paintIdx >= 0 && idx >= paintIdx ? colorMixOf(members) : null,
        showSede: stage === 'embalado',
        nextStage,
        prevStage
      });
    }
  }
  return lots;
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
  // Modal de control de calidad al entrar a Embalado: filas por color.
  const [qcModal, setQcModal] = useState(null);
  const [qcBusy, setQcBusy] = useState(false);

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
  const lots = useMemo(() => buildLots(groups), [groups]);

  const lotsByStage = useMemo(() => {
    const grouped = Object.fromEntries(BOARD_STAGES.map((s) => [s.key, []]));
    for (const lot of lots) {
      if (grouped[lot.stage]) grouped[lot.stage].push(lot);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => b.qty - a.qty || a.group.display_name.localeCompare(b.group.display_name));
    }
    return grouped;
  }, [lots]);

  const totalInProduction = useMemo(
    () => lots.reduce((sum, lot) => sum + lot.qty, 0),
    [lots]
  );
  const receptionPieces = useMemo(
    () => cards.reduce((sum, card) => sum + (card.stage === 'recepcion' ? Number(card.required_qty || 0) : 0), 0),
    [cards]
  );
  const planningCount = useMemo(() => cards.filter((c) => c.stage === 'planificacion').length, [cards]);

  const colStats = useMemo(() => {
    const stats = {};
    for (const stage of BOARD_STAGES) {
      const items = lotsByStage[stage.key] || [];
      stats[stage.key] = {
        lots: items.length,
        pieces: items.reduce((sum, lot) => sum + lot.qty, 0)
      };
    }
    const maxPieces = Math.max(...Object.values(stats).map((s) => s.pieces), 0);
    const bottleneck = maxPieces > 0
      ? Object.keys(stats).find((key) => stats[key].pieces === maxPieces)
      : null;
    return { stats, bottleneck };
  }, [lotsByStage]);

  const expandedLot = expandedKey ? lots.find((lot) => lot.key === expandedKey) || null : null;

  // Tareas de medición del lote expandido (por tarjeta miembro).
  useEffect(() => {
    setChunkTasks([]);
    setTaskInputs({});
    const memberIds = expandedLot ? expandedLot.members.map((m) => m.id) : [];
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

  // batch-stage devuelve las tarjetas movidas: se funden sin recargar todo.
  const mergeServerCards = (updated) => {
    const byId = new Map(updated.map((card) => [Number(card.id), card]));
    setCards((prev) => prev.map((card) => {
      const next = byId.get(Number(card.id));
      return next
        ? { ...card, stage: next.stage, required_qty: next.required_qty, processed_count: next.processed_count }
        : card;
    }));
  };

  // Mueve el lote COMPLETO a otra estación. Entrar a Embalado no pasa por
  // aquí: eso abre el modal de calidad.
  const moveLot = async (lot, targetStage) => {
    if (busyKey || !targetStage) return;
    setBusyKey(lot.key);
    setError('');
    try {
      const res = await apiRequest('/api/production/kanban/batch-stage', {
        method: 'PATCH',
        token,
        body: { card_ids: lot.members.map((m) => m.id), stage: targetStage }
      });
      if (Array.isArray(res?.cards)) mergeServerCards(res.cards);
      if (targetStage === 'recepcion') {
        setNotice(`${lot.group.display_name}: ${lot.qty} pza${lot.qty === 1 ? '' : 's'} → Recepción ✓`);
      }
      setExpandedKey(null);
    } catch (err) {
      setError(err.message || 'No se pudo mover el lote');
      loadBoard();
    } finally {
      setBusyKey('');
    }
  };

  // «Hechas n/N»: avance dentro de la estación, sin mover piezas.
  const tickProgress = async (lot, delta) => {
    if (busyKey) return;
    setBusyKey(`${lot.key}::progress`);
    try {
      const res = await apiRequest('/api/production/kanban/batch-progress', {
        method: 'PATCH',
        token,
        body: { card_ids: lot.members.map((m) => m.id), delta }
      });
      // El backend reparte el total llenando por id: replicar para no recargar.
      const target = Number(res?.processed || 0);
      const ordered = [...lot.members].sort((a, b) => Number(a.id) - Number(b.id));
      let remaining = target;
      const shares = new Map();
      for (const member of ordered) {
        const share = Math.min(remaining, Number(member.required_qty || 0));
        shares.set(Number(member.id), share);
        remaining -= share;
      }
      setCards((prev) => prev.map((card) => (
        shares.has(Number(card.id)) ? { ...card, processed_count: shares.get(Number(card.id)) } : card
      )));
    } catch (err) {
      setError(err.message || 'No se pudo registrar el avance');
    } finally {
      setBusyKey('');
    }
  };

  // ── Control de calidad: la puerta de entrada a Embalado ──
  const openQcModal = (lot) => {
    const rows = (lot.colors || colorMixOf(lot.members)).map((color) => ({
      sku: color.sku,
      label: color.label,
      code: color.code,
      qty: color.qty,
      members: color.members,
      rejected: 0
    }));
    setQcModal({ lot, rows });
  };

  const setQcRejected = (index, value) => {
    setQcModal((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((row, i) => {
        if (i !== index) return row;
        const rejected = Math.max(0, Math.min(row.qty, Number.parseInt(value, 10) || 0));
        return { ...row, rejected };
      });
      return { ...prev, rows };
    });
  };

  const submitQc = async () => {
    if (!qcModal || qcBusy) return;
    setQcBusy(true);
    setError('');
    try {
      // Una llamada por color: calidad se registra por producto (SKU).
      for (const row of qcModal.rows) {
        if (row.qty <= 0) continue;
        await apiRequest('/api/production/kanban/qc-gate', {
          method: 'POST',
          token,
          body: {
            card_ids: row.members.map((m) => m.id),
            passed: row.qty - row.rejected,
            rejected: row.rejected
          }
        });
      }
      const totalRejected = qcModal.rows.reduce((sum, row) => sum + row.rejected, 0);
      setNotice(totalRejected > 0
        ? `${qcModal.lot.group.display_name}: calidad registrada (${totalRejected} rechazada${totalRejected === 1 ? '' : 's'}) → Embalado`
        : `${qcModal.lot.group.display_name}: lote aprobado → Embalado ✓`);
      setQcModal(null);
      if (typeof onCommissionChanged === 'function') onCommissionChanged();
      await loadBoard();
    } catch (err) {
      setError(err.message || 'No se pudo registrar el control de calidad');
      setQcModal(null);
      loadBoard();
    } finally {
      setQcBusy(false);
    }
  };

  const advanceLot = (lot) => {
    if (!lot.nextStage) return;
    if (lot.nextStage === 'embalado') {
      openQcModal(lot);
      return;
    }
    moveLot(lot, lot.nextStage);
  };

  const renderLotCard = (lot) => {
    const { group } = lot;
    const deadline = formatDeadline(group.planned_date);
    const overdue = Boolean(group.planned_date) && String(group.planned_date).slice(0, 10) < boliviaToday();
    const isExpanded = expandedKey === lot.key;
    const toggle = () => setExpandedKey(isExpanded ? null : lot.key);
    const splitLot = lot.qty !== group.total_qty;
    const sedeRows = lot.showSede
      ? [...lot.members.reduce((acc, member) => {
          const sede = shortSede(member.store_location);
          acc.set(sede, (acc.get(sede) || 0) + Number(member.required_qty || 0));
          return acc;
        }, new Map()).entries()].filter(([, qty]) => qty > 0)
      : [];
    return (
      <div
        key={lot.key}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={`prod-card ${isExpanded ? 'is-expanded' : ''} ${busyKey === lot.key ? 'is-busy' : ''}`}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <div className="prod-card-top">
          <span className="prod-card-name">{group.display_name}</span>
          {deadline && (
            <span className={`prod-card-deadline ${overdue ? 'is-overdue' : ''}`} title="Fecha planificada">
              📅 {deadline}
            </span>
          )}
        </div>

        <span className="prod-card-sede">
          {lot.qty} pza{lot.qty === 1 ? '' : 's'}
          {splitLot ? ` · lote de ${group.total_qty}` : ''}
          {lot.processed > 0 && (
            <span className={`prod-lot-done ${lot.processed >= lot.qty ? 'is-complete' : ''}`} title="Hechas en esta estación">
              {' '}· ✓ {lot.processed}/{lot.qty}
            </span>
          )}
        </span>

        {lot.colors && (
          <div className="prod-lot-colors" title="Colores del lote">
            {lot.colors.map((color) => (
              <span key={color.sku} className="prod-lot-color">
                <ColorSwatch code={color.code} label={color.label} />
                {color.qty}
              </span>
            ))}
          </div>
        )}

        {lot.showSede && sedeRows.length > 0 && (
          <div className="prod-lot-sedes" title="Destino por sede">
            {sedeRows.map(([sede, qty]) => `${sede} ${qty}`).join(' · ')}
          </div>
        )}

        <div className="prod-card-foot">
          <span className="prod-card-meta">
            {lot.nextStage && (
              <span className="prod-card-nexthint">→ {STAGE_LABEL[lot.nextStage]}</span>
            )}
            {lot.pendingTasks > 0 && (
              <span className="prod-card-task-badge" title="Tareas de medición pendientes">
                {lot.pendingTasks} tarea{lot.pendingTasks > 1 ? 's' : ''}
              </span>
            )}
            <span className="prod-card-chevron" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
          </span>
        </div>

        {isExpanded && (
          <div className="prod-card-extra" onClick={(e) => e.stopPropagation()}>
            <div className="prod-lot-tick">
              <span className="prod-lot-tick-label">Hechas en esta estación</span>
              <div className="prod-card-counter">
                <button
                  type="button"
                  aria-label="Restar una pieza hecha"
                  disabled={Boolean(busyKey) || lot.processed <= 0}
                  onClick={() => tickProgress(lot, -1)}
                >
                  −
                </button>
                <span className="prod-chunk-qty">{lot.processed}/{lot.qty}</span>
                <button
                  type="button"
                  className="is-plus"
                  aria-label="Marcar una pieza hecha"
                  disabled={Boolean(busyKey) || lot.processed >= lot.qty}
                  onClick={() => tickProgress(lot, 1)}
                >
                  +
                </button>
              </div>
            </div>
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
            {lot.nextStage && (
              <button
                type="button"
                className="btn btn-primary prod-advance-btn"
                disabled={Boolean(busyKey)}
                onClick={() => advanceLot(lot)}
              >
                {lot.nextStage === 'embalado'
                  ? `Calidad → ${STAGE_LABEL[lot.nextStage]}`
                  : `Avanzar lote → ${STAGE_LABEL[lot.nextStage]}`}
              </button>
            )}
            {lot.prevStage && (
              <button
                type="button"
                className="btn btn-secondary prod-return-btn"
                disabled={Boolean(busyKey)}
                onClick={() => moveLot(lot, lot.prevStage)}
              >
                ↩ Devolver lote a {STAGE_LABEL[lot.prevStage]}
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
        <div className="prod-kpi"><span className="prod-kpi-label">Lotes en planta</span><span className="prod-kpi-value" style={{ color: '#0284c7' }}>{lots.length}</span></div>
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
              const count = lotsByStage[stage.key]?.length || 0;
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
              const items = lotsByStage[stage.key] || [];
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
                    {items.map((lot) => renderLotCard(lot))}
                    {items.length === 0 && <div className="prod-col-empty">Sin lotes</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {qcModal && (
        <div className="prod-qc-overlay" role="dialog" aria-modal="true" onClick={() => { if (!qcBusy) setQcModal(null); }}>
          <div className="prod-qc-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="prod-qc-title">🔍 Control de calidad — {qcModal.lot.group.display_name}</h3>
            <p className="prod-qc-sub">
              Revisa el lote antes de embalarlo. Lo aprobado pasa a Embalado; lo
              rechazado cierra su parte y Planificación regenera la necesidad.
            </p>
            <div className="prod-qc-rows">
              {qcModal.rows.map((row, index) => (
                <div key={row.sku} className="prod-qc-row">
                  <span className="prod-qc-row-name">
                    {row.code && <ColorSwatch code={row.code} label={row.label} />}
                    {row.label || row.sku}
                  </span>
                  <span className="prod-qc-row-qty">{row.qty} pzas</span>
                  <label className="prod-qc-row-field">
                    Rechazadas
                    <input
                      type="number"
                      min="0"
                      max={row.qty}
                      value={row.rejected}
                      onChange={(e) => setQcRejected(index, e.target.value)}
                    />
                  </label>
                  <span className="prod-qc-row-pass">✓ {row.qty - row.rejected} aprobadas</span>
                </div>
              ))}
            </div>
            <div className="prod-qc-actions">
              <button type="button" className="btn btn-secondary" disabled={qcBusy} onClick={() => setQcModal(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={qcBusy} onClick={submitQc}>
                {qcBusy ? 'Registrando…' : 'Registrar calidad y embalar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
