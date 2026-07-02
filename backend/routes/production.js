const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { getProductionKanbanAccessScope } = require('../lib/inventory');
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

router.patch('/api/production/kanban/cards/:id/stage', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const kanbanScope = getProductionKanbanAccessScope(userContext, access);
    if (kanbanScope.error) return res.status(403).json({ error: kanbanScope.error });

    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'ID de tarjeta inválido' });
    }
    const nextStage = normalizeProductionKanbanStage(req.body?.stage || '');
    if (!nextStage) {
      return res.status(400).json({ error: 'Etapa inválida' });
    }
    const currentRes = await pool.query(
      `SELECT id, sku, store_location, required_qty, stage, start_process
       FROM production_kanban_cards
       WHERE id = $1
         AND is_active = TRUE
         AND source = 'min_stock'`,
      [cardId]
    );
    if (currentRes.rowCount === 0) {
      return res.status(404).json({ error: 'Tarjeta no encontrada o inactiva' });
    }
    const card = currentRes.rows[0];
    const allowedStages = await getRouteStagesForSku(card.sku, card.start_process || 'corte_laser');
    if (!allowedStages.includes(nextStage)) {
      return res.status(400).json({
        error: `La etapa ${nextStage} no aplica para esta tarjeta (${card.start_process || 'corte_laser'})`
      });
    }
    const updatedRes = await pool.query(
      `UPDATE production_kanban_cards
       SET stage = $2,
           last_moved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, sku, product_name, store_location, current_stock, min_stock, required_qty,
                 start_process, stage, source, last_moved_at, created_at, updated_at`,
      [cardId, nextStage]
    );
    // Movement log: durations per stage (time between consecutive events) feed
    // the future cost/throughput baselines.
    if (card.stage !== nextStage) {
      await pool.query(
        `INSERT INTO production_stage_events (card_id, sku, store_location, from_stage, to_stage, qty, moved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cardId, String(card.sku || '').toUpperCase(), card.store_location, card.stage || null, nextStage, Number(card.required_qty || 0), req.user.id]
      );
      // Random measurement task: sometimes ask the operator to record real
      // material usage for the stage the card just entered.
      await maybeCreateSamplingTasks({
        cardId,
        sku: card.sku,
        storeLocation: card.store_location,
        process: nextStage,
        batchQty: card.required_qty
      });
    }
    res.json({
      message: 'Etapa actualizada',
      card: mapProductionKanbanCardRow(updatedRes.rows[0], new Map([[String(card.sku || '').toUpperCase(), allowedStages]]))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar etapa de la tarjeta' });
  }
});

// Record quality-control pass/fail for a production card, straight from the
// embalado step. Reuses the QC records table so production commission (paid on
// approved pieces) keeps computing from the same source. Only logs QC — it does
// not touch inventory stock.
router.post('/api/production/kanban/cards/:id/qc', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const kanbanScope = getProductionKanbanAccessScope(userContext, access);
    if (kanbanScope.error) return res.status(403).json({ error: kanbanScope.error });

    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'ID de tarjeta inválido' });
    }

    const parseCount = (value) => {
      if (value === undefined || value === null || value === '') return 0;
      const n = Number.parseInt(value, 10);
      return Number.isInteger(n) && n >= 0 ? n : NaN;
    };
    const passed = parseCount(req.body?.passed);
    const rejected = parseCount(req.body?.rejected);
    if (Number.isNaN(passed) || Number.isNaN(rejected)) {
      return res.status(400).json({ error: 'Cantidades inválidas. Usa enteros mayores o iguales a 0' });
    }
    if (passed <= 0 && rejected <= 0) {
      return res.status(400).json({ error: 'Registra al menos una pieza aprobada o rechazada' });
    }

    const cardRes = await pool.query(
      `SELECT id, sku, product_name
       FROM production_kanban_cards
       WHERE id = $1
         AND is_active = TRUE
         AND source = 'min_stock'`,
      [cardId]
    );
    if (cardRes.rowCount === 0) {
      return res.status(404).json({ error: 'Tarjeta no encontrada o inactiva' });
    }
    const card = cardRes.rows[0];
    const sku = String(card.sku || '').toUpperCase();
    const productName = String(card.product_name || sku).trim() || sku;

    await ensureQcProductSettingsSeeded();
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
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: 'Control de calidad registrado',
      sku,
      product_name: productName,
      passed,
      rejected
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el control de calidad' });
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
