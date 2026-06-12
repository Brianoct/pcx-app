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

const loadQcSettingsMap = async () => {
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
  loadQcSettingsMap,
  normalizeQcResult
};
