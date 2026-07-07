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
const PRIZE_TYPES = new Set(['text', 'discount', 'gift']);

const requireMarketing = requireRole(['Marketing Lider', 'Admin']);

const sanitizeSlices = (raw) => {
  if (!Array.isArray(raw)) return null;
  const slices = raw
    .map((slice) => {
      const type = PRIZE_TYPES.has(slice?.type) ? slice.type : 'text';
      return {
        label: String(slice?.label || '').trim().slice(0, 60),
        weight: Number(slice?.weight),
        top: Boolean(slice?.top),
        type,
        percent: type === 'discount' ? Number(slice?.percent) : null,
        gift_sku: type === 'gift' ? String(slice?.gift_sku || '').trim().toUpperCase().slice(0, 50) : null,
        // Optional second gift option (Acero vs Armonía): the seller picks
        // one of the two in Cotizar when the customer wins this slice.
        gift_sku_2: type === 'gift' ? (String(slice?.gift_sku_2 || '').trim().toUpperCase().slice(0, 50) || null) : null
      };
    })
    .filter((slice) => slice.label);
  if (slices.length < MIN_SLICES || slices.length > MAX_SLICES) return null;
  for (const slice of slices) {
    if (!Number.isFinite(slice.weight) || slice.weight < 0 || slice.weight > 1000) return null;
    if (slice.type === 'discount' && (!Number.isFinite(slice.percent) || slice.percent <= 0 || slice.percent > 100)) return null;
    if (slice.type === 'gift' && !slice.gift_sku) return null;
  }
  if (!slices.some((slice) => slice.weight > 0)) return null;
  return slices;
};

// Gift slices must reference a real, active product so the prize can drop
// straight into the Regalo field (and the pedidos checklist). Any product in
// the catalog qualifies — the regalo field is ruleta-only now.
const validateGiftSkus = async (slices) => {
  const giftSkus = [...new Set(
    slices
      .filter((s) => s.type === 'gift')
      .flatMap((s) => [s.gift_sku, s.gift_sku_2])
      .filter(Boolean)
  )];
  if (giftSkus.length === 0) return null;
  const skuRes = await pool.query(
    'SELECT sku FROM products WHERE UPPER(sku) = ANY($1) AND is_active = TRUE',
    [giftSkus]
  );
  const found = new Set(skuRes.rows.map((r) => String(r.sku).toUpperCase()));
  const missing = giftSkus.filter((sku) => !found.has(sku));
  return missing.length > 0 ? missing : null;
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
  prize_type: row.prize_type || null,
  prize_percent: row.prize_percent !== null && row.prize_percent !== undefined ? Number(row.prize_percent) : null,
  prize_gift_sku: row.prize_gift_sku || null,
  prize_gift_sku_2: row.prize_gift_sku_2 || null,
  redeemed_at: row.redeemed_at || null,
  redeemed_quote_id: row.redeemed_quote_id !== null && row.redeemed_quote_id !== undefined ? Number(row.redeemed_quote_id) : null,
  created_at: row.created_at || null,
  spun_at: row.spun_at || null
});

const buildCampaignRow = (row) => ({
  id: Number(row.id),
  name: row.name,
  slices: Array.isArray(row.slices) ? row.slices : [],
  is_active: Boolean(row.is_active),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  links: row.links !== undefined ? Number(row.links || 0) : undefined,
  spins: row.spins !== undefined ? Number(row.spins || 0) : undefined,
  top_prizes: row.top_prizes !== undefined ? Number(row.top_prizes || 0) : undefined
});

// ── Marketing: campaign CRUD ────────────────────────────────────────────────

router.get('/api/wheel/campaigns', authenticateToken, requireMarketing, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, s.links, s.spins, s.top_prizes
       FROM wheel_campaigns c
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS links,
                COUNT(*) FILTER (WHERE ws.status = 'spun')::int AS spins,
                COUNT(*) FILTER (WHERE ws.is_top_prize)::int AS top_prizes
         FROM wheel_spins ws WHERE ws.campaign_id = c.id
       ) s ON TRUE
       ORDER BY c.is_active DESC, c.updated_at DESC`
    );
    res.json({ campaigns: result.rows.map(buildCampaignRow) });
  } catch (err) {
    console.error('Error loading wheel campaigns:', err);
    res.status(500).json({ error: 'No se pudieron cargar las campañas' });
  }
});

router.post('/api/wheel/campaigns', authenticateToken, requireMarketing, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const slices = sanitizeSlices(req.body?.slices);
  if (!name) return res.status(400).json({ error: 'La campaña necesita un nombre' });
  if (!slices) {
    return res.status(400).json({
      error: `La ruleta necesita entre ${MIN_SLICES} y ${MAX_SLICES} espacios con texto, y al menos uno con probabilidad mayor a 0`
    });
  }
  try {
    const missing = await validateGiftSkus(slices);
    if (missing) return res.status(400).json({ error: `Estos SKU no existen o están inactivos: ${missing.join(', ')}` });
    const result = await pool.query(
      `INSERT INTO wheel_campaigns (name, slices, created_by)
       VALUES ($1, $2::jsonb, $3) RETURNING *`,
      [name, JSON.stringify(slices), req.user.id]
    );
    res.status(201).json({ message: 'Campaña creada', campaign: buildCampaignRow(result.rows[0]) });
  } catch (err) {
    console.error('Error creating wheel campaign:', err);
    res.status(500).json({ error: 'No se pudo crear la campaña' });
  }
});

router.put('/api/wheel/campaigns/:id', authenticateToken, requireMarketing, async (req, res) => {
  const campaignId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return res.status(400).json({ error: 'Campaña inválida' });
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const slices = sanitizeSlices(req.body?.slices);
  if (!name) return res.status(400).json({ error: 'La campaña necesita un nombre' });
  if (!slices) {
    return res.status(400).json({
      error: `La ruleta necesita entre ${MIN_SLICES} y ${MAX_SLICES} espacios con texto, y al menos uno con probabilidad mayor a 0`
    });
  }
  try {
    const missing = await validateGiftSkus(slices);
    if (missing) return res.status(400).json({ error: `Estos SKU no existen o están inactivos: ${missing.join(', ')}` });
    const result = await pool.query(
      `UPDATE wheel_campaigns SET name = $2, slices = $3::jsonb, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [campaignId, name, JSON.stringify(slices)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Campaña no encontrada' });
    res.json({ message: 'Campaña guardada', campaign: buildCampaignRow(result.rows[0]) });
  } catch (err) {
    console.error('Error updating wheel campaign:', err);
    res.status(500).json({ error: 'No se pudo guardar la campaña' });
  }
});

