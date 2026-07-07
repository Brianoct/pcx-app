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
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  quotes_count: row.quotes_count !== undefined ? Number(row.quotes_count || 0) : undefined,
  total_spent: row.total_spent !== undefined ? Number(row.total_spent || 0) : undefined,
  last_quote_at: row.last_quote_at !== undefined ? (row.last_quote_at || null) : undefined
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
      `INSERT INTO customers (name, phone, phone_normalized, department, provincia, assigned_vendor, pipeline_stage, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'cotizado', $7)
       ON CONFLICT (phone_normalized) WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
       DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         department = COALESCE(EXCLUDED.department, customers.department),
         provincia = COALESCE(EXCLUDED.provincia, customers.provincia),
         assigned_vendor = COALESCE(EXCLUDED.assigned_vendor, customers.assigned_vendor),
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

module.exports = {
  CUSTOMER_PIPELINE_STAGES,
  buildCustomerRow,
  normalizeCustomerPhone,
  normalizePipelineStage,
  trimOrNull,
  upsertCustomerFromQuote
};
