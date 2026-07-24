// API de la caja de herramientas de marketing (promo_tools).
//  - /api/promos/active: lo que Cotizar muestra y aplica (cualquier usuario).
//  - CRUD + registro de códigos + sorteo: Marketing Líder y Admin.
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { PROMO_TOOL_TYPES } = require('../lib/promos');

const router = express.Router();

// Marketing puede ver el estado del toolchest; activar, editar y sortear
// queda en manos del líder (misma línea que la creación de cupones).
const VIEW_ROLES = ['Marketing', 'Marketing Lider', 'Admin'];
const MANAGE_ROLES = ['Marketing Lider', 'Admin'];

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

// Solo claves conocidas y numéricas; lo demás se descarta silenciosamente.
const sanitizeConfig = (tool, rawConfig = {}) => {
  const config = {};
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const minTotal = num(rawConfig.min_total);
  if (minTotal !== null) config.min_total = minTotal;
  if (tool === 'sorteo') {
    const perTicket = num(rawConfig.bs_per_ticket);
    if (perTicket !== null) config.bs_per_ticket = perTicket;
    const cap = Number.parseInt(rawConfig.max_tickets, 10);
    if (Number.isInteger(cap) && cap >= 1 && cap <= 100) config.max_tickets = cap;
  }
  if (tool === 'cupon') {
    const discount = Number.parseInt(rawConfig.discount_percent, 10);
    if (Number.isInteger(discount) && discount >= 1 && discount <= 100) config.discount_percent = discount;
    const validity = Number.parseInt(rawConfig.validity_days, 10);
    if (Number.isInteger(validity) && validity >= 1 && validity <= 365) config.validity_days = validity;
  }
  return config;
};

// ─── Activas (para Cotizar) ─────────────────────────────────────────────────
router.get('/api/promos/active', authenticateToken, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, tool, name, ends_on::text AS ends_on, config
       FROM promo_tools
       WHERE active = TRUE
         AND (starts_on IS NULL OR starts_on <= (NOW() AT TIME ZONE 'America/La_Paz')::date)
         AND (ends_on IS NULL OR ends_on >= (NOW() AT TIME ZONE 'America/La_Paz')::date)
       ORDER BY id`
    );
    res.json({ promos: result.rows });
  } catch (err) {
    console.error('Error cargando promos activas:', err);
    res.status(500).json({ error: 'No se pudieron cargar promociones activas' });
  }
});

// ─── Cupón vigente de un cliente (para Cotizar) ─────────────────────────────
// El vendedor escribe el teléfono y Cotizar le avisa si ese cliente tiene un
// cupón activo para canjear en esta compra.
router.get('/api/promos/coupon-for-customer', authenticateToken, async (req, res) => {
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!phone || phone.length < 6) return res.json({ coupon: null });
  try {
    const result = await pool.query(
      `SELECT pc.code, pc.meta, pt.name
       FROM promo_codes pc
       JOIN promo_tools pt ON pt.id = pc.tool_id
       WHERE pt.tool = 'cupon' AND pc.customer_phone = $1 AND pc.status = 'valida'
         AND (pc.meta->>'expires_on' IS NULL
              OR pc.meta->>'expires_on' >= (NOW() AT TIME ZONE 'America/La_Paz')::date::text)
       ORDER BY pc.updated_at DESC
       LIMIT 1`,
      [phone]
    );
    if (result.rowCount === 0) return res.json({ coupon: null });
    const row = result.rows[0];
    res.json({
      coupon: {
        code: row.code,
        name: row.name,
        discount_percent: Number(row.meta?.discount_percent || 0),
        expires_on: row.meta?.expires_on || null
      }
    });
  } catch (err) {
    console.error('Error buscando cupón del cliente:', err);
    res.status(500).json({ error: 'No se pudo buscar el cupón del cliente' });
  }
});

// ─── Lista completa (toolchest admin) ───────────────────────────────────────
router.get('/api/promos', authenticateToken, requireRole(VIEW_ROLES), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.tool, t.name, t.campaign_id, t.active,
              t.starts_on::text AS starts_on, t.ends_on::text AS ends_on,
              t.config, t.winner_code_id, t.drawn_at, t.created_at,
              c.name AS campaign_name,
              w.code AS winner_code, w.customer_name AS winner_name, w.customer_phone AS winner_phone,
              (SELECT COUNT(*)::int FROM promo_codes pc WHERE pc.tool_id = t.id) AS codes_count,
              (SELECT COALESCE(SUM(pc.tickets), 0)::int FROM promo_codes pc WHERE pc.tool_id = t.id) AS valid_tickets,
              (SELECT COUNT(*)::int FROM quotes q
                WHERE q.promos IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(q.promos) p
                    WHERE p->>'tool' = t.tool AND p->>'name' = t.name
                  )) AS quotes_count
       FROM promo_tools t
       LEFT JOIN marketing_campaigns c ON c.id = t.campaign_id
       LEFT JOIN promo_codes w ON w.id = t.winner_code_id
       ORDER BY t.active DESC, t.created_at DESC`
    );
    res.json({ tools: result.rows });
  } catch (err) {
    console.error('Error cargando promos:', err);
    res.status(500).json({ error: 'No se pudieron cargar las herramientas' });
  }
});