// Activate (or deactivate with {active:false}); at most one campaign is live.
router.post('/api/wheel/campaigns/:id/activate', authenticateToken, requireMarketing, async (req, res) => {
  const campaignId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return res.status(400).json({ error: 'Campaña inválida' });
  const makeActive = req.body?.active === undefined ? true : Boolean(req.body.active);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (makeActive) {
      await client.query('UPDATE wheel_campaigns SET is_active = FALSE WHERE is_active');
    }
    const result = await client.query(
      'UPDATE wheel_campaigns SET is_active = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [campaignId, makeActive]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaña no encontrada' });
    }
    await client.query('COMMIT');
    res.json({
      message: makeActive ? 'Campaña activada' : 'Campaña desactivada',
      campaign: buildCampaignRow(result.rows[0])
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error activating wheel campaign:', err);
    res.status(500).json({ error: 'No se pudo cambiar la campaña activa' });
  } finally {
    client.release();
  }
});

router.delete('/api/wheel/campaigns/:id', authenticateToken, requireMarketing, async (req, res) => {
  const campaignId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return res.status(400).json({ error: 'Campaña inválida' });
  try {
    // Spins keep their history (campaign_id goes NULL via the FK); customer
    // prizes already won stay intact and redeemable.
    const result = await pool.query('DELETE FROM wheel_campaigns WHERE id = $1 RETURNING id', [campaignId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Campaña no encontrada' });
    res.json({ message: 'Campaña eliminada' });
  } catch (err) {
    console.error('Error deleting wheel campaign:', err);
    res.status(500).json({ error: 'No se pudo eliminar la campaña' });
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
    const campaignRes = await pool.query('SELECT * FROM wheel_campaigns WHERE is_active LIMIT 1');
    const campaign = campaignRes.rows[0];
    if (!campaign) {
      return res.status(409).json({ error: 'No hay ninguna campaña de ruleta activa. Pide a marketing que active una.' });
    }
    const slices = sanitizeSlices(campaign.slices);
    if (!slices) {
      return res.status(409).json({ error: 'La campaña activa no tiene premios válidos configurados.' });
    }

    // One spin per customer per campaign. Matching on the RIGHT 8 digits
    // tolerates the 591 country prefix, same as the cartera lookup.
    const existingRes = await pool.query(
      `SELECT * FROM wheel_spins
       WHERE campaign_id = $1 AND RIGHT(phone_normalized, 8) = RIGHT($2, 8)
       ORDER BY created_at DESC LIMIT 1`,
      [campaign.id, phoneNormalized]
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
      `INSERT INTO wheel_spins (token, customer_name, customer_phone, phone_normalized, slices, campaign_id, config_version, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING *`,
      [token, customerName || null, customerPhone, phoneNormalized, JSON.stringify(slices), campaign.id, campaign.id, req.user.id]
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
  const quoteId = Number.parseInt(req.body?.quote_id, 10);
  try {
    const result = await pool.query(
      `UPDATE wheel_spins SET redeemed_at = NOW(), redeemed_by = $2, redeemed_quote_id = $3
       WHERE id = $1 AND status = 'spun' AND redeemed_at IS NULL
       RETURNING *`,
      [spinId, req.user.id, Number.isInteger(quoteId) && quoteId > 0 ? quoteId : null]
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
    const prizeType = PRIZE_TYPES.has(prize.type) ? prize.type : 'text';
    const updateRes = await pool.query(
      `UPDATE wheel_spins
       SET status = 'spun', prize_label = $2, prize_index = $3, is_top_prize = $4,
           prize_type = $5, prize_percent = $6, prize_gift_sku = $7, prize_gift_sku_2 = $8, spun_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING prize_label, prize_index, is_top_prize`,
      [
        spin.id, prize.label, prizeIndex, Boolean(prize.top),
        prizeType,
        prizeType === 'discount' && Number.isFinite(Number(prize.percent)) ? Number(prize.percent) : null,
        prizeType === 'gift' ? (prize.gift_sku || null) : null,
        prizeType === 'gift' ? (prize.gift_sku_2 || null) : null
      ]
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
