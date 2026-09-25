const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { CUSTOMER_PIPELINE_STAGES, buildCustomerRow, normalizeCustomerPhone, normalizePipelineStage, trimOrNull } = require('../lib/customers');
const { ROLE_KEYS, normalizeRole, sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const { createHttpError } = require('../lib/util');

const router = express.Router();

// CRM: quien cotiza (o maneja cotizaciones) lo usa completo. Marketing entra
// en modo LECTURA (clientes_lectura): filtra y exporta, no edita nada.
const resolveCrmScope = (userContext) => {
  if (normalizeRole(userContext.role || '') === ROLE_KEYS.admin) return 'full';
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (access.cotizar || access.historial_global || access.historial_individual || access.pedidos_global) return 'full';
  if (access.clientes_lectura) return 'read';
  return null;
};

const ensureCrmAccess = async (req, res, { write = false } = {}) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  const scope = resolveCrmScope(userContext);
  if (!scope) {
    res.status(403).json({ error: 'No tienes acceso a clientes' });
    return null;
  }
  if (write && scope !== 'full') {
    res.status(403).json({ error: 'Tu acceso a clientes es solo de lectura' });
    return null;
  }
  return { ...userContext, crm_scope: scope };
};

const QUOTES_BY_PHONE_JOIN = `regexp_replace(COALESCE(q.customer_phone, ''), '\\D', '', 'g') = c.phone_normalized
      AND c.phone_normalized IS NOT NULL AND c.phone_normalized <> ''`;

const CUSTOMER_LIST_SELECT = `
  SELECT c.*, s.quotes_count, s.total_spent, s.last_quote_at, s.last_store_location,
         s.paid_count, s.last_paid_at, l.acero_total, l.armonia_total, l.acero_items, l.armonia_items,
         COALESCE(NULLIF(TRIM(owner.display_name), ''), split_part(owner.email, '@', 1)) AS owner_name
  FROM customers c
  LEFT JOIN users owner ON owner.id = c.assigned_user_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS quotes_count,
           COALESCE(SUM(CASE WHEN q.status IN ('Pagado', 'Embalado', 'Enviado') THEN q.total ELSE 0 END), 0) AS total_spent,
           MAX(q.created_at) AS last_quote_at,
           (array_agg(q.store_location ORDER BY q.created_at DESC))[1] AS last_store_location,
           COUNT(*) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado'))::int AS paid_count,
           MAX(q.created_at) FILTER (WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')) AS last_paid_at
    FROM quotes q
    WHERE ${QUOTES_BY_PHONE_JOIN}
  ) s ON TRUE
  -- Líneas compradas: se derivan de las cotizaciones pagadas (SKU → línea del
  -- producto). Nadie las escribe a mano; así Marketing filtra sin etiquetar.
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(COALESCE((li->>'lineTotal')::numeric, 0)) FILTER (WHERE LOWER(p.product_line) = 'acero'), 0) AS acero_total,
           COALESCE(SUM(COALESCE((li->>'lineTotal')::numeric, 0)) FILTER (WHERE LOWER(p.product_line) LIKE 'armon%'), 0) AS armonia_total,
           COUNT(*) FILTER (WHERE LOWER(p.product_line) = 'acero')::int AS acero_items,
           COUNT(*) FILTER (WHERE LOWER(p.product_line) LIKE 'armon%')::int AS armonia_items
    FROM quotes q
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(q.line_items) = 'array' THEN q.line_items ELSE '[]'::jsonb END) li
    LEFT JOIN products p ON UPPER(p.sku) = UPPER(TRIM(li->>'sku'))
    WHERE ${QUOTES_BY_PHONE_JOIN}
      AND q.status IN ('Pagado', 'Embalado', 'Enviado')
  ) l ON TRUE`;

// Filtros de Marketing sobre la lista: línea comprada, última compra y ciudad.
// (Columnas sin alias: valen tanto en la consulta principal como sobre la
// subconsulta del resumen.)
const LINE_FILTERS = {
  acero: 'acero_items > 0',
  armonia: 'armonia_items > 0',
  both: 'acero_items > 0 AND armonia_items > 0',
  none: 'COALESCE(paid_count, 0) = 0'
};
const RECENCY_FILTERS = {
  '30': "last_paid_at >= NOW() - INTERVAL '30 days'",
  '90': "last_paid_at >= NOW() - INTERVAL '90 days'",
  '60plus': "last_paid_at IS NOT NULL AND last_paid_at < NOW() - INTERVAL '60 days'"
};