// ─── Crear herramienta ──────────────────────────────────────────────────────
router.post('/api/promos', authenticateToken, requireRole(MANAGE_ROLES), async (req, res) => {
  const tool = String(req.body?.tool || '').trim();
  const name = String(req.body?.name || '').trim();
  const startsOn = req.body?.starts_on || null;
  const endsOn = req.body?.ends_on || null;
  const campaignId = Number.parseInt(req.body?.campaign_id, 10);

  if (!PROMO_TOOL_TYPES.includes(tool)) {
    return res.status(400).json({ error: `Herramienta inválida. Usa: ${PROMO_TOOL_TYPES.join(', ')}` });
  }
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  if (startsOn && !isValidDate(startsOn)) return res.status(400).json({ error: 'Fecha de inicio inválida' });
  if (endsOn && !isValidDate(endsOn)) return res.status(400).json({ error: 'Fecha de fin inválida' });
  if (startsOn && endsOn && String(endsOn) < String(startsOn)) {
    return res.status(400).json({ error: 'La fecha de fin no puede ser anterior al inicio' });
  }

  try {
    const config = sanitizeConfig(tool, req.body?.config || {});
    const result = await pool.query(
      `INSERT INTO promo_tools (tool, name, campaign_id, active, starts_on, ends_on, config, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        tool,
        name,
        Number.isInteger(campaignId) && campaignId > 0 ? campaignId : null,
        Boolean(req.body?.active),
        startsOn,
        endsOn,
        JSON.stringify(config),
        req.user.id
      ]
    );
    res.status(201).json({ id: result.rows[0].id, message: 'Herramienta creada' });
  } catch (err) {
    console.error('Error creando promo:', err);
    res.status(500).json({ error: 'No se pudo crear la herramienta' });
  }
});

// ─── Editar / activar / desactivar ──────────────────────────────────────────
router.patch('/api/promos/:id', authenticateToken, requireRole(MANAGE_ROLES), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const currentRes = await pool.query('SELECT * FROM promo_tools WHERE id = $1', [id]);
    if (currentRes.rowCount === 0) return res.status(404).json({ error: 'Herramienta no encontrada' });
    const current = currentRes.rows[0];

    const has = (field) => Object.prototype.hasOwnProperty.call(req.body || {}, field);
    const name = has('name') ? String(req.body.name || '').trim() : current.name;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const startsOn = has('starts_on') ? (req.body.starts_on || null) : current.starts_on;
    const endsOn = has('ends_on') ? (req.body.ends_on || null) : current.ends_on;
    if (has('starts_on') && startsOn && !isValidDate(startsOn)) return res.status(400).json({ error: 'Fecha de inicio inválida' });
    if (has('ends_on') && endsOn && !isValidDate(endsOn)) return res.status(400).json({ error: 'Fecha de fin inválida' });

    const campaignId = has('campaign_id')
      ? (Number.parseInt(req.body.campaign_id, 10) > 0 ? Number.parseInt(req.body.campaign_id, 10) : null)
      : current.campaign_id;
    const active = has('active') ? Boolean(req.body.active) : current.active;
    const config = has('config') ? sanitizeConfig(current.tool, req.body.config || {}) : current.config;

    await pool.query(
      `UPDATE promo_tools
       SET name = $1, campaign_id = $2, active = $3, starts_on = $4, ends_on = $5, config = $6, updated_at = NOW()
       WHERE id = $7`,
      [name, campaignId, active, startsOn, endsOn, JSON.stringify(config), id]
    );
    res.json({ message: 'Herramienta actualizada' });
  } catch (err) {
    console.error('Error actualizando promo:', err);
    res.status(500).json({ error: 'No se pudo actualizar la herramienta' });
  }
});

router.delete('/api/promos/:id', authenticateToken, requireRole(MANAGE_ROLES), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await pool.query('DELETE FROM promo_tools WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Herramienta no encontrada' });
    res.json({ message: 'Herramienta eliminada' });
  } catch (err) {
    console.error('Error eliminando promo:', err);
    res.status(500).json({ error: 'No se pudo eliminar la herramienta' });
  }
});

// ─── Registro de códigos (sorteo) ───────────────────────────────────────────
router.get('/api/promos/:id/codes', authenticateToken, requireRole(VIEW_ROLES), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const codesRes = await pool.query(
      `SELECT pc.id, pc.code, pc.customer_phone, pc.customer_name, pc.tickets, pc.status, pc.created_at,
              pc.meta, pc.redeemed_quote_id, pc.redeemed_at,
              COALESCE(json_agg(json_build_object(
                'quote_id', pcq.quote_id,
                'quote_total', pcq.quote_total,
                'tickets', pcq.tickets,
                'paid', pcq.paid
              ) ORDER BY pcq.quote_id) FILTER (WHERE pcq.id IS NOT NULL), '[]') AS quotes
       FROM promo_codes pc
       LEFT JOIN promo_code_quotes pcq ON pcq.code_id = pc.id
       WHERE pc.tool_id = $1
       GROUP BY pc.id
       ORDER BY pc.tickets DESC, pc.created_at ASC`,
      [id]
    );
    res.json({ codes: codesRes.rows });
  } catch (err) {
    console.error('Error cargando códigos:', err);
    res.status(500).json({ error: 'No se pudieron cargar los códigos' });
  }
});

// ─── Realizar el sorteo (ponderado por tickets, servidor) ───────────────────
router.post('/api/promos/:id/draw', authenticateToken, requireRole(MANAGE_ROLES), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const toolRes = await client.query('SELECT id, tool FROM promo_tools WHERE id = $1 FOR UPDATE', [id]);
    if (toolRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Herramienta no encontrada' });
    }
    if (toolRes.rows[0].tool !== 'sorteo') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta herramienta no es un sorteo' });
    }

    // Solo códigos con tickets cobrados participan. Cada ticket es una entrada:
    // elegir un entero al azar en [0, total) equivale a sortear un ticket físico.
    const codesRes = await client.query(
      `SELECT id, code, customer_name, customer_phone, tickets
       FROM promo_codes
       WHERE tool_id = $1 AND tickets > 0
       ORDER BY id`,
      [id]
    );
    const totalTickets = codesRes.rows.reduce((sum, row) => sum + Number(row.tickets || 0), 0);
    if (totalTickets === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay tickets válidos (cotizaciones cobradas) para sortear' });
    }

    let pick = crypto.randomInt(totalTickets);
    let winner = codesRes.rows[0];
    for (const row of codesRes.rows) {
      pick -= Number(row.tickets || 0);
      if (pick < 0) { winner = row; break; }
    }

    // Un re-sorteo (si el admin lo repite) limpia la marca anterior.
    await client.query(
      "UPDATE promo_codes SET status = 'valida' WHERE tool_id = $1 AND status = 'ganadora'",
      [id]
    );
    await client.query("UPDATE promo_codes SET status = 'ganadora', updated_at = NOW() WHERE id = $1", [winner.id]);
    await client.query(
      'UPDATE promo_tools SET winner_code_id = $1, drawn_at = NOW(), updated_at = NOW() WHERE id = $2',
      [winner.id, id]
    );
    await client.query('COMMIT');

    res.json({
      message: 'Sorteo realizado',
      winner: {
        code: winner.code,
        customer_name: winner.customer_name,
        customer_phone: winner.customer_phone,
        tickets: Number(winner.tickets || 0),
        total_tickets: totalTickets
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en sorteo:', err);
    res.status(500).json({ error: 'No se pudo realizar el sorteo' });
  } finally {
    client.release();
  }
});

// ─── Registrar ganador manual (sorteo en vivo por TikTok) ───────────────────
// El sorteo físico se hace con los tickets impresos frente a cámara; aquí solo
// se REGISTRA el resultado para que quede en el sistema igual que el sorteo
// automático.
router.patch('/api/promos/:id/winner', authenticateToken, requireRole(MANAGE_ROLES), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const codeId = Number.parseInt(req.body?.code_id, 10);
  if (!Number.isInteger(id) || !Number.isInteger(codeId)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const toolRes = await client.query('SELECT id, tool FROM promo_tools WHERE id = $1 FOR UPDATE', [id]);
    if (toolRes.rowCount === 0 || toolRes.rows[0].tool !== 'sorteo') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sorteo no encontrado' });
    }
    const codeRes = await client.query(
      'SELECT id, code, customer_name, customer_phone, tickets FROM promo_codes WHERE id = $1 AND tool_id = $2',
      [codeId, id]
    );
    if (codeRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Código no encontrado en este sorteo' });
    }
    if (Number(codeRes.rows[0].tickets || 0) <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ese código no tiene tickets pagados: no puede ganar' });
    }
    await client.query("UPDATE promo_codes SET status = 'valida' WHERE tool_id = $1 AND status = 'ganadora'", [id]);
    await client.query("UPDATE promo_codes SET status = 'ganadora', updated_at = NOW() WHERE id = $1", [codeId]);
    await client.query(
      'UPDATE promo_tools SET winner_code_id = $1, drawn_at = NOW(), updated_at = NOW() WHERE id = $2',
      [codeId, id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Ganador registrado', winner: codeRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error registrando ganador:', err);
    res.status(500).json({ error: 'No se pudo registrar el ganador' });
  } finally {
    client.release();
  }
});

module.exports = router;
