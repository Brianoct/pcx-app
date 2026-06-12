const { pool } = require('../db');
const { ensureQcProductSettingsSeeded } = require('./qc');
const { buildDateFilter } = require('./reporting');
const { clampPercent } = require('./util');

const COMMISSION_SETTINGS_DEFAULT = {
  ventas_lider_percent: 5,
  ventas_top_percent: 12,
  ventas_regular_percent: 8,
  almacen_percent: 5,
  marketing_lider_percent: 5
};

const COMMISSION_SETTINGS_KEYS = Object.keys(COMMISSION_SETTINGS_DEFAULT);

const sanitizeCommissionSettings = (raw = {}) => {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    ventas_lider_percent: clampPercent(src.ventas_lider_percent, COMMISSION_SETTINGS_DEFAULT.ventas_lider_percent),
    ventas_top_percent: clampPercent(src.ventas_top_percent, COMMISSION_SETTINGS_DEFAULT.ventas_top_percent),
    ventas_regular_percent: clampPercent(src.ventas_regular_percent, COMMISSION_SETTINGS_DEFAULT.ventas_regular_percent),
    almacen_percent: clampPercent(src.almacen_percent, COMMISSION_SETTINGS_DEFAULT.almacen_percent),
    marketing_lider_percent: clampPercent(src.marketing_lider_percent, COMMISSION_SETTINGS_DEFAULT.marketing_lider_percent)
  };
};

const loadCommissionSettings = async () => {
  try {
    // Modern schema with JSON settings.
    const jsonResult = await pool.query(
      `SELECT settings
       FROM commission_settings
       LIMIT 1`
    );
    if (jsonResult.rowCount > 0) {
      return sanitizeCommissionSettings(jsonResult.rows[0]?.settings || {});
    }
    return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
  } catch (err) {
    // Missing table: return defaults without breaking nav commission.
    if (err?.code === '42P01') {
      console.warn('commission_settings no existe; usando configuración por defecto');
      return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
    }

    // Legacy schema without JSON column.
    if (err?.code === '42703') {
      try {
        const legacyResult = await pool.query(
          `SELECT ventas_lider_percent, ventas_top_percent, ventas_regular_percent, almacen_percent, marketing_lider_percent
           FROM commission_settings
           LIMIT 1`
        );
        if (legacyResult.rowCount === 0) {
          return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
        }
        return sanitizeCommissionSettings(legacyResult.rows[0] || {});
      } catch (legacyErr) {
        if (legacyErr?.code === '42P01') {
          return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
        }
        console.warn('No se pudo leer comisión desde esquema legacy; usando defaults:', legacyErr.message);
        return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
      }
    }

    // Do not block user commission UI on unexpected DB edge cases.
    console.warn('No se pudo leer commission_settings; usando defaults:', err.message);
    return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
  }
};

const saveCommissionSettings = async (settings) => {
  const next = sanitizeCommissionSettings(settings);
  try {
    // Ensure modern JSON-based shape exists.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS commission_settings (
         id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
         settings JSONB NOT NULL DEFAULT '{}'::jsonb,
         updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
       )`
    );
    await pool.query(
      `ALTER TABLE commission_settings
       ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`
    );
    await pool.query(
      `ALTER TABLE commission_settings
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
    );

    const upsertResult = await pool.query(
      `WITH updated AS (
         UPDATE commission_settings
         SET settings = $1::jsonb,
             updated_at = NOW()
         RETURNING 1
       )
       INSERT INTO commission_settings (settings, updated_at)
       SELECT $1::jsonb, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM updated)`,
      [JSON.stringify(next)]
    );
    void upsertResult;
    return next;
  } catch (err) {
    // Legacy fallback: update direct percent columns when JSON migration is unavailable.
    if (err?.code !== '42703' && err?.code !== '42P01') {
      throw err;
    }
    const setParts = COMMISSION_SETTINGS_KEYS.map((key, index) => `${key} = $${index + 1}`);
    const params = COMMISSION_SETTINGS_KEYS.map((key) => next[key]);
    try {
      const updateLegacy = await pool.query(
        `UPDATE commission_settings
         SET ${setParts.join(', ')}`,
        params
      );
      if (updateLegacy.rowCount === 0) {
        await pool.query(
          `INSERT INTO commission_settings (${COMMISSION_SETTINGS_KEYS.join(', ')})
           VALUES (${COMMISSION_SETTINGS_KEYS.map((_, index) => `$${index + 1}`).join(', ')})`,
          params
        );
      }
      return next;
    } catch (legacyErr) {
      throw legacyErr;
    }
  }
};

const computeQualityControlCommissionTotal = async (month, year) => {
  await ensureQcProductSettingsSeeded();
  const qcDateFilter = buildDateFilter(month, year, 'r', 2);
  if (qcDateFilter.error) return { error: qcDateFilter.error };

  const result = await pool.query(
    `SELECT COALESCE(
       SUM(
         r.quantity * (COALESCE(s.base_price, 0) * COALESCE(s.commission_rate, 0) / 100.0)
       ),
       0
     ) AS total_commission
     FROM quality_control_records r
     LEFT JOIN quality_control_settings s ON UPPER(s.sku) = UPPER(r.sku)
     WHERE r.result = $1${qcDateFilter.sql}`,
    ['passed', ...qcDateFilter.params]
  );
  return { total: Number(result.rows[0]?.total_commission || 0) };
};

module.exports = {
  COMMISSION_SETTINGS_DEFAULT,
  COMMISSION_SETTINGS_KEYS,
  computeQualityControlCommissionTotal,
  loadCommissionSettings,
  sanitizeCommissionSettings,
  saveCommissionSettings
};
