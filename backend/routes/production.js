const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { getProductionKanbanAccessScope, resolveInventoryScopeByCity } = require('../lib/inventory');
const { PRODUCTION_KANBAN_STAGES, cardsShareVariantGroup, getRouteStagesForSku, mapProductionKanbanCardRow, normalizeProductionKanbanStage, normalizeProductionStartProcess, replaceProductProcessSteps, syncProductionKanbanFromInventory } = require('../lib/kanban');
const { validateProductSku } = require('../lib/products');
const { getProductStructure, loadProductionSettings, saveProductStructure, saveProductionSettings } = require('../lib/productStructure');
const { countPendingTasksByCard, getVarianceReport, listCardTasks, maybeCreateSamplingTasks, resolveTask } = require('../lib/productionSampling');
const { ensureQcProductSettingsSeeded } = require('../lib/qc');
const { sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// Planning cards whose tentative date arrived (America/La_Paz) enter the
// board automatically: quantity freezes and the lote moves to its first route
// stage. Grouped by SKU so mother cards activate complete.
const activateDueProductionCards = async (userId) => {
  const dueRes = await pool.query(
    `SELECT id, sku, product_name, store_location, required_qty, processed_count, qty_frozen, stage, start_process
     FROM production_kanban_cards
     WHERE is_active = TRUE
       AND source = 'min_stock'
       AND stage = 'planificacion'
       AND planned_date IS NOT NULL
       AND planned_date <= (NOW() AT TIME ZONE 'America/La_Paz')::date`
  );
  if (dueRes.rowCount === 0) return false;
  const bySku = new Map();
  for (const card of dueRes.rows) {
    const sku = String(card.sku || '').toUpperCase();
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(card);
  }
  for (const [sku, cards] of bySku) {
    const route = await getRouteStagesForSku(sku, cards[0].start_process || 'corte_laser');
    const nextStage = route[route.indexOf('planificacion') + 1] || route[1];
    if (!nextStage || nextStage === 'planificacion') continue;
    await moveCardsToStage({ cards, nextStage, userId });
  }
  return true;
};

router.get('/api/production/kanban', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const kanbanScope = getProductionKanbanAccessScope(userContext, access);
    if (kanbanScope.error) return res.status(403).json({ error: kanbanScope.error });

    let cards = await syncProductionKanbanFromInventory();
    if (await activateDueProductionCards(req.user.id)) {
      cards = await syncProductionKanbanFromInventory();
    }
    const pendingTasks = await countPendingTasksByCard(cards.map((card) => card.id));
    for (const card of cards) {
      card.pending_tasks = pendingTasks.get(card.id) || 0;
    }
    await attachStageDistributions(cards);
    const totalRequired = cards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0);
    const byStage = Object.fromEntries(PRODUCTION_KANBAN_STAGES.map((stage) => [stage, 0]));
    for (const card of cards) {
      byStage[card.stage] = (byStage[card.stage] || 0) + 1;
    }

    res.json({
      stages: PRODUCTION_KANBAN_STAGES,
      cards,
      summary: {
        cards_count: cards.length,
        total_required_qty: totalRequired,
        by_stage: byStage
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar kanban de producción' });
  }
});

const ensureKanbanAccess = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const kanbanScope = getProductionKanbanAccessScope(userContext, access);
  if (kanbanScope.error) {
    res.status(403).json({ error: kanbanScope.error });
    return null;
  }
  return userContext;
};

