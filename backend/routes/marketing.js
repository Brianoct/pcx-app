const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { createHttpError } = require('../lib/util');
const { decodeImageDataUrl } = require('../lib/imageAssets');

const router = express.Router();

// GET all combos with items
router.get('/api/combos', authenticateToken, async (req, res) => {
  try {
    const combosResult = await pool.query(`
      SELECT
        c.id, c.name, c.sf_price, c.cf_price, c.image_url, c.created_at,
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

// ─── COMBO IMAGES (stored in DB, served via capability URL) ──────────────────
// Same pattern as product photos: bytes live in combo_assets, combos.image_url
// points at an unguessable capability URL that a plain <img> can load.

router.post('/api/combos/:id/image', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const comboId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(comboId) || comboId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const existsRes = await pool.query('SELECT id FROM combos WHERE id = $1', [comboId]);
    if (existsRes.rowCount === 0) return res.status(404).json({ error: 'Combo no encontrado' });

    const { mime, buffer } = decodeImageDataUrl(req.body?.data_url);
    const accessToken = crypto.randomBytes(16).toString('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO combo_assets (combo_id, mime, data, access_token, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (combo_id) DO UPDATE
         SET mime = EXCLUDED.mime, data = EXCLUDED.data, access_token = EXCLUDED.access_token, updated_at = NOW()`,
        [comboId, mime, buffer, accessToken]
      );
      const imageUrl = `/api/combo-assets/${comboId}/${accessToken}`;
      await client.query('UPDATE combos SET image_url = $2 WHERE id = $1', [comboId, imageUrl]);
      await client.query('COMMIT');
      res.json({ message: 'Imagen actualizada', id: comboId, image_url: imageUrl });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error uploading combo image:', err);
    res.status(500).json({ error: 'No se pudo subir la imagen' });
  }
});

router.delete('/api/combos/:id/image', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const comboId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(comboId) || comboId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM combo_assets WHERE combo_id = $1', [comboId]);
      // Only clear the pointer if it referenced our own asset.
      await client.query(
        "UPDATE combos SET image_url = NULL WHERE id = $1 AND image_url LIKE '/api/combo-assets/%'",
        [comboId]
      );
      await client.query('COMMIT');
      res.json({ message: 'Imagen eliminada', id: comboId });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error deleting combo image:', err);
    res.status(500).json({ error: 'No se pudo eliminar la imagen' });
  }
});

// Public serve (no auth): the capability token in the path is the guard.
router.get('/api/combo-assets/:id/:token', async (req, res) => {
  try {
    const comboId = Number.parseInt(req.params.id, 10);
    const token = String(req.params.token || '');
    if (!Number.isInteger(comboId) || comboId <= 0 || !/^[a-f0-9]{32}$/.test(token)) {
      return res.status(404).end();
    }
    const result = await pool.query(
      'SELECT mime, data, access_token FROM combo_assets WHERE combo_id = $1',
      [comboId]
    );
    const row = result.rows[0];
    if (!row || !crypto.timingSafeEqual(Buffer.from(String(row.access_token)), Buffer.from(token))) {
      return res.status(404).end();
    }
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(row.data);
  } catch (err) {
    console.error('Error serving combo image:', err);
    res.status(404).end();
  }
});

// Cupones: la sección vieja de códigos globales se reemplazó por la
// herramienta "cupon" del motor de promos (routes/promos.js) — códigos
// personales por cliente, con canje rastreado.

module.exports = router;