router.get('/api/customers', authenticateToken, async (req, res) => {
  const userContext = await ensureCrmAccess(req, res);
  if (!userContext) return;
  try {
    const params = [];
    const where = [];
    const search = String(req.query.search || '').trim();
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const nameIdx = params.length;
      const phoneDigits = normalizeCustomerPhone(search);
      if (phoneDigits) {
        params.push(`%${phoneDigits}%`);
        where.push(`(LOWER(c.name) LIKE $${nameIdx} OR c.phone_normalized LIKE $${params.length})`);
      } else {
        where.push(`LOWER(c.name) LIKE $${nameIdx}`);
      }
    }
    const stage = String(req.query.stage || '').trim().toLowerCase();
    if (stage && CUSTOMER_PIPELINE_STAGES.includes(stage)) {
      params.push(stage);
      where.push(`c.pipeline_stage = $${params.length}`);
    }
    if (String(req.query.due || '') === '1') {
      where.push("c.follow_up_at IS NOT NULL AND c.follow_up_at <= (NOW() AT TIME ZONE 'America/La_Paz')::date");
    }
    const line = String(req.query.line || '').trim().toLowerCase();
    if (LINE_FILTERS[line]) where.push(`(${LINE_FILTERS[line]})`);
    const recency = String(req.query.recency || '').trim().toLowerCase();
    if (RECENCY_FILTERS[recency]) where.push(`(${RECENCY_FILTERS[recency]})`);
    const city = String(req.query.city || '').trim();
    if (city) {
      params.push(`%${city.toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(c.ciudad, '')) LIKE $${params.length} OR LOWER(COALESCE(c.department, '')) LIKE $${params.length} OR LOWER(COALESCE(c.provincia, '')) LIKE $${params.length})`);
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 1000);
    const result = await pool.query(
      `${CUSTOMER_LIST_SELECT}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (c.follow_up_at IS NOT NULL AND c.follow_up_at <= (NOW() AT TIME ZONE 'America/La_Paz')::date) DESC,
                s.last_quote_at DESC NULLS LAST,
                c.updated_at DESC
       LIMIT ${limit}`,
      params
    );
    const [dueRes, summaryRes] = await Promise.all([
      pool.query(
        "SELECT COUNT(*)::int AS due FROM customers WHERE follow_up_at IS NOT NULL AND follow_up_at <= (NOW() AT TIME ZONE 'America/La_Paz')::date"
      ),
      // Resumen de toda la cartera (sin filtros) para las fichas de arriba.
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${LINE_FILTERS.acero})::int AS acero,
                COUNT(*) FILTER (WHERE ${LINE_FILTERS.armonia})::int AS armonia,
                COUNT(*) FILTER (WHERE ${LINE_FILTERS.both})::int AS both,
                COUNT(*) FILTER (WHERE ${RECENCY_FILTERS['60plus']})::int AS reactivar
         FROM (${CUSTOMER_LIST_SELECT}) x`
      )
    ]);
    res.json({
      customers: result.rows.map(buildCustomerRow),
      follow_ups_due: Number(dueRes.rows[0]?.due || 0),
      scope: userContext.crm_scope,
      summary: {
        total: Number(summaryRes.rows[0]?.total || 0),
        acero: Number(summaryRes.rows[0]?.acero || 0),
        armonia: Number(summaryRes.rows[0]?.armonia || 0),
        both: Number(summaryRes.rows[0]?.both || 0),
        reactivar: Number(summaryRes.rows[0]?.reactivar || 0)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar clientes' });
  }
});

// ─── Embudo de ventas (estilo Pipedrive) ─────────────────────────────────────
// Probabilidad de cierre por etapa: alimenta el pronóstico ponderado.
const STAGE_PROBABILITY = { contactado: 0.10, cotizado: 0.35, negociando: 0.60 };
const OPEN_STAGES = ['contactado', 'cotizado', 'negociando'];

// Board data: every open deal, plus this month's won/lost. Registered BEFORE
// /api/customers/:id so "pipeline" is not parsed as an id.
router.get('/api/customers/pipeline', authenticateToken, async (req, res) => {
  const userContext = await ensureCrmAccess(req, res);
  if (!userContext) return;
  try {
    const result = await pool.query(
      `SELECT c.*,
              COALESCE(NULLIF(TRIM(owner.display_name), ''), split_part(owner.email, '@', 1)) AS owner_name,
              s.open_value, s.paid_month_value, s.last_quote_at, n.last_note_at
       FROM customers c
       LEFT JOIN users owner ON owner.id = c.assigned_user_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(CASE WHEN q.status IN ('Cotizado', 'Confirmado') THEN q.total ELSE 0 END), 0) AS open_value,
                COALESCE(SUM(CASE WHEN q.status IN ('Pagado', 'Embalado', 'Enviado')
                                   AND (q.created_at AT TIME ZONE 'America/La_Paz') >= date_trunc('month', NOW() AT TIME ZONE 'America/La_Paz')
                                  THEN q.total ELSE 0 END), 0) AS paid_month_value,
                MAX(q.created_at) AS last_quote_at
         FROM quotes q
         WHERE ${QUOTES_BY_PHONE_JOIN}
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(created_at) AS last_note_at FROM customer_notes WHERE customer_id = c.id
       ) n ON TRUE
       WHERE c.pipeline_stage IN ('contactado', 'cotizado', 'negociando')
          OR (c.pipeline_stage IN ('cliente', 'perdido')
              AND (c.stage_changed_at AT TIME ZONE 'America/La_Paz') >= date_trunc('month', NOW() AT TIME ZONE 'America/La_Paz'))
       ORDER BY (c.follow_up_at IS NOT NULL AND c.follow_up_at <= (NOW() AT TIME ZONE 'America/La_Paz')::date) DESC,
                s.open_value DESC, c.updated_at DESC
       LIMIT 400`
    );

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    today.setHours(0, 0, 0, 0);
    const cards = result.rows.map((row) => {
      const base = buildCustomerRow(row);
      const lastActivity = [row.stage_changed_at, row.updated_at, row.last_note_at, row.last_quote_at]
        .filter(Boolean).map((d) => new Date(d).getTime());
      const lastActivityAt = lastActivity.length ? new Date(Math.max(...lastActivity)) : null;
      return {
        id: base.id,
        name: base.name,
        phone: base.phone,
        pipeline_stage: base.pipeline_stage,
        owner_name: base.owner_name || base.assigned_vendor || null,
        follow_up_at: base.follow_up_at,
        follow_up_note: base.follow_up_note,
        lost_reason: base.lost_reason,
        open_value: Number(row.open_value || 0),
        paid_month_value: Number(row.paid_month_value || 0),
        days_in_stage: row.stage_changed_at
          ? Math.max(0, Math.floor((Date.now() - new Date(row.stage_changed_at).getTime()) / 86400000))
          : 0,
        days_since_activity: lastActivityAt
          ? Math.max(0, Math.floor((Date.now() - lastActivityAt.getTime()) / 86400000))
          : null
      };
    });

    const summary = { stages: {}, open_count: 0, open_value: 0, weighted_forecast: 0, sin_siguiente_paso: 0, vencidas: 0 };
    for (const stage of OPEN_STAGES) summary.stages[stage] = { count: 0, value: 0, probability: STAGE_PROBABILITY[stage] };
    let wonCount = 0; let wonValue = 0; let lostCount = 0; let lostValue = 0;
    const todayStr = today.toISOString().slice(0, 10);
    for (const card of cards) {
      if (OPEN_STAGES.includes(card.pipeline_stage)) {
        const bucket = summary.stages[card.pipeline_stage];
        bucket.count += 1;
        bucket.value += card.open_value;
        summary.open_count += 1;
        summary.open_value += card.open_value;
        summary.weighted_forecast += card.open_value * STAGE_PROBABILITY[card.pipeline_stage];
        if (!card.follow_up_at) summary.sin_siguiente_paso += 1;
        else if (card.follow_up_at < todayStr) summary.vencidas += 1;
      } else if (card.pipeline_stage === 'cliente') {
        wonCount += 1; wonValue += card.paid_month_value || card.open_value;
      } else if (card.pipeline_stage === 'perdido') {
        lostCount += 1; lostValue += card.open_value;
      }
    }
    summary.won_month = { count: wonCount, value: wonValue };
    summary.lost_month = { count: lostCount, value: lostValue };
    summary.win_rate = (wonCount + lostCount) > 0 ? wonCount / (wonCount + lostCount) : null;
    summary.weighted_forecast = Math.round(summary.weighted_forecast);

    res.json({ cards, summary, probabilities: STAGE_PROBABILITY });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el embudo' });
  }
});

router.get('/api/customers/:id', authenticateToken, async (req, res) => {
  const userContext = await ensureCrmAccess(req, res);
  if (!userContext) return;
  try {
    const customerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    const customerRes = await pool.query(
      `${CUSTOMER_LIST_SELECT} WHERE c.id = $1`,
      [customerId]
    );
    if (customerRes.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    const customer = buildCustomerRow(customerRes.rows[0]);

    const [notesRes, quotesRes] = await Promise.all([
      pool.query(
        `SELECT n.id, n.note, n.created_at, u.display_name, u.email
         FROM customer_notes n
         LEFT JOIN users u ON u.id = n.created_by
         WHERE n.customer_id = $1
         ORDER BY n.created_at DESC
         LIMIT 50`,
        [customerId]
      ),
      customer.phone_normalized
        ? pool.query(
          `SELECT q.id, q.status, q.total, q.store_location, q.vendor, q.created_at,
                  (SELECT COALESCE(array_agg(DISTINCT LOWER(p.product_line)) FILTER (WHERE p.product_line IS NOT NULL), '{}')
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.line_items) = 'array' THEN q.line_items ELSE '[]'::jsonb END) li
                   LEFT JOIN products p ON UPPER(p.sku) = UPPER(TRIM(li->>'sku'))) AS lines
           FROM quotes q
           JOIN customers c ON c.id = $1
           WHERE ${QUOTES_BY_PHONE_JOIN}
           ORDER BY q.created_at DESC
           LIMIT 20`,
          [customerId]
        )
        : Promise.resolve({ rows: [] })
    ]);

    res.json({
      customer,
      notes: notesRes.rows.map((row) => ({
        id: Number(row.id),
        note: row.note,
        created_at: row.created_at,
        author: String(row.display_name || '').trim() || String(row.email || '').split('@')[0] || null
      })),
      quotes: quotesRes.rows.map((row) => ({
        id: Number(row.id),
        status: row.status,
        total: Number(row.total || 0),
        store_location: row.store_location,
        vendor: row.vendor || null,
        created_at: row.created_at,
        lines: Array.isArray(row.lines) ? row.lines.map((l) => (String(l).startsWith('armon') ? 'armonia' : String(l))) : []
      })),
      scope: userContext.crm_scope
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el cliente' });
  }
});

const parseCustomerPayload = (body = {}, { partial = false } = {}) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const out = {};
  if (has('name') || !partial) {
    const name = trimOrNull(body.name, 160);
    if (!name) throw createHttpError(400, 'Nombre requerido');
    out.name = name;
  }
  if (has('phone') || !partial) {
    out.phone = trimOrNull(body.phone, 40);
    out.phone_normalized = normalizeCustomerPhone(out.phone || '') || null;
  }
  if (has('email')) out.email = trimOrNull(body.email, 160);
  if (has('department')) out.department = trimOrNull(body.department, 120);
  if (has('provincia')) out.provincia = trimOrNull(body.provincia, 120);
  if (has('ciudad')) out.ciudad = trimOrNull(body.ciudad, 120);
  if (has('address')) out.address = trimOrNull(body.address, 240);
  if (has('assigned_vendor')) out.assigned_vendor = trimOrNull(body.assigned_vendor, 120);
  if (has('pipeline_stage')) {
    const stage = normalizePipelineStage(body.pipeline_stage);
    if (stage) out.pipeline_stage = stage;
  }
  if (has('follow_up_at')) {
    const raw = trimOrNull(body.follow_up_at, 10);
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw createHttpError(400, 'Fecha de seguimiento inválida (AAAA-MM-DD)');
    }
    out.follow_up_at = raw;
  }
  if (has('follow_up_note')) out.follow_up_note = trimOrNull(body.follow_up_note, 300);
  if (has('lost_reason')) out.lost_reason = trimOrNull(body.lost_reason, 200);
  if (has('assigned_user_id')) {
    if (body.assigned_user_id === null || body.assigned_user_id === '') {
      out.assigned_user_id = null;
    } else {
      const ownerId = Number.parseInt(body.assigned_user_id, 10);
      if (!Number.isInteger(ownerId) || ownerId <= 0) {
        throw createHttpError(400, 'Vendedor asignado inválido');
      }
      out.assigned_user_id = ownerId;
    }
  }
  return out;
};

router.post('/api/customers', authenticateToken, async (req, res) => {
  const userContext = await ensureCrmAccess(req, res, { write: true });
  if (!userContext) return;
  try {
    const data = parseCustomerPayload(req.body || {});
    if (data.phone_normalized) {
      const dupRes = await pool.query(
        'SELECT id FROM customers WHERE phone_normalized = $1',
        [data.phone_normalized]
      );
      if (dupRes.rowCount > 0) {
        return res.status(409).json({ error: 'Ya existe un cliente con ese teléfono', customer_id: Number(dupRes.rows[0].id) });
      }
    }
    const result = await pool.query(
      `INSERT INTO customers (name, phone, phone_normalized, email, department, provincia, ciudad, address, assigned_vendor, pipeline_stage, follow_up_at, follow_up_note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'contactado'), $11, $12, $13)
       RETURNING *`,
      [
        data.name, data.phone, data.phone_normalized, data.email || null,
        data.department || null, data.provincia || null, data.ciudad || null, data.address || null,
        data.assigned_vendor || null, data.pipeline_stage || null,
        data.follow_up_at || null, data.follow_up_note || null, req.user.id
      ]
    );
    res.status(201).json({ message: 'Cliente creado', customer: buildCustomerRow(result.rows[0]) });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el cliente' });
  }
});

router.patch('/api/customers/:id', authenticateToken, async (req, res) => {
  const userContext = await ensureCrmAccess(req, res, { write: true });
  if (!userContext) return;
  try {
    const customerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    const data = parseCustomerPayload(req.body || {}, { partial: true });
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ error: 'No se enviaron cambios' });

    const sets = [];
    const values = [];
    for (const key of keys) {
      values.push(data[key]);
      sets.push(`${key} = $${values.length}`);
      // Track when the deal entered its current stage (rot alerts + win rate),
      // and clear the lost reason when it leaves Perdido.
      if (key === 'pipeline_stage') {
        sets.push(`stage_changed_at = CASE WHEN customers.pipeline_stage IS DISTINCT FROM $${values.length} THEN NOW() ELSE customers.stage_changed_at END`);
        if (data.pipeline_stage !== 'perdido' && !Object.prototype.hasOwnProperty.call(data, 'lost_reason')) {
          sets.push(`lost_reason = CASE WHEN $${values.length} = 'perdido' THEN customers.lost_reason ELSE NULL END`);
        }
      }
    }
    values.push(customerId);
    const result = await pool.query(
      `UPDATE customers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ message: 'Cliente actualizado', customer: buildCustomerRow(result.rows[0]) });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'Ya existe un cliente con ese teléfono' });
    if (err?.code === '23503') return res.status(400).json({ error: 'Vendedor asignado no existe' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el cliente' });
  }
});

router.post('/api/customers/:id/notes', authenticateToken, async (req, res) => {
  const userContext = await ensureCrmAccess(req, res, { write: true });
  if (!userContext) return;
  try {
    const customerId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    const note = trimOrNull(req.body?.note, 1000);
    if (!note) return res.status(400).json({ error: 'La nota no puede estar vacía' });
    const result = await pool.query(
      `INSERT INTO customer_notes (customer_id, note, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, note, created_at`,
      [customerId, note, req.user.id]
    );
    res.status(201).json({
      message: 'Nota agregada',
      note: {
        id: Number(result.rows[0].id),
        note: result.rows[0].note,
        created_at: result.rows[0].created_at,
        author: String(userContext.display_name || '').trim() || String(userContext.email || '').split('@')[0]
      }
    });
  } catch (err) {
    if (err?.code === '23503') return res.status(404).json({ error: 'Cliente no encontrado' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo agregar la nota' });
  }
});

module.exports = router;
