const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { getProductionKanbanAccessScope } = require('../lib/inventory');
const { PRODUCTION_KANBAN_STAGES, ensureProductionKanbanTables, getProductionRouteStages, mapProductionKanbanCardRow, normalizeProductionKanbanStage, normalizeProductionStartProcess, syncProductionKanbanFromInventory } = require('../lib/kanban');
const { validateProductSku } = require('../lib/products');
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

    await ensureProductionKanbanTables();
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'ID de tarjeta inválido' });
    }
    const nextStage = normalizeProductionKanbanStage(req.body?.stage || '');
    if (!nextStage) {
      return res.status(400).json({ error: 'Etapa inválida' });
    }
    const currentRes = await pool.query(
      `SELECT id, start_process
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
    const allowedStages = getProductionRouteStages(card.start_process || 'corte_laser');
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
    res.json({
      message: 'Etapa actualizada',
      card: mapProductionKanbanCardRow(updatedRes.rows[0])
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar etapa de la tarjeta' });
  }
});

router.patch('/api/production/kanban/routes/:sku', authenticateToken, requireRole(['Microfabrica Lider', 'Microfabrica', 'Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const kanbanScope = getProductionKanbanAccessScope(userContext, access);
    if (kanbanScope.error) return res.status(403).json({ error: kanbanScope.error });

    await ensureProductionKanbanTables();
    const sku = validateProductSku(req.params.sku);
    const startProcess = normalizeProductionStartProcess(req.body?.start_process || '');
    if (!startProcess) {
      return res.status(400).json({ error: 'Proceso inicial inválido. Usa comprar, corte_laser o punzonado' });
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
    await pool.query(
      `INSERT INTO production_process_routes (sku, start_process, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (sku) DO UPDATE
       SET start_process = EXCLUDED.start_process,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [sku, startProcess, req.user.id]
    );
    await pool.query(
      `UPDATE production_kanban_cards
       SET start_process = $2,
           stage = CASE
             WHEN stage IN ('comprar', 'corte_laser', 'punzonado') THEN $2
             ELSE stage
           END,
           updated_at = NOW()
       WHERE UPPER(sku) = $1
         AND source = 'min_stock'`,
      [sku, startProcess]
    );
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

module.exports = router;
