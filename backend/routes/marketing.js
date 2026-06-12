const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { createHttpError } = require('../lib/util');

const router = express.Router();

// GET all combos with items
router.get('/api/combos', authenticateToken, async (req, res) => {
  try {
    const combosResult = await pool.query(`
      SELECT 
        c.id, c.name, c.sf_price, c.cf_price, c.created_at,
        u.email as created_by_email
      FROM combos c
      LEFT JOIN users u ON c.created_by = u.id
      ORDER BY c.created_at DESC
    `);

    const combos = combosResult.rows;

    for (let combo of combos) {
      const itemsResult = await pool.query(`
        SELECT sku, quantity
        FROM combo_items
        WHERE combo_id = $1
      `, [combo.id]);
      combo.items = itemsResult.rows;
    }

    res.json(combos);
  } catch (err) {
    console.error('Error fetching combos:', err);
    res.status(500).json({ error: 'No se pudieron cargar combos' });
  }
});

// POST create new combo
router.post('/api/combos', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { name, sf, cf, products } = req.body;

  const sfNumber = Number(sf);
  const cfNumber = Number(cf);
  const normalizedProducts = Array.isArray(products)
    ? products
      .map((item) => ({
        sku: String(item?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(item?.quantity, 10)
      }))
      .filter((item) => item.sku && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
  if (
    !String(name || '').trim() ||
    normalizedProducts.length === 0 ||
    !Number.isFinite(sfNumber) ||
    !Number.isFinite(cfNumber) ||
    sfNumber < 0 ||
    cfNumber < 0
  ) {
    return res.status(400).json({ error: 'Faltan campos requeridos o productos vacíos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const comboRes = await client.query(
      'INSERT INTO combos (name, sf_price, cf_price, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [String(name).trim(), sfNumber, cfNumber, req.user.id]
    );
    const comboId = comboRes.rows[0].id;

    for (const item of normalizedProducts) {
      const { sku, quantity } = item;
      await client.query(
        'INSERT INTO combo_items (combo_id, sku, quantity) VALUES ($1, $2, $3)',
        [comboId, sku, quantity]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: comboId, message: 'Combo created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating combo:', err);
    res.status(500).json({ error: 'No se pudo crear combo' });
  } finally {
    client.release();
  }
});

// PUT update combo
router.put('/api/combos/:id', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const comboId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(comboId) || comboId <= 0) {
    return res.status(400).json({ error: 'Combo inválido' });
  }

  const { name, sf, cf, products } = req.body;
  const sfNumber = Number(sf);
  const cfNumber = Number(cf);
  const normalizedProducts = Array.isArray(products)
    ? products
      .map((item) => ({
        sku: String(item?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(item?.quantity, 10)
      }))
      .filter((item) => item.sku && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
  if (
    !String(name || '').trim() ||
    normalizedProducts.length === 0 ||
    !Number.isFinite(sfNumber) ||
    !Number.isFinite(cfNumber) ||
    sfNumber < 0 ||
    cfNumber < 0
  ) {
    return res.status(400).json({ error: 'Faltan campos requeridos o productos vacíos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentRes = await client.query(
      'SELECT created_by FROM combos WHERE id = $1 FOR UPDATE',
      [comboId]
    );
    if (currentRes.rowCount === 0) {
      throw createHttpError(404, 'Combo no encontrado');
    }

    const creatorId = Number(currentRes.rows[0]?.created_by || 0) || null;
    const isAdmin = normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;
    if (creatorId && creatorId !== req.user.id && !isAdmin) {
      throw createHttpError(403, 'No autorizado para editar este combo');
    }

    await client.query(
      `UPDATE combos
       SET name = $1,
           sf_price = $2,
           cf_price = $3
       WHERE id = $4`,
      [String(name || '').trim(), sfNumber, cfNumber, comboId]
    );
    await client.query('DELETE FROM combo_items WHERE combo_id = $1', [comboId]);
    for (const item of normalizedProducts) {
      await client.query(
        'INSERT INTO combo_items (combo_id, sku, quantity) VALUES ($1, $2, $3)',
        [comboId, item.sku, item.quantity]
      );
    }

    await client.query('COMMIT');
    res.json({ id: comboId, message: 'Combo actualizado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating combo:', err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo actualizar combo' });
  } finally {
    client.release();
  }
});

// DELETE combo
router.delete('/api/combos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const comboRes = await pool.query('SELECT created_by FROM combos WHERE id = $1', [id]);
    if (comboRes.rowCount === 0) {
      return res.status(404).json({ error: 'Combo no encontrado' });
    }

    const creatorId = comboRes.rows[0].created_by;
    const isAdmin = normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;
    if (creatorId !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'No autorizado para eliminar este combo' });
    }

    await pool.query('DELETE FROM combos WHERE id = $1', [id]);
    res.json({ message: 'Combo deleted' });
  } catch (err) {
    console.error('Error deleting combo:', err);
    res.status(500).json({ error: 'No se pudo eliminar combo' });
  }
});

// ─── CUPONES ────────────────────────────────────────────────────────────────

// GET all coupons
router.get('/api/cupones', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, code, discount_percent, valid_until, created_at FROM cupones ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cupones:', err);
    res.status(500).json({ error: 'No se pudieron cargar cupones' });
  }
});

// POST create new coupon
router.post('/api/cupones', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { code, discount_percent, valid_until } = req.body;

  if (!code || !discount_percent || !valid_until) {
    return res.status(400).json({ error: 'Faltan campos requeridos: code, discount_percent, valid_until' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO cupones (code, discount_percent, valid_until, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [code.toUpperCase(), discount_percent, valid_until, req.user.id]
    );
    res.status(201).json({ id: result.rows[0].id, message: 'Cupón creado' });
  } catch (err) {
    console.error('Error creating cupón:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código ya existe' });
    }
    res.status(500).json({ error: 'Error al crear cupón' });
  }
});

// DELETE coupon
router.delete('/api/cupones/:id', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM cupones WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    res.json({ message: 'Cupón eliminado' });
  } catch (err) {
    console.error('Error deleting cupón:', err);
    res.status(500).json({ error: 'Error al eliminar cupón' });
  }
});

module.exports = router;
