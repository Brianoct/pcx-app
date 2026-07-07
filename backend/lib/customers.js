const { pool } = require('../db');
const { createHttpError } = require('./util');

const CUSTOMER_PIPELINE_STAGES = ['contactado', 'cotizado', 'negociando', 'cliente', 'inactivo'];

const normalizeCustomerPhone = (value = '') => String(value || '').replace(/\D/g, '');

const trimOrNull = (value, max = 160) => {
  const str = String(value ?? '').trim();
  if (!str) return null;
  return str.slice(0, max);
};

const normalizePipelineStage = (value) => {
  const stage = String(value || '').trim().toLowerCase();
  if (!stage) return null;
  if (!CUSTOMER_PIPELINE_STAGES.includes(stage)) {
    throw createHttpError(400, `Etapa inválida. Usa: ${CUSTOMER_PIPELINE_STAGES.join(', ')}`);
  }
  return stage;
};

// pg returns DATE columns as Date objects; format as YYYY-MM-DD for the UI.
const formatDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  return str ? str.slice(0, 10) : null;
};

const buildCustomerRow = (row = {}) => ({
  id: Number(row.id),
  name: row.name,
  phone: row.phone || null,
  phone_normalized: row.phone_normalized || null,
  email: row.email || null,
  department: row.department || null,
  provincia: row.provincia || null,
  address: row.address || null,
  pipeline_stage: row.pipeline_stage || 'contactado',
  follow_up_at: formatDateOnly(row.follow_up_at),
  follow_up_note: row.follow_up_note || null,
  assigned_vendor: row.assigned_vendor || null,
  assigned_user_id: row.assigned_user_id !== null && row.assigned_user_id !== undefined ? Number(row.assigned_user_id) : null,
  owner_name: row.owner_name !== undefined ? (row.owner_name || null) : undefined,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  quotes_count: row.quotes_count !== undefined ? Number(row.quotes_count || 0) : undefined,
  total_spent: row.total_spent !== undefined ? Number(row.total_spent || 0) : undefined,
  last_quote_at: row.last_quote_at !== undefined ? (row.last_quote_at || null) : undefined,
  last_store_location: row.last_store_location !== undefined ? (row.last_store_location || null) : undefined
});

// Called whenever a quote is created/edited: keeps the customer book current
// without any extra typing from the seller. Never throws — a CRM hiccup must
// not block a sale.
const upsertCustomerFromQuote = async ({ name, phone, department, provincia, vendor, userId }) => {
  try {
    const phoneNormalized = normalizeCustomerPhone(phone);
    const safeName = trimOrNull(name, 160);
    if (!phoneNormalized || !safeName) return null;
    const result = await pool.query(
      `INSERT INTO customers (name, phone, phone_normalized, department, provincia, assigned_vendor, assigned_user_id, pipeline_stage, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'cotizado', $7)
       ON CONFLICT (phone_normalized) WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
       DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         department = COALESCE(EXCLUDED.department, customers.department),
         provincia = COALESCE(EXCLUDED.provincia, customers.provincia),
         assigned_vendor = COALESCE(customers.assigned_vendor, EXCLUDED.assigned_vendor),
         -- First rep to attend the customer becomes the owner; never stolen by
         -- a later upsert.
         assigned_user_id = COALESCE(customers.assigned_user_id, EXCLUDED.assigned_user_id),
         pipeline_stage = CASE
           WHEN customers.pipeline_stage IN ('contactado', 'inactivo') THEN 'cotizado'
           ELSE customers.pipeline_stage
         END,
         updated_at = NOW()
       RETURNING id`,
      [
        safeName,
        trimOrNull(phone, 40),
        phoneNormalized,
        trimOrNull(department, 120),
        trimOrNull(provincia, 120),
        trimOrNull(vendor, 120),
        userId || null
      ]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    console.warn('CRM upsert desde cotización falló (no bloqueante):', err.message);
    return null;
  }
};

// Find the owning rep for a phone number. WhatsApp numbers carry the country
// code (591…) while customers usually store the local number, so we match on
// the last 8 digits (Bolivian local length).
const findCustomerOwnerByPhone = async (phone, db = pool) => {
  const digits = normalizeCustomerPhone(phone);
  if (digits.length < 7) return null;
  const result = await db.query(
    `SELECT c.id AS customer_id, c.name, c.assigned_user_id,
            u.display_name AS owner_display_name, u.email AS owner_email, u.is_active AS owner_active
     FROM customers c
     LEFT JOIN users u ON u.id = c.assigned_user_id
     WHERE c.phone_normalized <> ''
       AND RIGHT(c.phone_normalized, 8) = RIGHT($1, 8)
     ORDER BY c.id ASC
     LIMIT 1`,
    [digits]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    customer_id: Number(row.customer_id),
    customer_name: row.name,
    owner_user_id: row.assigned_user_id !== null ? Number(row.assigned_user_id) : null,
    owner_name: String(row.owner_display_name || '').trim() || String(row.owner_email || '').split('@')[0] || null,
    owner_active: Boolean(row.owner_active)
  };
};

module.exports = {
  CUSTOMER_PIPELINE_STAGES,
  buildCustomerRow,
  findCustomerOwnerByPhone,
  normalizeCustomerPhone,
  normalizePipelineStage,
  trimOrNull,
  upsertCustomerFromQuote
};
