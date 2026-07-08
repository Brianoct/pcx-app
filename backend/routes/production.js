const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { getProductionKanbanAccessScope, resolveInventoryScopeByCity } = require('../lib/inventory');
const { PRODUCTION_KANBAN_STAGES, getRouteStagesForSku, mapProductionKanbanCardRow, normalizeProductionKanbanStage, normalizeProductionStartProcess, replaceProductProcessSteps, syncProductionKanbanFromInventory } = require('../lib/kanban');
const { validateProductSku } = require('../lib/products');
const { getProductStructure, loadProductionSettings, saveProductStructure, saveProductionSettings } = require('../lib/productStructure');
const { countPendingTasksByCard, getVarianceReport, listCardTasks, maybeCreateSamplingTasks, resolveTask } = require('../lib/productionSampling');
const { ensureQcProductSettingsSeeded } = require('../lib/qc');
const { sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

router.get('/api/production/kanban', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const kanbanScope = getProductionKanbanAccessScope(userContext, access);
    if (kanbanScope.error) return res.status(403).json({ error: kanbanScope.error });

    const cards = await syncProductionKanbanFromInventory();
    const pendingTasks = await countPendingTasksByCard(cards.map((card) => card.id));
    for (const card of cards) {
      card.pending_tasks = pendingTasks.get(card.id) || 0;
    }
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
    `SELECT id, sku, product_name, store_location, required_qty, qty_frozen, stage, start_process
     FROM production_kanban_cards
     WHERE id = ANY($1::bigint[])
       AND is_active = TRUE
       AND source = 'min_stock'`,
    [ids]
  );
  return result.rows;
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
             last_moved_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, sku, product_name, store_location, current_stock, min_stock, required_qty,
                   qty_frozen, start_process, stage, source, last_moved_at, created_at, updated_at`,
        [card.id, nextStage, leavingPlanning]
      );
      movedCards.push(updatedRes.rows[0]);
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
  const skus = new Set(cards.map((card) => String(card.sku || '').toUpperCase()));
  if (skus.size > 1) return 'Todas las tarjetas del lote deben ser del mismo producto';
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

router.patch('/api/production/kanban/cards/:id/stage', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
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
router.patch('/api/production/kanban/batch-stage', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
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
router.post('/api/production/kanban/qc-gate', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
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
             SET required_qty = $2, stage = 'embalado', last_moved_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
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

// Warehouse reception: the end of the card's life. Only pieces confirmed
// intact enter the sede's stock; transit damage is logged, and the next
// inventory sync regenerates any remaining need automatically.
router.post('/api/production/kanban/cards/:id/receive', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
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

router.patch('/api/production/kanban/routes/:sku', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
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

const PRODUCTION_BOARD_ROLES = ['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin'];

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
