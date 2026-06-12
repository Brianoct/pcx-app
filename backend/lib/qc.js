const { pool } = require('../db');
const { loadProductCatalogRows } = require('./products');
const { normalizeText } = require('./rbac');

const normalizeQcResult = (value = '') => {
  const normalized = normalizeText(value).replace(/-/g, '_');
  const map = {
    passed: 'passed',
    pass: 'passed',
    aprobado: 'passed',
    ok: 'passed',
    accepted: 'passed',
    rejected: 'rejected',
    reject: 'rejected',
    rechazado: 'rejected',
    fail: 'rejected',
    failed: 'rejected'
  };
  return map[normalized] || null;
};

const ensureQcTables = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS quality_control_settings (
       sku TEXT PRIMARY KEY,
       base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
       commission_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     )`
  );
  await pool.query(
    `ALTER TABLE quality_control_settings
     ADD COLUMN IF NOT EXISTS base_price NUMERIC(12,2) NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE quality_control_settings
     ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(10,4) NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE quality_control_settings
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS quality_control_records (
       id BIGSERIAL PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       sku TEXT NOT NULL,
       product_name TEXT NOT NULL,
       quantity INTEGER NOT NULL CHECK (quantity > 0),
       result TEXT NOT NULL CHECK (result IN ('passed', 'rejected')),
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_quality_control_records_created_at
     ON quality_control_records (created_at)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_quality_control_records_user_id
     ON quality_control_records (user_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_quality_control_records_sku
     ON quality_control_records (sku)`
  );
};

const loadQcSettingsMap = async () => {
  await ensureQcTables();
  const settingsRes = await pool.query(
    `SELECT sku, base_price, commission_rate
     FROM quality_control_settings`
  );
  const map = new Map();
  for (const row of settingsRes.rows) {
    map.set(String(row.sku || '').toUpperCase(), {
      base_price: Number(row.base_price || 0),
      commission_rate: Number(row.commission_rate || 0)
    });
  }
  return map;
};

const ensureQcProductSettingsSeeded = async () => {
  await ensureQcTables();
  const catalogRows = await loadProductCatalogRows();
  for (const item of catalogRows) {
    await pool.query(
      `INSERT INTO quality_control_settings (sku, base_price, commission_rate)
       VALUES ($1, $2, 0)
       ON CONFLICT (sku) DO UPDATE
       SET base_price = CASE
         WHEN quality_control_settings.base_price IS NULL OR quality_control_settings.base_price = 0
           THEN EXCLUDED.base_price
         ELSE quality_control_settings.base_price
       END`,
      [item.sku, Number(item.sf || item.sf_price || 0)]
    );
  }
};

module.exports = {
  ensureQcProductSettingsSeeded,
  ensureQcTables,
  loadQcSettingsMap,
  normalizeQcResult
};
