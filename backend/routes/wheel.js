const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { canAccessPanel } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const { normalizeCustomerPhone } = require('../lib/customers');

const router = express.Router();

const TOKEN_RE = /^[a-f0-9]{32}$/;
const MAX_SLICES = 12;
const MIN_SLICES = 2;

const sanitizeSlices = (raw) => {
  if (!Array.isArray(raw)) return null;
  const slices = raw
    .map((slice) => ({
      label: String(slice?.label || '').trim().slice(0, 60),
      weight: Number(slice?.weight),
      top: Boolean(slice?.top)
    }))
    .filter((slice) => slice.label);
  if (slices.length < MIN_SLICES || slices.length > MAX_SLICES) return null;
  for (const slice of slices) {
    if (!Number.isFinite(slice.weight) || slice.weight < 0 || slice.weight > 1000) return null;
  }
  if (!slices.some((slice) => slice.weight > 0)) return null;
  return slices;
};

// The prize is decided HERE, never in the browser. The client animation just
// lands on whatever index this returns.
const pickWeightedIndex = (slices) => {
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
  // crypto-grade randomness: integer in [0, total*1000) for 3 decimals of weight
  const scaled = crypto.randomInt(0, Math.max(1, Math.round(total * 1000)));
  let acc = 0;
  for (let i = 0; i < slices.length; i++) {
    acc += Math.round(slices[i].weight * 1000);
    if (scaled < acc) return i;
  }
  return slices.length - 1;
};

const ensureCotizarAccess = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    res.status(403).json({ error: 'No tienes permiso para generar giros' });
    return null;
  }
  return userContext;
};

const buildSpinRow = (row) => ({
  id: Number(row.id),
  token: row.token,
  customer_name: row.customer_name || null,
  customer_phone: row.customer_phone,
  status: row.status,
  prize_label: row.prize_label || null,
  prize_index: row.prize_index !== null && row.prize_index !== undefined ? Number(row.prize_index) : null,
  is_top_prize: Boolean(row.is_top_prize),
  redeemed_at: row.redeemed_at || null,
  created_at: row.created_at || null,
  spun_at: row.spun_at || null
});

// ── Marketing config ────────────────────────────────────────────────────────

router.get('/api/wheel/config', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT slices, is_active, version, updated_at FROM wheel_config WHERE id = 1');
    const row = result.rows[0] || { slices: [], is_active: false, version: 0 };
    const statsRes = await pool.query(
      `SELECT config_version,
              COUNT(*)::int AS links,
              COUNT(*) FILTER (WHERE status = 'spun')::int AS spins,
              COUNT(*) FILTER (WHERE is_top_prize)::int AS top_prizes
       FROM wheel_spins GROUP BY config_version ORDER BY config_version DESC LIMIT 5`
    );
    res.json({ config: row, stats: statsRes.rows });
  } catch (err) {
    console.error('Error loading wheel config:', err);
    res.status(500).json({ error: 'No se pudo cargar la ruleta' });
  }
});

router.put('/api/wheel/config', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const slices = sanitizeSlices(req.body?.slices);
  if (!slices) {
    return res.status(400).json({
      error: `La ruleta necesita entre ${MIN_SLICES} y ${MAX_SLICES} espacios con texto, y al menos uno con probabilidad mayor a 0`
    });
  }
  const isActive = req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
  try {
    // Every save bumps the version = new campaign: customers who spun the old
    // wheel can receive a new link for this one.
    const result = await pool.query(
      `UPDATE wheel_config
       SET slices = $1::jsonb, is_active = $2, version = version + 1, updated_by = $3, updated_at = NOW()
       WHERE id = 1
       RETURNING slices, is_active, version, updated_at`,
      [JSON.stringify(slices), isActive, req.user.id]
    );
    res.json({ message: 'Ruleta guardada', config: result.rows[0] });
  } catch (err) {
    console.error('Error saving wheel config:', err);
    res.status(500).json({ error: 'No se pudo guardar la ruleta' });
  }
});

// ── Seller: create a spin link for a customer ───────────────────────────────