const loadActiveCards = async (cardIds) => {
  const ids = [...new Set((Array.isArray(cardIds) ? cardIds : [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  const result = await pool.query(
    `SELECT id, sku, product_name, store_location, required_qty, processed_count, qty_frozen, stage, start_process
     FROM production_kanban_cards
     WHERE id = ANY($1::bigint[])
       AND is_active = TRUE
       AND source = 'min_stock'`,
    [ids]
  );
  return result.rows;
};

// Adjunta a cada tarjeta su distribución de piezas por etapa (stage_qty).
// Tarjetas en fabricación que aún no tienen filas (activadas antes de esta
// función) se siembran con todas sus piezas en la etapa actual.
const attachStageDistributions = async (cards) => {
  for (const card of cards) card.stage_qty = {};
  const eligible = cards.filter((card) => card.stage && card.stage !== 'planificacion');
  if (eligible.length === 0) return;
  const res = await pool.query(
    `SELECT card_id, stage, qty
     FROM production_kanban_stage_qty
     WHERE card_id = ANY($1::int[])`,
    [eligible.map((card) => card.id)]
  );
  const byCard = new Map();
  for (const row of res.rows) {
    const cardId = Number(row.card_id);
    if (!byCard.has(cardId)) byCard.set(cardId, {});
    if (Number(row.qty) > 0) byCard.get(cardId)[row.stage] = Number(row.qty);
  }
  for (const card of eligible) {
    let dist = byCard.get(Number(card.id)) || {};
    const total = Object.values(dist).reduce((sum, qty) => sum + qty, 0);
    if (total === 0 && Number(card.required_qty || 0) > 0) {
      await pool.query(
        `INSERT INTO production_kanban_stage_qty (card_id, stage, qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (card_id, stage) DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
        [card.id, card.stage, Number(card.required_qty || 0)]
      );
      dist = { [card.stage]: Number(card.required_qty || 0) };
    }
    card.stage_qty = dist;
  }
};

// Moves one or many cards (the board's "mother card" = all sede cards of one
// SKU in the same stage) in a single transaction. Leaving Planificación
// freezes the quantity: from then on it is a fixed production order.
const moveCardsToStage = async ({ cards, nextStage, userId }) => {
  const client = await pool.connect();
  const movedCards = [];
  try {
    await client.query('BEGIN');
    for (const card of cards) {
      const leavingPlanning = card.stage === 'planificacion' && nextStage !== 'planificacion';
      const updatedRes = await client.query(
        `UPDATE production_kanban_cards
         SET stage = $2,
             qty_frozen = CASE WHEN $3 THEN TRUE ELSE qty_frozen END,
             processed_count = CASE WHEN stage IS DISTINCT FROM $2 THEN 0 ELSE processed_count END,
             last_moved_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, sku, product_name, store_location, current_stock, min_stock, required_qty,
                   processed_count, qty_frozen, start_process, stage, source, last_moved_at, created_at, updated_at`,
        [card.id, nextStage, leavingPlanning]
      );
      movedCards.push(updatedRes.rows[0]);
      // Movimiento de lote completo: la distribución pieza-a-etapa se
      // reinicia con todas las piezas en la nueva etapa (o vacía si vuelve a
      // planificación, donde la cantidad sigue fluida).
      await client.query('DELETE FROM production_kanban_stage_qty WHERE card_id = $1', [card.id]);
      if (nextStage !== 'planificacion') {
        await client.query(
          `INSERT INTO production_kanban_stage_qty (card_id, stage, qty)
           VALUES ($1, $2, $3)
           ON CONFLICT (card_id, stage) DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
          [card.id, nextStage, Number(card.required_qty || 0)]
        );
      }
      if (card.stage !== nextStage) {
        // Movement log: durations per stage feed cost/throughput baselines.
        await client.query(
          `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [card.id, String(card.sku || '').toUpperCase(), card.store_location, card.stage || null, nextStage, Number(card.required_qty || 0), userId]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // Random measurement task, once per batch move (the batch is physically one
  // production run) — evaluated on the largest member.
  const biggest = [...cards].sort((a, b) => Number(b.required_qty || 0) - Number(a.required_qty || 0))[0];
  if (biggest && biggest.stage !== nextStage) {
    await maybeCreateSamplingTasks({
      cardId: biggest.id,
      sku: biggest.sku,
      storeLocation: biggest.store_location,
      process: nextStage,
      batchQty: cards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0)
    });
  }
  return movedCards;
};

const validateStageMove = async ({ cards, nextStage }) => {
  if (cards.length === 0) return 'Tarjetas no encontradas o inactivas';
  if (!cardsShareVariantGroup(cards)) return 'Todas las tarjetas del lote deben ser del mismo producto o variantes de color del mismo';
  const first = cards[0];
  const allowedStages = await getRouteStagesForSku(first.sku, first.start_process || 'corte_laser');
  if (!allowedStages.includes(nextStage)) {
    return `La etapa ${nextStage} no aplica para este producto (${first.start_process || 'corte_laser'})`;
  }
  // The quality stop: entering Embalado only happens through the QC gate.
  if (nextStage === 'embalado' && cards.some((card) => card.stage !== 'embalado')) {
    return 'QC_GATE_REQUIRED';
  }
  return null;
};

router.patch('/api/production/kanban/cards/:id/stage', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const nextStage = normalizeProductionKanbanStage(req.body?.stage || '');
    if (!nextStage) return res.status(400).json({ error: 'Etapa inválida' });
    const cards = await loadActiveCards([req.params.id]);
    const problem = await validateStageMove({ cards, nextStage });
    if (problem === 'QC_GATE_REQUIRED') {
      return res.status(409).json({ error: 'Para pasar a embalado registra primero el control de calidad', code: 'qc_gate_required' });
    }
    if (problem) return res.status(cards.length === 0 ? 404 : 400).json({ error: problem });
    const moved = await moveCardsToStage({ cards, nextStage, userId: req.user.id });
    res.json({ message: 'Etapa actualizada', card: mapProductionKanbanCardRow(moved[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar etapa de la tarjeta' });
  }
});

// Mother-card move: all sede cards of the same SKU travel together.
router.patch('/api/production/kanban/batch-stage', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const nextStage = normalizeProductionKanbanStage(req.body?.stage || '');
    if (!nextStage) return res.status(400).json({ error: 'Etapa inválida' });
    const cards = await loadActiveCards(req.body?.card_ids);
    const problem = await validateStageMove({ cards, nextStage });
    if (problem === 'QC_GATE_REQUIRED') {
      return res.status(409).json({ error: 'Para pasar a embalado registra primero el control de calidad', code: 'qc_gate_required' });
    }
    if (problem) return res.status(cards.length === 0 ? 404 : 400).json({ error: problem });
    const moved = await moveCardsToStage({ cards, nextStage, userId: req.user.id });
    res.json({ message: 'Etapa actualizada', cards: moved.map((row) => mapProductionKanbanCardRow(row)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo mover el lote' });
  }
});

// Tentative production date, set from the Planificación page. NULL = the
// lote keeps accumulating indefinitely; a date = it enters the board (and
// freezes) the day the date arrives in America/La_Paz.
router.patch('/api/production/kanban/batch-planned-date', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const raw = req.body?.planned_date;
    let plannedDate = null;
    if (raw !== null && raw !== undefined && raw !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        return res.status(400).json({ error: 'Fecha inválida. Usa formato AAAA-MM-DD' });
      }
      plannedDate = String(raw);
    }
    const cards = await loadActiveCards(req.body?.card_ids);
    if (cards.length === 0) return res.status(404).json({ error: 'Tarjetas no encontradas o inactivas' });
    if (!cardsShareVariantGroup(cards)) return res.status(400).json({ error: 'La fecha se asigna por lote de un solo producto o sus variantes de color' });
    if (cards.some((card) => card.stage !== 'planificacion')) {
      return res.status(400).json({ error: 'Solo se programan lotes que siguen en planificación' });
    }
    await pool.query(
      `UPDATE production_kanban_cards
       SET planned_date = $2, updated_at = NOW()
       WHERE id = ANY($1::bigint[])`,
      [cards.map((card) => card.id), plannedDate]
    );
    res.json({ message: plannedDate ? 'Fecha de producción asignada' : 'Fecha de producción quitada', planned_date: plannedDate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo asignar la fecha de producción' });
  }
});

// Batch progress counter: the operator ticks pieces as they finish them in
// the current stage. The total lives distributed across the sede cards (each
// capped at its own qty, filled in id order) so a batch split keeps sane
// numbers. Clamped to [0, lote total]; stage moves reset it to 0.
router.patch('/api/production/kanban/batch-progress', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const delta = Number.parseInt(req.body?.delta, 10);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000) {
      return res.status(400).json({ error: 'Ajuste inválido' });
    }
    const cards = await loadActiveCards(req.body?.card_ids);
    if (cards.length === 0) return res.status(404).json({ error: 'Tarjetas no encontradas o inactivas' });
    if (!cardsShareVariantGroup(cards)) return res.status(400).json({ error: 'El avance se registra por lote de un solo producto o sus variantes de color' });
    if (cards.some((card) => card.stage === 'planificacion')) {
      return res.status(400).json({ error: 'El avance se registra cuando el lote ya está en producción' });
    }
    const totalQty = cards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0);
    const current = cards.reduce((sum, card) => sum + Number(card.processed_count || 0), 0);
    const target = Math.min(totalQty, Math.max(0, current + delta));
    const ordered = [...cards].sort((a, b) => Number(a.id) - Number(b.id));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let remaining = target;
      for (const card of ordered) {
        const share = Math.min(remaining, Number(card.required_qty || 0));
        remaining -= share;
        await client.query(
          `UPDATE production_kanban_cards
           SET processed_count = $2, updated_at = NOW()
           WHERE id = $1`,
          [card.id, share]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ processed: target, total: totalQty });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el avance del lote' });
  }
});

const parseCount = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

// Largest-remainder split: distribute `amount` across cards proportionally to
// their required_qty, never exceeding each card's own quantity.
const distributeAcrossCards = (cards, amount) => {
  const total = cards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0);
  if (total <= 0) return cards.map(() => 0);
  const exact = cards.map((card) => (amount * Number(card.required_qty || 0)) / total);
  const shares = exact.map((value, i) => Math.min(Math.floor(value), Number(cards[i].required_qty || 0)));
  let remainder = amount - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (shares[i] < Number(cards[i].required_qty || 0)) {
      shares[i] += 1;
      remainder -= 1;
    }
  }
  return shares;
};

// The quality stop: inspecting the batch is what lets it into Embalado.
// Records aprobadas/rechazadas in quality_control_records (production
// commissions keep reading the same table), sets each sede card's quantity to
// its approved share and moves the batch to embalado. Fully-rejected shares
// close their card — the next inventory sync regenerates the need.
// Stock is NOT touched here: it enters at Recepción.
router.post('/api/production/kanban/qc-gate', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const passed = parseCount(req.body?.passed);
    const rejected = parseCount(req.body?.rejected);
    if (Number.isNaN(passed) || Number.isNaN(rejected)) {
      return res.status(400).json({ error: 'Cantidades inválidas. Usa enteros mayores o iguales a 0' });
    }
    if (passed <= 0 && rejected <= 0) {
      return res.status(400).json({ error: 'Registra al menos una pieza aprobada o rechazada' });
    }
    const cards = await loadActiveCards(req.body?.card_ids);
    if (cards.length === 0) return res.status(404).json({ error: 'Tarjetas no encontradas o inactivas' });
    const skus = new Set(cards.map((card) => String(card.sku || '').toUpperCase()));
    if (skus.size > 1) return res.status(400).json({ error: 'El control de calidad se registra por producto' });
    if (cards.some((card) => ['planificacion', 'embalado', 'recepcion'].includes(card.stage))) {
      return res.status(400).json({ error: 'El lote debe estar en una etapa de fabricación para pasar por calidad' });
    }
    const totalQty = cards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0);
    if (passed > totalQty) {
      return res.status(400).json({ error: `Aprobadas (${passed}) no puede superar las piezas del lote (${totalQty})` });
    }

    const sku = String(cards[0].sku || '').toUpperCase();
    const productName = String(cards[0].product_name || sku).trim() || sku;
    await ensureQcProductSettingsSeeded();

    const shares = distributeAcrossCards(cards, passed);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserts = [];
      if (passed > 0) inserts.push(['passed', passed]);
      if (rejected > 0) inserts.push(['rejected', rejected]);
      for (const [result, quantity] of inserts) {
        await client.query(
          `INSERT INTO quality_control_records (user_id, sku, product_name, quantity, result)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.user.id, sku, productName, quantity, result]
        );
      }
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const share = shares[i];
        if (share > 0) {
          await client.query(
            `UPDATE production_kanban_cards
             SET required_qty = $2, stage = 'embalado', processed_count = 0, last_moved_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [card.id, share]
          );
          // La distribución pieza-a-etapa se reinicia: todo lo aprobado queda en embalado.
          await client.query('DELETE FROM production_kanban_stage_qty WHERE card_id = $1', [card.id]);
          await client.query(
            `INSERT INTO production_kanban_stage_qty (card_id, stage, qty) VALUES ($1, 'embalado', $2)`,
            [card.id, share]
          );
          await client.query(
            `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
             VALUES ($1, $2, $3, $4, 'embalado', $5, $6)`,
            [card.id, sku, card.store_location, card.stage || null, share, req.user.id]
          );
        } else {
          // This sede's whole share was rejected: nothing to pack. The card
          // closes and the next sync re-opens the need in Planificación.
          await client.query(
            `UPDATE production_kanban_cards
             SET is_active = FALSE, qty_frozen = FALSE, updated_at = NOW()
             WHERE id = $1`,
            [card.id]
          );
          await client.query('DELETE FROM production_kanban_stage_qty WHERE card_id = $1', [card.id]);
          await client.query(
            `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
             VALUES ($1, $2, $3, $4, 'rechazado', $5, $6)`,
            [card.id, sku, card.store_location, card.stage || null, Number(card.required_qty || 0), req.user.id]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: passed > 0 ? 'Calidad registrada: el lote pasa a embalado' : 'Calidad registrada: lote rechazado por completo',
      sku,
      product_name: productName,
      passed,
      rejected,
      shares: cards.map((card, i) => ({ card_id: card.id, store_location: card.store_location, approved_qty: shares[i] }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el control de calidad' });
  }
});

// Empuje pieza a pieza: mueve `qty` piezas de la estación `from_stage` a la
// siguiente de la ruta (o de vuelta a la anterior con direction: 'back').
// Baja la cantidad en la estación de origen y la sube en la de destino; el
// resto del lote no se mueve. La tarjeta conserva como etapa "oficial" su
// borde trasero (la etapa más temprana con piezas), así Recepción recibe la
// tarjeta cuando TODAS las piezas llegaron. La entrada a Embalado sigue
// siendo la puerta de calidad: cada pieza empujada queda registrada como
// aprobada (contarla ES aprobarla, igual que el flujo anterior).
router.post('/api/production/kanban/push', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const qty = Number.parseInt(req.body?.qty ?? 1, 10);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 10000) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    const direction = req.body?.direction === 'back' ? 'back' : 'forward';
    const fromStage = normalizeProductionKanbanStage(req.body?.from_stage || '');
    if (!fromStage || fromStage === 'planificacion') {
      return res.status(400).json({ error: 'Etapa de origen inválida' });
    }
    const cards = await loadActiveCards(req.body?.card_ids);
    if (cards.length === 0) return res.status(404).json({ error: 'Tarjetas no encontradas o inactivas' });
    if (!cardsShareVariantGroup(cards)) {
      return res.status(400).json({ error: 'El empuje se registra por lote de un solo producto' });
    }
    if (cards.some((card) => card.stage === 'planificacion')) {
      return res.status(400).json({ error: 'El lote debe estar en producción para mover piezas' });
    }
    const first = cards[0];
    const route = await getRouteStagesForSku(first.sku, first.start_process || 'corte_laser');
    const fromIdx = route.indexOf(fromStage);
    if (fromIdx < 0) {
      return res.status(400).json({ error: `La etapa ${fromStage} no aplica para este producto` });
    }
    const targetStage = direction === 'forward' ? route[fromIdx + 1] : route[fromIdx - 1];
    if (!targetStage || targetStage === 'planificacion') {
      return res.status(400).json({ error: direction === 'forward' ? 'No hay etapa siguiente en la ruta' : 'No hay etapa anterior en la ruta' });
    }
    const sku = String(first.sku || '').toUpperCase();
    const productName = String(first.product_name || sku).trim() || sku;
    if (direction === 'forward' && targetStage === 'embalado') await ensureQcProductSettingsSeeded();

    const client = await pool.connect();
    let result;
    let firstArrival = false;
    try {
      await client.query('BEGIN');
      const distRes = await client.query(
        `SELECT card_id, stage, qty
         FROM production_kanban_stage_qty
         WHERE card_id = ANY($1::int[])
         FOR UPDATE`,
        [cards.map((card) => card.id)]
      );
      const distByCard = new Map(cards.map((card) => [Number(card.id), new Map()]));
      for (const row of distRes.rows) {
        distByCard.get(Number(row.card_id))?.set(row.stage, Number(row.qty));
      }
      // Tarjetas sin distribución todavía: todas sus piezas en su etapa actual.
      for (const card of cards) {
        const dist = distByCard.get(Number(card.id));
        const total = [...dist.values()].reduce((sum, value) => sum + value, 0);
        if (total === 0 && Number(card.required_qty || 0) > 0) {
          dist.set(card.stage, Number(card.required_qty || 0));
          await client.query(
            `INSERT INTO production_kanban_stage_qty (card_id, stage, qty)
             VALUES ($1, $2, $3)
             ON CONFLICT (card_id, stage) DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
            [card.id, card.stage, Number(card.required_qty || 0)]
          );
        }
      }
      const availability = cards.map((card) => ({
        card,
        available: distByCard.get(Number(card.id)).get(fromStage) || 0
      }));
      const totalAvailable = availability.reduce((sum, entry) => sum + entry.available, 0);
      if (totalAvailable < qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Solo hay ${totalAvailable} pieza(s) en esta estación` });
      }
      // Reparto en orden de id, igual que el contador de avance anterior.
      let remaining = qty;
      const moves = [];
      for (const entry of [...availability].sort((a, b) => Number(a.card.id) - Number(b.card.id))) {
        if (remaining <= 0) break;
        const share = Math.min(remaining, entry.available);
        if (share <= 0) continue;
        remaining -= share;
        moves.push({ card: entry.card, share });
      }
      const updatedCards = [];
      for (const { card, share } of moves) {
        const dist = distByCard.get(Number(card.id));
        if ((dist.get(targetStage) || 0) === 0) firstArrival = true;
        dist.set(fromStage, (dist.get(fromStage) || 0) - share);
        dist.set(targetStage, (dist.get(targetStage) || 0) + share);
        await client.query(
          `UPDATE production_kanban_stage_qty SET qty = $3, updated_at = NOW()
           WHERE card_id = $1 AND stage = $2`,
          [card.id, fromStage, dist.get(fromStage)]
        );
        await client.query(
          `INSERT INTO production_kanban_stage_qty (card_id, stage, qty)
           VALUES ($1, $2, $3)
           ON CONFLICT (card_id, stage) DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
          [card.id, targetStage, dist.get(targetStage)]
        );
        const trailing = route.find((stage) => stage !== 'planificacion' && (dist.get(stage) || 0) > 0) || targetStage;
        const updatedRes = await client.query(
          `UPDATE production_kanban_cards
           SET stage = $2, last_moved_at = NOW(), updated_at = NOW()
           WHERE id = $1
           RETURNING id, sku, product_name, store_location, current_stock, min_stock, required_qty,
                     processed_count, qty_frozen, start_process, stage, source, planned_date, last_moved_at, created_at, updated_at`,
          [card.id, trailing]
        );
        updatedCards.push(updatedRes.rows[0]);
        await client.query(
          `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [card.id, sku, card.store_location, fromStage, targetStage, share, req.user.id]
        );
      }
      if (direction === 'forward' && targetStage === 'embalado') {
        await client.query(
          `INSERT INTO quality_control_records (user_id, sku, product_name, quantity, result)
           VALUES ($1, $2, $3, $4, 'passed')`,
          [req.user.id, sku, productName, qty]
        );
      }
      await client.query('COMMIT');
      const mapped = updatedCards.map((row) => mapProductionKanbanCardRow(row));
      await attachStageDistributions(mapped);
      result = { moved: qty, from_stage: fromStage, to_stage: targetStage, cards: mapped };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    // La primera pieza que llega a una estación puede disparar una tarea de
    // medición de materiales, igual que el movimiento de lote completo.
    if (direction === 'forward' && firstArrival && result) {
      const biggest = [...cards].sort((a, b) => Number(b.required_qty || 0) - Number(a.required_qty || 0))[0];
      await maybeCreateSamplingTasks({
        cardId: biggest.id,
        sku: biggest.sku,
        storeLocation: biggest.store_location,
        process: targetStage,
        batchQty: cards.reduce((sum, card) => sum + Number(card.required_qty || 0), 0)
      }).catch(() => {});
    }
    res.json({ message: 'Piezas movidas', ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron mover las piezas' });
  }
});

// Warehouse reception: the end of the card's life. Only pieces confirmed
// intact enter the sede's stock; transit damage is logged, and the next
// inventory sync regenerates any remaining need automatically.
router.post('/api/production/kanban/cards/:id/receive', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    if (!(await ensureKanbanAccess(req, res))) return;
    const intact = parseCount(req.body?.intact);
    const damaged = parseCount(req.body?.damaged);
    if (Number.isNaN(intact) || Number.isNaN(damaged)) {
      return res.status(400).json({ error: 'Cantidades inválidas. Usa enteros mayores o iguales a 0' });
    }
    if (intact <= 0 && damaged <= 0) {
      return res.status(400).json({ error: 'Registra al menos una pieza recibida o dañada' });
    }
    const cards = await loadActiveCards([req.params.id]);
    if (cards.length === 0) return res.status(404).json({ error: 'Tarjeta no encontrada o inactiva' });
    const card = cards[0];
    if (card.stage !== 'recepcion') {
      return res.status(400).json({ error: 'La tarjeta debe estar en Recepción para confirmar la llegada' });
    }
    const sku = String(card.sku || '').toUpperCase();
    const stockScope = resolveInventoryScopeByCity(card.store_location);
    let newStock = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (intact > 0 && stockScope) {
        const stockRes = await client.query(
          `UPDATE products
           SET ${stockScope.stockField} = ${stockScope.stockField} + $2,
               last_updated = NOW()
           WHERE UPPER(sku) = $1
           RETURNING ${stockScope.stockField} AS new_stock`,
          [sku, intact]
        );
        newStock = stockRes.rows[0] ? Number(stockRes.rows[0].new_stock) : null;
      }
      await client.query(
        `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
         VALUES ($1, $2, $3, 'recepcion', 'recibido', $4, $5)`,
        [card.id, sku, card.store_location, intact, req.user.id]
      );
      if (damaged > 0) {
        await client.query(
          `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
           VALUES ($1, $2, $3, 'recepcion', 'danado_transito', $4, $5)`,
          [card.id, sku, card.store_location, damaged, req.user.id]
        );
      }
      await client.query(
        `UPDATE production_kanban_cards
         SET is_active = FALSE, qty_frozen = FALSE, updated_at = NOW()
         WHERE id = $1`,
        [card.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: 'Recepción confirmada',
      sku,
      store_location: card.store_location,
      intact,
      damaged,
      stock_added: intact > 0 && stockScope ? intact : 0,
      new_stock: newStock
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo confirmar la recepción' });
  }
});

router.patch('/api/production/kanban/routes/:sku', authenticateToken, requireRole(['Produccion', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const kanbanScope = getProductionKanbanAccessScope(userContext, access);
    if (kanbanScope.error) return res.status(403).json({ error: kanbanScope.error });

    const sku = validateProductSku(req.params.sku);
    const startProcess = normalizeProductionStartProcess(req.body?.start_process || '');
    if (!startProcess) {
      return res.status(400).json({ error: 'Proceso inicial inválido. Usa corte_laser, impresion_3d o punzonado' });
    }
    const existsRes = await pool.query(
      `SELECT sku
       FROM products
       WHERE UPPER(sku) = $1
         AND is_active = TRUE`,
      [sku]
    );
    if (existsRes.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado o inactivo' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO production_process_routes (sku, start_process, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (sku) DO UPDATE
         SET start_process = EXCLUDED.start_process,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [sku, startProcess, req.user.id]
      );
      // The steps table is the route source of truth; regenerate it for the
      // new start so the board and validations pick it up immediately.
      await replaceProductProcessSteps(client, sku, startProcess);
      await client.query(
        `UPDATE production_kanban_cards
         SET start_process = $2,
             stage = CASE
               WHEN stage IN ('corte_laser', 'impresion_3d', 'punzonado') THEN $2
               ELSE stage
             END,
             updated_at = NOW()
         WHERE UPPER(sku) = $1
           AND source = 'min_stock'`,
        [sku, startProcess]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    const cards = await syncProductionKanbanFromInventory();
    const affectedCards = cards.filter((card) => card.sku === sku);
    res.json({
      message: 'Proceso inicial actualizado',
      route: { sku, start_process: startProcess },
      cards: affectedCards
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'No se pudo actualizar proceso inicial' });
  }
});

// ─── Measurement tasks (random sampling of real material usage) ──────────────

const PRODUCTION_BOARD_ROLES = ['Produccion', 'Almacen Lider', 'Almacen', 'Admin'];

router.get('/api/production/kanban/cards/:id/tasks', authenticateToken, requireRole(PRODUCTION_BOARD_ROLES), async (req, res) => {
  try {
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'ID de tarjeta inválido' });
    }
    res.json({ tasks: await listCardTasks(cardId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar tareas de medición' });
  }
});

router.post('/api/production/tasks/:id/complete', authenticateToken, requireRole(PRODUCTION_BOARD_ROLES), async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, { qtyUsed: req.body?.qty_used, userId: req.user.id });
    res.json({ message: 'Medición registrada', task });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la medición' });
  }
});

router.post('/api/production/tasks/:id/skip', authenticateToken, requireRole(PRODUCTION_BOARD_ROLES), async (req, res) => {
  try {
    const task = await resolveTask(req.params.id, { skip: true, userId: req.user.id });
    res.json({ message: 'Tarea omitida', task });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo omitir la tarea' });
  }
});

router.get('/api/production/variance', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    res.json(await getVarianceReport());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el reporte de variaciones' });
  }
});

// ─── Product structure (route steps + BOM) and derived costing ───────────────

router.get('/api/products/:sku/structure', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const structure = await getProductStructure(req.params.sku);
    res.json(structure);
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la estructura del producto' });
  }
});

router.put('/api/products/:sku/structure', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await saveProductStructure(req.params.sku, req.body || {}, req.user.id);
    const structure = await getProductStructure(req.params.sku);
    res.json({ message: 'Estructura actualizada', ...structure });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la estructura del producto' });
  }
});

router.get('/api/production/settings', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    res.json(await loadProductionSettings());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de producción' });
  }
});

router.patch('/api/production/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const settings = await saveProductionSettings(req.body || {}, req.user.id);
    res.json({ message: 'Configuración actualizada', ...settings });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración de producción' });
  }
});

module.exports = router;
