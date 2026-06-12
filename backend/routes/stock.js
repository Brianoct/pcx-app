const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { getInventoryAccessScope } = require('../lib/inventory');
const { ensureProductCatalogReady } = require('../lib/products');
const { sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// ─── GET stock for a SKU in a specific store ───────────────────────────────
router.get('/api/stock', authenticateToken, async (req, res) => {
  const { sku, store_location } = req.query;

  if (!sku || !store_location) {
    return res.status(400).json({ error: 'SKU y store_location son requeridos' });
  }

  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[store_location];

  if (!warehouseField) return res.status(400).json({ error: 'Almacén no válido' });

  try {
    const result = await pool.query(
      `SELECT ${warehouseField} AS stock FROM products WHERE sku = $1`,
      [sku.toUpperCase()]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });

    res.json({ stock: result.rows[0].stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener stock' });
  }
});

// ─── UPDATE stock for a specific SKU in a warehouse ────────────────────────
router.patch('/api/products/:sku/stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const { store_location, new_stock } = req.body;

  if (!store_location || new_stock === undefined || isNaN(new_stock) || new_stock < 0) {
    return res.status(400).json({ error: 'store_location y new_stock (número >= 0) son requeridos' });
  }

  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[store_location];

  if (!warehouseField) return res.status(400).json({ error: 'Almacén no válido' });
  if (!inventoryScope.isGlobal && store_location !== inventoryScope.scope.canonical) {
    return res.status(403).json({ error: 'No puedes actualizar inventario de otro almacén' });
  }

  try {
    const result = await pool.query(
      `UPDATE products 
       SET ${warehouseField} = $1, last_updated = NOW() 
       WHERE sku = $2 
       RETURNING sku, ${warehouseField} AS stock`,
      [new_stock, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ 
      message: 'Stock actualizado', 
      sku: result.rows[0].sku, 
      stock: result.rows[0].stock 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar stock' });
  }
});

// ─── UPDATE minimum stock thresholds for a SKU ──────────────────────────────
router.patch('/api/products/:sku/min-stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const minFields = ['min_stock_cochabamba', 'min_stock_santacruz', 'min_stock_lima'];

  try {
    if (!inventoryScope.isGlobal) {
      const allowedMinField = inventoryScope.scope.minField;
      const providedFields = minFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
      if (providedFields.length === 0) {
        return res.status(400).json({ error: `Debes enviar ${allowedMinField}` });
      }
      if (providedFields.some((field) => field !== allowedMinField)) {
        return res.status(403).json({ error: 'No puedes actualizar mínimos de otro almacén' });
      }

      const minValue = req.body[allowedMinField];
      if (minValue === undefined || minValue === null || Number.isNaN(Number(minValue)) || Number(minValue) < 0) {
        return res.status(400).json({ error: 'El mínimo debe ser un número >= 0' });
      }

      const result = await pool.query(
        `UPDATE products
         SET ${allowedMinField} = $1,
             last_updated = NOW()
         WHERE sku = $2
         RETURNING sku, ${allowedMinField}`,
        [Number(minValue), sku.toUpperCase()]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      return res.json({
        message: 'Mínimo actualizado',
        ...result.rows[0]
      });
    }

    const {
      min_stock_cochabamba,
      min_stock_santacruz,
      min_stock_lima
    } = req.body;

    const values = [min_stock_cochabamba, min_stock_santacruz, min_stock_lima];
    if (values.some((v) => v === undefined || v === null || Number.isNaN(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ error: 'Los mínimos por almacén son requeridos y deben ser números >= 0' });
    }

    const result = await pool.query(
      `UPDATE products
       SET min_stock_cochabamba = $1,
           min_stock_santacruz = $2,
           min_stock_lima = $3,
           last_updated = NOW()
       WHERE sku = $4
       RETURNING sku, min_stock_cochabamba, min_stock_santacruz, min_stock_lima`,
      [min_stock_cochabamba, min_stock_santacruz, min_stock_lima, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({
      message: 'Mínimos actualizados',
      ...result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar mínimos' });
  }
});

// ─── MARKETING: Combos ──────────────────────────────────────────────────────

// ─── INVENTORY ──────────────────────────────────────────────────────────────
router.get('/api/products', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  try {
    await ensureProductCatalogReady();
    if (!inventoryScope.isGlobal) {
      const stockField = inventoryScope.scope.stockField;
      const minField = inventoryScope.scope.minField;
      const result = await pool.query(`
        SELECT sku, name, ${stockField}, ${minField}, last_updated
        FROM products
        WHERE is_active = TRUE
        ORDER BY sku
      `);
      return res.json(result.rows);
    }

    const result = await pool.query(`
      SELECT sku, name, stock_cochabamba, stock_santacruz, stock_lima,
             min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
             last_updated
      FROM products
      WHERE is_active = TRUE
      ORDER BY sku
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

module.exports = router;