router.post('/api/wheel/spins', authenticateToken, async (req, res) => {
  const userContext = await ensureCotizarAccess(req, res);
  if (!userContext) return;
  const customerName = String(req.body?.customer_name || '').trim().slice(0, 60);
  const customerPhone = String(req.body?.customer_phone || '').trim().slice(0, 26);
  const phoneNormalized = normalizeCustomerPhone(customerPhone);
  if (!phoneNormalized || phoneNormalized.length < 7) {
    return res.status(400).json({ error: 'Teléfono del cliente inválido (mínimo 7 dígitos)' });
  }
  try {
    const configRes = await pool.query('SELECT slices, is_active, version FROM wheel_config WHERE id = 1');
    const config = configRes.rows[0];
    if (!config || !config.is_active) {
      return res.status(409).json({ error: 'La ruleta está desactivada. Pide a marketing que la active.' });
    }
    const slices = sanitizeSlices(config.slices);
    if (!slices) {
      return res.status(409).json({ error: 'La ruleta no tiene premios configurados todavía.' });
    }

    // One spin per customer per campaign. Matching on the RIGHT 8 digits
    // tolerates the 591 country prefix, same as the cartera lookup.
    const existingRes = await pool.query(
      `SELECT * FROM wheel_spins
       WHERE config_version = $1 AND RIGHT(phone_normalized, 8) = RIGHT($2, 8)
       ORDER BY created_at DESC LIMIT 1`,
      [config.version, phoneNormalized]
    );
    if (existingRes.rowCount > 0) {
      const existing = existingRes.rows[0];
      if (existing.status === 'spun') {
        return res.status(409).json({
          error: `Este cliente ya giró la ruleta: "${existing.prize_label}"`,
          spin: buildSpinRow(existing)
        });
      }
      // Pending link already exists — hand back the same one instead of
      // minting a second chance.
      return res.json({ spin: buildSpinRow(existing), existing: true });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const insertRes = await pool.query(
      `INSERT INTO wheel_spins (token, customer_name, customer_phone, phone_normalized, slices, config_version, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING *`,
      [token, customerName || null, customerPhone, phoneNormalized, JSON.stringify(slices), config.version, req.user.id]
    );
    res.status(201).json({ spin: buildSpinRow(insertRes.rows[0]) });
  } catch (err) {
    console.error('Error creating wheel spin:', err);
    res.status(500).json({ error: 'No se pudo generar el giro' });
  }
});

// Latest un-redeemed prize for a phone — powers the Cotizar banner.
router.get('/api/wheel/prize', authenticateToken, async (req, res) => {
  const userContext = await ensureCotizarAccess(req, res);
  if (!userContext) return;
  const phoneNormalized = normalizeCustomerPhone(String(req.query.phone || ''));
  if (!phoneNormalized || phoneNormalized.length < 7) return res.json({ prize: null });
  try {
    const result = await pool.query(
      `SELECT * FROM wheel_spins
       WHERE status = 'spun' AND redeemed_at IS NULL
         AND prize_label IS NOT NULL
         AND RIGHT(phone_normalized, 8) = RIGHT($1, 8)
       ORDER BY spun_at DESC LIMIT 1`,
      [phoneNormalized]
    );
    res.json({ prize: result.rowCount > 0 ? buildSpinRow(result.rows[0]) : null });
  } catch (err) {
    console.error('Error loading wheel prize:', err);
    res.status(500).json({ error: 'No se pudo consultar el premio' });
  }
});

router.post('/api/wheel/spins/:id/redeem', authenticateToken, async (req, res) => {
  const userContext = await ensureCotizarAccess(req, res);
  if (!userContext) return;
  const spinId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(spinId) || spinId <= 0) return res.status(400).json({ error: 'Giro inválido' });
  try {
    const result = await pool.query(
      `UPDATE wheel_spins SET redeemed_at = NOW(), redeemed_by = $2
       WHERE id = $1 AND status = 'spun' AND redeemed_at IS NULL
       RETURNING *`,
      [spinId, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Premio no encontrado o ya usado' });
    res.json({ message: 'Premio marcado como usado', spin: buildSpinRow(result.rows[0]) });
  } catch (err) {
    console.error('Error redeeming wheel prize:', err);
    res.status(500).json({ error: 'No se pudo marcar el premio' });
  }
});

// ── Public (customer, no auth): view + spin ─────────────────────────────────

const loadSpinByToken = async (rawToken) => {
  const token = String(rawToken || '').trim().toLowerCase();
  if (!TOKEN_RE.test(token)) return null;
  const result = await pool.query('SELECT * FROM wheel_spins WHERE token = $1', [token]);
  return result.rows[0] || null;
};

router.get('/api/wheel/public/:token', async (req, res) => {
  try {
    const spin = await loadSpinByToken(req.params.token);
    if (!spin) return res.status(404).json({ error: 'Este enlace no es válido' });
    res.json({
      customer_name: spin.customer_name || null,
      slices: (Array.isArray(spin.slices) ? spin.slices : []).map((slice) => ({
        label: slice.label,
        top: Boolean(slice.top)
      })),
      status: spin.status,
      prize_label: spin.prize_label || null,
      prize_index: spin.prize_index !== null && spin.prize_index !== undefined ? Number(spin.prize_index) : null,
      is_top_prize: Boolean(spin.is_top_prize)
    });
  } catch (err) {
    console.error('Error loading public wheel:', err);
    res.status(500).json({ error: 'No se pudo cargar la ruleta' });
  }
});

router.post('/api/wheel/public/:token/spin', async (req, res) => {
  try {
    const spin = await loadSpinByToken(req.params.token);
    if (!spin) return res.status(404).json({ error: 'Este enlace no es válido' });

    const slices = Array.isArray(spin.slices) ? spin.slices : [];
    if (slices.length < MIN_SLICES) return res.status(409).json({ error: 'La ruleta no está disponible' });

    const prizeIndex = pickWeightedIndex(slices);
    const prize = slices[prizeIndex];

    // THE lock: only one request can ever flip pending → spun. Refreshes,
    // double taps and parallel requests all lose the race and get the
    // already-recorded result instead of a second spin.
    const updateRes = await pool.query(
      `UPDATE wheel_spins
       SET status = 'spun', prize_label = $2, prize_index = $3, is_top_prize = $4, spun_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING prize_label, prize_index, is_top_prize`,
      [spin.id, prize.label, prizeIndex, Boolean(prize.top)]
    );

    if (updateRes.rowCount === 0) {
      const currentRes = await pool.query(
        'SELECT prize_label, prize_index, is_top_prize FROM wheel_spins WHERE id = $1',
        [spin.id]
      );
      const current = currentRes.rows[0] || {};
      return res.status(409).json({
        error: 'Ya usaste tu giro',
        prize_label: current.prize_label || null,
        prize_index: current.prize_index !== null && current.prize_index !== undefined ? Number(current.prize_index) : null,
        is_top_prize: Boolean(current.is_top_prize)
      });
    }

    const saved = updateRes.rows[0];
    res.json({
      prize_label: saved.prize_label,
      prize_index: Number(saved.prize_index),
      is_top_prize: Boolean(saved.is_top_prize)
    });
  } catch (err) {
    console.error('Error spinning wheel:', err);
    res.status(500).json({ error: 'No se pudo girar la ruleta' });
  }
});

module.exports = router;
