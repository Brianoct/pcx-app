const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const normalizeText = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
const normalizeRole = (value = '') => normalizeText(value);
const COMPLETED_STATUSES = ['Confirmado', 'Pagado', 'Embalado', 'Enviado'];
const PANEL_KEYS = [
  'cotizar',
  'calendario',
  'historial_individual',
  'historial_global',
  'rendimiento_individual',
  'rendimiento_global',
  'pedidos_individual',
  'pedidos_global',
  'inventario_individual',
  'inventario_global',
  'control_calidad',
  'microfabrica_panel',
  'marketing_combos',
  'marketing_cupones',
  'admin'
];

const getDefaultPanelAccessForRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  const base = {
    cotizar: false,
    calendario: false,
    historial_individual: false,
    historial_global: false,
    rendimiento_individual: false,
    rendimiento_global: false,
    pedidos_individual: false,
    pedidos_global: false,
    inventario_individual: false,
    inventario_global: false,
    control_calidad: false,
    microfabrica_panel: false,
    marketing_combos: false,
    marketing_cupones: false,
    admin: false
  };

  if (role === 'admin') {
    return Object.fromEntries(Object.keys(base).map((key) => [key, true]));
  }

  if (role === 'ventas') {
    return {
      ...base,
      cotizar: true,
      calendario: true,
      historial_individual: true,
      rendimiento_individual: true
    };
  }

  if (role === 'ventas lider') {
    return {
      ...base,
      cotizar: true,
      calendario: true,
      historial_global: true,
      rendimiento_global: true
    };
  }

  if (role === 'almacen') {
    return {
      ...base,
      cotizar: true,
      calendario: true,
      pedidos_individual: true,
      inventario_individual: true
    };
  }

  if (role === 'almacen lider') {
    return {
      ...base,
      cotizar: true,
      calendario: true,
      pedidos_global: true,
      inventario_global: true,
      control_calidad: true
    };
  }

  if (role === 'marketing') {
    return {
      ...base,
      calendario: true,
      marketing_combos: true,
      marketing_cupones: true
    };
  }

  if (role === 'marketing lider') {
    return {
      ...base,
      calendario: true,
      marketing_combos: true,
      marketing_cupones: true
    };
  }

  if (role === 'microfabrica lider' || role === 'microfabrica') {
    return {
      ...base,
      calendario: true,
      microfabrica_panel: true
    };
  }

  return base;
};

const DEFAULT_ROLE_ACCESS = {
  Ventas: getDefaultPanelAccessForRole('Ventas'),
  'Ventas Lider': getDefaultPanelAccessForRole('Ventas Lider'),
  Almacen: getDefaultPanelAccessForRole('Almacen'),
  'Almacen Lider': getDefaultPanelAccessForRole('Almacen Lider'),
  'Microfabrica Lider': getDefaultPanelAccessForRole('Microfabrica Lider'),
  Microfabrica: getDefaultPanelAccessForRole('Microfabrica'),
  Marketing: getDefaultPanelAccessForRole('Marketing'),
  'Marketing Lider': getDefaultPanelAccessForRole('Marketing Lider'),
  Admin: getDefaultPanelAccessForRole('Admin')
};

const sanitizePanelAccess = (panelAccess, roleValue = '') => {
  const defaults = getDefaultPanelAccessForRole(roleValue);
  const normalizedRole = normalizeRole(roleValue);
  const forceWarehouseQuote = normalizedRole === 'almacen' || normalizedRole === 'almacen lider';
  if (!panelAccess || typeof panelAccess !== 'object' || Array.isArray(panelAccess)) {
    if (forceWarehouseQuote) return { ...defaults, cotizar: true };
    return defaults;
  }

  const sanitized = Object.fromEntries(
    PANEL_KEYS.map((key) => [key, Boolean(panelAccess[key] ?? defaults[key])])
  );
  if (forceWarehouseQuote) sanitized.cotizar = true;
  return sanitized;
};

const canAccessPanel = (panelAccess, roleValue, key) => {
  const normalizedRole = normalizeRole(roleValue);
  if (key === 'cotizar' && (normalizedRole === 'almacen' || normalizedRole === 'almacen lider')) {
    return true;
  }
  const effective = sanitizePanelAccess(panelAccess, roleValue);
  return Boolean(effective[key]);
};

const ROLE_DEFAULT_ROLES = [
  'Ventas',
  'Ventas Lider',
  'Almacen',
  'Almacen Lider',
  'Microfabrica Lider',
  'Microfabrica',
  'Marketing',
  'Marketing Lider',
  'Admin'
];

const ROLE_KEYS = {
  admin: 'admin',
  ventasLider: 'ventas lider',
  ventas: 'ventas',
  almacenLider: 'almacen lider',
  almacen: 'almacen',
  marketingLider: 'marketing lider',
  marketing: 'marketing',
  microfabricaLider: 'microfabrica lider',
  microfabrica: 'microfabrica'
};

const COMMISSION_SETTINGS_DEFAULT = {
  ventas_lider_percent: 5,
  ventas_top_percent: 12,
  ventas_regular_percent: 8,
  almacen_percent: 5,
  marketing_lider_percent: 5
};
const COMMISSION_SETTINGS_KEYS = Object.keys(COMMISSION_SETTINGS_DEFAULT);
const QUOTE_STATUSES = ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado'];
const FINALIZED_QUOTE_STATUSES = ['Confirmado', 'Pagado', 'Embalado', 'Enviado'];
const QUOTE_SAVE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const quoteSaveIdempotencyCache = new Map();

const pruneQuoteSaveIdempotencyCache = () => {
  const now = Date.now();
  for (const [cacheKey, entry] of quoteSaveIdempotencyCache.entries()) {
    if (!entry || !entry.expiresAt || entry.expiresAt <= now) {
      quoteSaveIdempotencyCache.delete(cacheKey);
    }
  }
};

const getQuoteSaveIdempotencyCacheKey = (userId, headerValue) => {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const key = String(raw || '').trim();
  if (!key) return null;
  return `${userId}:${key.slice(0, 120)}`;
};

const TIME_OFF_LIMITS = {
  vacation: 14,
  sick_leave: 5
};

const TIME_OFF_TYPE_LABELS = {
  vacation: 'Vacaciones',
  sick_leave: 'Baja médica',
  early_leave: 'Salida anticipada',
  other: 'Otro permiso'
};

const TIME_OFF_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado'
};

const normalizeTimeOffType = (value = '') => {
  const normalized = normalizeText(value).replace(/-/g, '_');
  const map = {
    vacation: 'vacation',
    vacaciones: 'vacation',
    sick_leave: 'sick_leave',
    sickleave: 'sick_leave',
    enfermedad: 'sick_leave',
    'baja medica': 'sick_leave',
    early_leave: 'early_leave',
    earlyleave: 'early_leave',
    'salida anticipada': 'early_leave',
    other: 'other',
    permiso: 'other',
    otro: 'other'
  };
  return map[normalized] || null;
};

const normalizeTimeOffStatus = (value = '') => {
  const normalized = normalizeText(value).replace(/-/g, '_');
  const map = {
    pending: 'pending',
    pendiente: 'pending',
    approved: 'approved',
    aprobado: 'approved',
    rejected: 'rejected',
    rechazado: 'rejected'
  };
  return map[normalized] || null;
};

const parseYearOrCurrent = (value) => {
  if (value === undefined || value === null || value === '') return new Date().getFullYear();
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return null;
  }
  return year;
};

const makeYearWindow = (year) => {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return { start, end };
};

const isWeekend = (dateObj) => {
  const day = dateObj.getDay();
  return day === 0 || day === 6;
};

const toUtcDate = (dateValue) => {
  const [y, m, d] = String(dateValue).split('-').map((v) => Number.parseInt(v, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
};

const computeBusinessDaysInclusive = (startDate, endDate) => {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (!start || !end || end < start) return 0;
  let days = 0;
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    if (!isWeekend(cursor)) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

const isPgUndefinedTableError = (err) => err?.code === '42P01';
const isPgUndefinedColumnError = (err) => err?.code === '42703';

const buildTimeOffSummaryQuery = (daysColumn) => (
  `SELECT
     COALESCE(SUM(CASE
       WHEN leave_type IN ('vacation', 'vacaciones') AND status IN ('approved', 'aprobado')
         THEN ${daysColumn}
       ELSE 0
     END), 0) AS vacation_used,
     COALESCE(SUM(CASE
       WHEN leave_type IN ('sick_leave', 'enfermedad') AND status IN ('approved', 'aprobado')
         THEN ${daysColumn}
       ELSE 0
     END), 0) AS sick_used,
     COALESCE(SUM(CASE
       WHEN leave_type IN ('early_leave', 'other', 'permiso') AND status IN ('approved', 'aprobado')
         THEN ${daysColumn}
       ELSE 0
     END), 0) AS other_used
   FROM time_off_requests
   WHERE user_id = $1
     AND start_date <= $3::date
     AND end_date >= $2::date`
);

const computeTimeOffSummary = async (userId, year) => {
  const { start, end } = makeYearWindow(year);
  let result;
  try {
    result = await pool.query(buildTimeOffSummaryQuery('total_days'), [userId, start, end]);
  } catch (err) {
    if (isPgUndefinedTableError(err)) {
      return {
        year,
        vacation_used: 0,
        sick_used: 0,
        other_used: 0,
        vacation_remaining: TIME_OFF_LIMITS.vacation,
        sick_remaining: TIME_OFF_LIMITS.sick_leave
      };
    }
    if (isPgUndefinedColumnError(err)) {
      result = await pool.query(buildTimeOffSummaryQuery('business_days'), [userId, start, end]);
    } else {
      throw err;
    }
  }
  const vacationUsed = Number(result.rows[0]?.vacation_used || 0);
  const sickUsed = Number(result.rows[0]?.sick_used || 0);
  const otherUsed = Number(result.rows[0]?.other_used || 0);
  return {
    year,
    vacation_used: vacationUsed,
    sick_used: sickUsed,
    other_used: otherUsed,
    vacation_remaining: Math.max(0, TIME_OFF_LIMITS.vacation - vacationUsed),
    sick_remaining: Math.max(0, TIME_OFF_LIMITS.sick_leave - sickUsed)
  };
};

const clampPercent = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

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

const DEFAULT_PRODUCT_CATALOG = [
  { sku: 'T6195R', name: 'Tablero 61x95 Rojo', sf: 330, cf: 383 },
  { sku: 'T6195N', name: 'Tablero 61x95 Negro', sf: 330, cf: 383 },
  { sku: 'T6195AM', name: 'Tablero 61x95 Amarillo', sf: 330, cf: 383 },
  { sku: 'T6195AP', name: 'Tablero 61x95 Azul Petroleo', sf: 330, cf: 383 },
  { sku: 'T6195PL', name: 'Tablero 61x95 Plomo', sf: 330, cf: 383 },
  { sku: 'T9495R', name: 'Tablero 94x95 Rojo', sf: 450, cf: 522 },
  { sku: 'T9495N', name: 'Tablero 94x95 Negro', sf: 450, cf: 522 },
  { sku: 'T9495AM', name: 'Tablero 94x95 Amarillo', sf: 450, cf: 522 },
  { sku: 'T9495AP', name: 'Tablero 94x95 Azul Petroleo', sf: 450, cf: 522 },
  { sku: 'T9495PL', name: 'Tablero 94x95 Plomo', sf: 450, cf: 522 },
  { sku: 'T1099R', name: 'Tablero 10x99 Rojo', sf: 105, cf: 122 },
  { sku: 'T1099N', name: 'Tablero 10x99 Negro', sf: 105, cf: 122 },
  { sku: 'T1099AP', name: 'Tablero 10x99 Azul Petroleo', sf: 105, cf: 122 },
  { sku: 'R40N', name: 'Repisa Grande Negro', sf: 85, cf: 99 },
  { sku: 'R25N', name: 'Repisa Pequeña Negro', sf: 40, cf: 47 },
  { sku: 'D40N', name: 'Desarmador Grande Negro', sf: 70, cf: 82 },
  { sku: 'D22N', name: 'Desarmador Pequeño Negro', sf: 45, cf: 53 },
  { sku: 'L40N', name: 'Llave Grande Negro', sf: 80, cf: 93 },
  { sku: 'L22N', name: 'Llave Pequeño Negro', sf: 50, cf: 58 },
  { sku: 'C15N', name: 'Caja Negro', sf: 48, cf: 56 },
  { sku: 'M08N', name: 'Martillo Negro', sf: 17, cf: 20 },
  { sku: 'A15N', name: 'Amoladora Negro', sf: 30, cf: 35 },
  { sku: 'RR15N', name: 'Repisa/Rollo Negro', sf: 90, cf: 105 },
  { sku: 'G05C', name: 'Gancho 5cm Cromo', sf: 65, cf: 76 },
  { sku: 'G10C', name: 'Gancho 10cm Cromo', sf: 84, cf: 98 }
];

let PRODUCT_CATALOG = [...DEFAULT_PRODUCT_CATALOG];
let PRODUCT_CATALOG_BY_SKU = new Map(
  PRODUCT_CATALOG.map((item) => [String(item.sku || '').toUpperCase(), item.name])
);

let productCatalogInitPromise = null;

const syncProductCatalogBySkuFromRows = (rows = []) => {
  const nextCatalog = rows.map((row) => ({
    sku: String(row.sku || '').toUpperCase(),
    name: String(row.name || '').trim(),
    sf: Number(row.sf ?? row.sf_price ?? 0),
    cf: Number(row.cf ?? row.cf_price ?? 0)
  }));
  PRODUCT_CATALOG = nextCatalog;
  PRODUCT_CATALOG_BY_SKU = new Map(
    nextCatalog.map((item) => [item.sku, item.name || item.sku])
  );
};

const ensureProductCatalogReady = async () => {
  if (!productCatalogInitPromise) {
    productCatalogInitPromise = (async () => {
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sf_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cf_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);

      for (const item of DEFAULT_PRODUCT_CATALOG) {
        await pool.query(
          `INSERT INTO products (sku, name, sf_price, cf_price, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT (sku) DO UPDATE
           SET name = CASE
                 WHEN products.name IS NULL OR BTRIM(products.name) = ''
                   THEN EXCLUDED.name
                 ELSE products.name
               END,
               sf_price = CASE
                 WHEN products.sf_price IS NULL OR products.sf_price = 0
                   THEN EXCLUDED.sf_price
                 ELSE products.sf_price
               END,
               cf_price = CASE
                 WHEN products.cf_price IS NULL OR products.cf_price = 0
                   THEN EXCLUDED.cf_price
                 ELSE products.cf_price
               END`,
          [item.sku, item.name, Number(item.sf || 0), Number(item.cf || 0)]
        );
      }

      const rowsResult = await pool.query(
        `SELECT sku, name, sf_price, cf_price
         FROM products
         WHERE is_active = TRUE
         ORDER BY UPPER(name) ASC, UPPER(sku) ASC`
      );
      syncProductCatalogBySkuFromRows(rowsResult.rows || []);
    })();
  }
  await productCatalogInitPromise;
};

const loadProductCatalogRows = async ({ includeInactive = false } = {}) => {
  await ensureProductCatalogReady();
  const whereClause = includeInactive ? '' : 'WHERE is_active = TRUE';
  const result = await pool.query(
    `SELECT sku, name, sf_price, cf_price, is_active
     FROM products
     ${whereClause}
     ORDER BY UPPER(name) ASC, UPPER(sku) ASC`
  );
  const rows = (result.rows || []).map((row) => ({
    sku: String(row.sku || '').toUpperCase(),
    name: String(row.name || '').trim(),
    sf: Number(row.sf_price || 0),
    cf: Number(row.cf_price || 0),
    is_active: Boolean(row.is_active)
  }));
  if (!includeInactive) {
    syncProductCatalogBySkuFromRows(rows);
  }
  return rows;
};

const normalizeProductSku = (value = '') => String(value || '').trim().toUpperCase();
const PRODUCT_SKU_REGEX = /^[A-Z0-9_-]{2,30}$/;

const validateProductSku = (value) => {
  const sku = normalizeProductSku(value);
  if (!sku) throw createHttpError(400, 'SKU requerido');
  if (!PRODUCT_SKU_REGEX.test(sku)) {
    throw createHttpError(400, 'SKU inválido. Usa 2-30 caracteres A-Z, 0-9, guion o guion bajo');
  }
  return sku;
};

const parseProductPrice = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, `${label} debe ser un número mayor o igual a 0`);
  }
  return parsed;
};

const normalizeProductPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const hasName = Object.prototype.hasOwnProperty.call(src, 'name');
  const hasSf = Object.prototype.hasOwnProperty.call(src, 'sf') || Object.prototype.hasOwnProperty.call(src, 'sf_price');
  const hasCf = Object.prototype.hasOwnProperty.call(src, 'cf') || Object.prototype.hasOwnProperty.call(src, 'cf_price');
  const hasIsActive = Object.prototype.hasOwnProperty.call(src, 'is_active');

  if (!partial && (!hasName || !hasSf || !hasCf)) {
    throw createHttpError(400, 'Debes enviar name, sf y cf');
  }
  if (partial && !hasName && !hasSf && !hasCf && !hasIsActive) {
    throw createHttpError(400, 'No se enviaron cambios para actualizar');
  }

  const normalized = {};
  if (hasName) {
    const name = String(src.name || '').trim();
    if (!name) throw createHttpError(400, 'Nombre de producto requerido');
    if (name.length > 120) throw createHttpError(400, 'Nombre de producto demasiado largo (máx 120)');
    normalized.name = name;
  }
  if (hasSf) normalized.sf_price = parseProductPrice(src.sf ?? src.sf_price, 'Precio SF');
  if (hasCf) normalized.cf_price = parseProductPrice(src.cf ?? src.cf_price, 'Precio CF');
  if (hasIsActive) {
    if (typeof src.is_active === 'boolean') {
      normalized.is_active = src.is_active;
    } else {
      const activeRaw = normalizeText(String(src.is_active));
      if (['true', '1', 'si', 'yes', 'activo', 'active'].includes(activeRaw)) {
        normalized.is_active = true;
      } else if (['false', '0', 'no', 'inactivo', 'inactive'].includes(activeRaw)) {
        normalized.is_active = false;
      } else {
        throw createHttpError(400, 'is_active debe ser booleano');
      }
    }
  }
  return normalized;
};

const loadProductNameMap = async () => {
  await ensureProductCatalogReady();
  if (!PRODUCT_CATALOG_BY_SKU || PRODUCT_CATALOG_BY_SKU.size === 0) {
    await loadProductCatalogRows();
  }
  return PRODUCT_CATALOG_BY_SKU;
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

const INVENTORY_CITY_SCOPE = {
  cochabamba: {
    canonical: 'Cochabamba',
    stockField: 'stock_cochabamba',
    minField: 'min_stock_cochabamba',
    aliases: ['cochabamba', 'cbba']
  },
  'santa cruz': {
    canonical: 'Santa Cruz',
    stockField: 'stock_santacruz',
    minField: 'min_stock_santacruz',
    aliases: ['santa cruz', 'santacruz', 'scz']
  },
  lima: {
    canonical: 'Lima',
    stockField: 'stock_lima',
    minField: 'min_stock_lima',
    aliases: ['lima']
  }
};

const resolveInventoryScopeByCity = (cityValue = '') => {
  const normalized = normalizeText(cityValue);
  if (!normalized) return null;
  return Object.values(INVENTORY_CITY_SCOPE).find((entry) => entry.aliases.includes(normalized)) || null;
};

const getInventoryAccessScope = (userContext, access) => {
  const hasGlobalInventory = Boolean(access?.inventario_global);
  const hasIndividualInventory = Boolean(access?.inventario_individual);
  if (!hasGlobalInventory && !hasIndividualInventory) {
    return { error: 'No tienes permiso de inventario' };
  }
  if (hasGlobalInventory) {
    return { isGlobal: true, scope: null };
  }
  const scope = resolveInventoryScopeByCity(userContext?.city || '');
  if (!scope) {
    return { error: 'Tu usuario no tiene ciudad válida configurada para inventario individual' };
  }
  return { isGlobal: false, scope };
};

const getPedidosAccessScope = (userContext, access) => {
  const hasGlobalPedidos = Boolean(access?.pedidos_global || access?.historial_global);
  const hasIndividualPedidos = Boolean(access?.pedidos_individual);
  const hasHistorialIndividual = Boolean(access?.historial_individual);
  if (!hasGlobalPedidos && !hasIndividualPedidos && !hasHistorialIndividual) {
    return { error: 'No tienes permiso de pedidos' };
  }
  if (hasGlobalPedidos) {
    return { isGlobal: true, city: null };
  }
  const scope = resolveInventoryScopeByCity(userContext?.city || '');
  if (!scope) {
    return { error: 'Tu usuario no tiene ciudad válida configurada para pedidos individuales' };
  }
  return { isGlobal: false, city: scope.canonical };
};

const createHttpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const parseAndNormalizeQuoteRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw createHttpError(400, 'Debes agregar al menos una línea de producto');
  }

  return rows.map((rawRow, index) => {
    if (!rawRow || typeof rawRow !== 'object') {
      throw createHttpError(400, `Línea ${index + 1} inválida`);
    }

    const sku = String(rawRow.sku || '').trim().toUpperCase();
    const qty = Number.parseInt(rawRow.qty, 10);
    const unitPriceRaw = Number(rawRow.unitPrice ?? rawRow.unit_price);
    const lineTotalRaw = Number(rawRow.lineTotal ?? rawRow.line_total);
    const isCombo = Boolean(rawRow.isCombo);

    if (!sku) {
      throw createHttpError(400, `Línea ${index + 1}: SKU requerido`);
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw createHttpError(400, `Línea ${index + 1}: cantidad inválida`);
    }
    const resolvedUnitPrice = Number.isFinite(unitPriceRaw)
      ? unitPriceRaw
      : (Number.isFinite(lineTotalRaw) && qty > 0 ? lineTotalRaw / qty : NaN);
    if (!Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice < 0) {
      throw createHttpError(400, `Línea ${index + 1}: precio unitario inválido`);
    }

    const comboItems = Array.isArray(rawRow.comboItems) ? rawRow.comboItems : [];
    const normalizedComboItems = comboItems.map((comboItem, comboIndex) => {
      const comboSku = String(comboItem?.sku || '').trim().toUpperCase();
      const comboQty = Number.parseInt(comboItem?.quantity, 10);
      if (!comboSku || !Number.isInteger(comboQty) || comboQty <= 0) {
        throw createHttpError(
          400,
          `Línea ${index + 1}: item del combo ${comboIndex + 1} inválido`
        );
      }
      return {
        ...comboItem,
        sku: comboSku,
        quantity: comboQty
      };
    });

    if (isCombo && normalizedComboItems.length === 0) {
      throw createHttpError(400, `Línea ${index + 1}: el combo no tiene productos`);
    }

    const lineTotal = Number.isFinite(lineTotalRaw) ? lineTotalRaw : resolvedUnitPrice * qty;
    const displayName = String(
      rawRow.displayName || rawRow.skuDisplay || rawRow.name || sku
    ).trim() || sku;

    return {
      ...rawRow,
      sku,
      qty,
      unitPrice: resolvedUnitPrice,
      lineTotal,
      isCombo,
      comboItems: normalizedComboItems,
      displayName
    };
  });
};

const assertQuoteMutationPermission = async (client, quoteId, reqUserId, userContext, access) => {
  const canManageAnyQuote = Boolean(access?.pedidos_global || access?.historial_global);
  const isPedidosIndividualScoped = Boolean(access?.pedidos_individual) && !canManageAnyQuote;
  let pedidosScope = null;
  if (isPedidosIndividualScoped) {
    pedidosScope = getPedidosAccessScope(userContext, access);
    if (pedidosScope.error) {
      throw createHttpError(403, pedidosScope.error);
    }
  }

  const quoteRes = await client.query(
    `SELECT id, user_id, customer_name, customer_phone, department, provincia, shipping_notes,
            alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent,
            line_items, subtotal, total, status
     FROM quotes
     WHERE id = $1
     FOR UPDATE`,
    [quoteId]
  );

  if (quoteRes.rowCount === 0) {
    throw createHttpError(404, 'Cotización no encontrada');
  }

  const quote = quoteRes.rows[0];
  if (isPedidosIndividualScoped && pedidosScope && !pedidosScope.isGlobal) {
    if (quote.store_location !== pedidosScope.city) {
      throw createHttpError(403, 'No autorizado para modificar pedidos de otra ciudad');
    }
  } else if (!canManageAnyQuote && quote.user_id !== reqUserId) {
    throw createHttpError(403, 'No autorizado para modificar este pedido');
  }

  return quote;
};

const flattenQuoteLineItemsToSkuQtyMap = (lineItems = []) => {
  const map = new Map();
  const addQty = (skuValue, qtyValue) => {
    const sku = String(skuValue || '').trim().toUpperCase();
    const qty = Number.parseInt(qtyValue, 10);
    if (!sku || !Number.isInteger(qty) || qty <= 0) return;
    map.set(sku, (map.get(sku) || 0) + qty);
  };

  for (const row of lineItems || []) {
    if (row?.isCombo) {
      for (const comboItem of row.comboItems || []) {
        const comboQty = Number.parseInt(comboItem?.quantity, 10);
        const rowQty = Number.parseInt(row?.qty, 10);
        addQty(comboItem?.sku, (Number.isInteger(comboQty) ? comboQty : 0) * (Number.isInteger(rowQty) ? rowQty : 0));
      }
      continue;
    }
    addQty(row?.sku, row?.qty);
  }

  return map;
};

const lineItemsFingerprint = (lineItems = []) => {
  const entries = [...flattenQuoteLineItemsToSkuQtyMap(lineItems).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([sku, qty]) => `${sku}:${qty}`).join('|');
};

const mergeAccessWithDefaults = (baseRole, panelAccess) => {
  const defaults = getDefaultPanelAccessForRole(baseRole);
  const merged = { ...defaults };
  if (!panelAccess || typeof panelAccess !== 'object' || Array.isArray(panelAccess)) {
    return merged;
  }
  for (const key of PANEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(panelAccess, key)) {
      merged[key] = Boolean(panelAccess[key]);
    }
  }
  return merged;
};

const buildUserPayload = (userRow) => {
  const panel_access = sanitizePanelAccess(userRow.panel_access, userRow.role);
  return {
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    city: userRow.city,
    phone: userRow.phone,
    panel_access
  };
};

const loadUserContext = async (userId) => {
  const result = await pool.query(
    'SELECT id, email, role, city, phone, panel_access FROM users WHERE id = $1',
    [userId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

const buildDateFilter = (month, year, tableAlias = 'q', startIndex = 1) => {
  const params = [];
  const clauses = [];

  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;

  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    return { error: 'Mes inválido. Debe estar entre 1 y 12' };
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    return { error: 'Año inválido' };
  }

  if (monthNum !== null) {
    params.push(monthNum);
    clauses.push(`EXTRACT(MONTH FROM ${tableAlias}.created_at) = $${startIndex + params.length - 1}`);
  }
  if (yearNum !== null) {
    params.push(yearNum);
    clauses.push(`EXTRACT(YEAR FROM ${tableAlias}.created_at) = $${startIndex + params.length - 1}`);
  }

  const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  return { params, sql };
};

// Middleware: Verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No se proporcionó token' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Middleware: Require specific role (case-insensitive + accent-insensitive)
const requireRole = (roles) => (req, res, next) => {
  const userRole = normalizeRole(req.user.role || '');
  const allowed = roles.map((r) => normalizeRole(r));
  if (!allowed.includes(userRole)) {
    return res.status(403).json({ error: 'Permisos insuficientes' });
  }
  next();
};

// ─── REGISTER new user (admin only) ────────────────────────────────────────
app.post('/api/register', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone) VALUES ($1, $2, $3, $4, $5)',
      [email, hashedPass, role, city || null, phone || null]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'Registro fallido' });
  }
});

// ─── LOGIN ──────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan correo o contraseña' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const tokenUser = buildUserPayload(user);
    const token = jwt.sign(
      {
        id: tokenUser.id,
        email: tokenUser.email,
        role: tokenUser.role,
        city: tokenUser.city,
        phone: tokenUser.phone,
        panel_access: tokenUser.panel_access
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: tokenUser
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Inicio de sesión fallido' });
  }
});

// ─── LIST assignable sellers for warehouse quote mode ───────────────────────
app.get('/api/sellers/assignable', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, role
       FROM users
       WHERE role ILIKE '%ventas%' OR role ILIKE '%sales%' OR role ILIKE '%vendedor%'
       ORDER BY email ASC`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        display_name: String(row.email || '').split('@')[0] || 'Vendedor'
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la lista de vendedores' });
  }
});

// Backward compatible alias for legacy frontend calls.
app.get('/api/users/sales', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }
  try {
    const result = await pool.query(
      `SELECT id, email, role
       FROM users
       WHERE role ILIKE '%ventas%' OR role ILIKE '%sales%' OR role ILIKE '%vendedor%'
       ORDER BY email ASC`
    );
    res.json(result.rows.map((row) => ({ id: row.id, email: row.email, role: row.role })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la lista de vendedores' });
  }
});

// ─── SAVE new quote ─────────────────────────────────────────────────────────
app.post('/api/quotes', authenticateToken, async (req, res) => {
  const {
    customer_name,
    customer_phone,
    department,
    provincia,
    shipping_notes,
    alternative_name,
    alternative_phone,
    store_location,
    vendor,
    venta_type,
    discount_percent,
    rows,
    subtotal,
    total,
    seller_user_id,
    status = 'Cotizado'
  } = req.body || {};

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }

  const normalizedStatus = String(status || 'Cotizado').trim();
  if (!QUOTE_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${QUOTE_STATUSES.join(', ')}` });
  }

  if (!customer_name || !customer_phone || !store_location || !venta_type) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para guardar la cotización' });
  }

  let lineItemsWithDisplay;
  let subtotalValue;
  let totalValue;
  let discountPercentValue;
  try {
    lineItemsWithDisplay = parseAndNormalizeQuoteRows(rows);
    subtotalValue = Number(subtotal);
    totalValue = Number(total);
    discountPercentValue = Number(discount_percent ?? 0);
    if (!Number.isFinite(subtotalValue) || subtotalValue < 0) {
      throw createHttpError(400, 'Subtotal inválido');
    }
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      throw createHttpError(400, 'Total inválido');
    }
    if (!Number.isFinite(discountPercentValue) || discountPercentValue < 0 || discountPercentValue > 100) {
      throw createHttpError(400, 'Descuento inválido');
    }
  } catch (err) {
    const statusCode = err?.statusCode || 400;
    return res.status(statusCode).json({ error: err.message || 'Datos inválidos en la cotización' });
  }

  pruneQuoteSaveIdempotencyCache();
  const idempotencyCacheKey = getQuoteSaveIdempotencyCacheKey(req.user.id, req.headers['x-idempotency-key']);
  if (idempotencyCacheKey) {
    const existing = quoteSaveIdempotencyCache.get(idempotencyCacheKey);
    if (existing?.inFlight) {
      return res.status(409).json({ error: 'La cotización ya se está guardando. Espera un momento.' });
    }
    if (existing?.response) {
      return res.status(existing.statusCode || 201).json({
        ...existing.response,
        duplicate: true
      });
    }
    quoteSaveIdempotencyCache.set(idempotencyCacheKey, {
      inFlight: true,
      expiresAt: Date.now() + QUOTE_SAVE_IDEMPOTENCY_TTL_MS
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const creatorRole = normalizeRole(userContext.role || '');
    const isWarehouseQuoteMode = creatorRole === 'almacen' || creatorRole === 'almacen lider';
    let quoteOwnerId = req.user.id;
    let vendorDisplayName = vendor || userContext.email?.split('@')[0] || 'Usuario';

    if (isWarehouseQuoteMode) {
      const selectedSellerId = Number.parseInt(seller_user_id, 10);
      if (!Number.isInteger(selectedSellerId)) {
        throw createHttpError(400, 'Selecciona un vendedor válido para asignar la cotización');
      }
      const sellerRes = await client.query(
        'SELECT id, email, role FROM users WHERE id = $1',
        [selectedSellerId]
      );
      if (sellerRes.rowCount === 0) {
        throw createHttpError(400, 'El vendedor seleccionado no existe');
      }
      const seller = sellerRes.rows[0];
      const sellerRole = normalizeRole(seller.role || '');
      const isAssignableSeller = sellerRole === ROLE_KEYS.ventas || sellerRole === ROLE_KEYS.ventasLider || sellerRole === 'sales' || sellerRole === 'vendedor';
      if (!isAssignableSeller) {
        throw createHttpError(400, 'Solo puedes asignar la cotización a un usuario de ventas');
      }
      quoteOwnerId = seller.id;
      vendorDisplayName = String(seller.email || '').split('@')[0] || vendorDisplayName;
    }

    const quoteResult = await client.query(
      `INSERT INTO quotes (
        user_id, customer_name, customer_phone, department, provincia, shipping_notes,
        alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent, line_items, subtotal,
        total, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id`,
      [
        quoteOwnerId,
        customer_name,
        customer_phone,
        department || null,
        provincia || null,
        shipping_notes || null,
        alternative_name || null,
        alternative_phone || null,
        store_location,
        vendorDisplayName,
        venta_type,
        discountPercentValue,
        JSON.stringify(lineItemsWithDisplay),
        subtotalValue,
        totalValue,
        normalizedStatus
      ]
    );

    const quoteId = quoteResult.rows[0].id;

    // Only deduct stock if initial status is finalized.
    if (FINALIZED_QUOTE_STATUSES.includes(normalizedStatus)) {
      await deductStockForQuote(client, quoteId, store_location, lineItemsWithDisplay);
    }

    await client.query('COMMIT');
    const responseBody = { id: quoteId, message: 'Cotización guardada' };
    if (idempotencyCacheKey) {
      quoteSaveIdempotencyCache.set(idempotencyCacheKey, {
        inFlight: false,
        statusCode: 201,
        response: responseBody,
        expiresAt: Date.now() + QUOTE_SAVE_IDEMPOTENCY_TTL_MS
      });
    }
    res.status(201).json(responseBody);
  } catch (err) {
    await client.query('ROLLBACK');
    if (idempotencyCacheKey) {
      quoteSaveIdempotencyCache.delete(idempotencyCacheKey);
    }
    console.error(err);
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ error: err.message || 'Error al guardar cotización' });
  } finally {
    client.release();
  }
});

// ─── GET quotes (personal or team) ──────────────────────────────────────────
app.get('/api/quotes', authenticateToken, async (req, res) => {
  const { team } = req.query;
  const isTeamView = team === 'true';
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const hasAnyPedidosAccess = Boolean(access.pedidos_individual || access.pedidos_global);
  const pedidosScope = hasAnyPedidosAccess ? getPedidosAccessScope(userContext, access) : null;
  if (hasAnyPedidosAccess && pedidosScope?.error) return res.status(403).json({ error: pedidosScope.error });

  if (isTeamView) {
    const canSeeGlobalHistory = access.historial_global || access.pedidos_global;
    if (!canSeeGlobalHistory) {
      return res.status(403).json({ error: 'No tienes permiso para historial/pedidos global' });
    }
  } else {
    const canSeeOwnHistory = access.historial_individual || access.pedidos_individual;
    if (!canSeeOwnHistory) {
      return res.status(403).json({ error: 'No tienes permiso para historial/pedidos individual' });
    }
  }

  try {
    let query = '';
    let params = [];

    if (isTeamView) {
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               ORDER BY q.created_at DESC`;
      params = [];
    } else if (access.pedidos_individual && !access.historial_individual && !pedidosScope.isGlobal) {
      // Pedidos individual: scope by assigned city/store.
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               WHERE q.store_location = $1
               ORDER BY q.created_at DESC`;
      params = [pedidosScope.city];
    } else {
      // Historial individual: own quotes only.
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               WHERE q.user_id = $1
               ORDER BY q.created_at DESC`;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ─── GET seller contact by quote id (team roles) ───────────────────────────
app.get('/api/quotes/:id/seller-contact', authenticateToken, async (req, res) => {
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const canAccessAllQuotes = ['ventas lider', 'admin', 'almacen lider', 'almacen'].includes(userRoleNormalized);

  try {
    const result = await pool.query(
      `SELECT q.user_id, u.email AS seller_email, u.phone AS seller_phone
       FROM quotes q
       LEFT JOIN users u ON u.id = q.user_id
       WHERE q.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const row = result.rows[0];
    if (!canAccessAllQuotes && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este contacto' });
    }

    res.json({
      seller_email: row.seller_email,
      seller_phone: row.seller_phone
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener contacto del vendedor' });
  }
});

// ─── TIME OFF / CALENDAR (usuario + admin) ──────────────────────────────────
app.get('/api/time-off/mine', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  const { start, end } = makeYearWindow(year);
  try {
    let result;
    try {
      result = await pool.query(
        `SELECT id, leave_type, start_date, end_date, total_days AS days_count, notes, status, created_at, updated_at
         FROM time_off_requests
         WHERE user_id = $1
           AND start_date <= $3::date
           AND end_date >= $2::date
         ORDER BY start_date DESC, id DESC`,
        [req.user.id, start, end]
      );
    } catch (err) {
      if (isPgUndefinedTableError(err)) {
        return res.json([]);
      }
      if (isPgUndefinedColumnError(err)) {
        result = await pool.query(
          `SELECT id, leave_type, start_date, end_date, business_days AS days_count, reason AS notes, status, created_at, updated_at
           FROM time_off_requests
           WHERE user_id = $1
             AND start_date <= $3::date
             AND end_date >= $2::date
           ORDER BY start_date DESC, id DESC`,
          [req.user.id, start, end]
        );
      } else {
        throw err;
      }
    }
    const rows = result.rows.map((row) => {
      const normalizedType = normalizeTimeOffType(row.leave_type) || 'other';
      const normalizedStatus = normalizeTimeOffStatus(row.status) || 'pending';
      return {
        ...row,
        leave_type: normalizedType,
        request_type: normalizedType,
        status: normalizedStatus
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar tus permisos' });
  }
});

app.get('/api/time-off/mine/summary', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    const summary = await computeTimeOffSummary(req.user.id, year);
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el resumen de cupos' });
  }
});

app.post('/api/time-off', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'calendario')) {
    return res.status(403).json({ error: 'No tienes permiso para registrar permisos' });
  }

  const {
    request_type,
    start_date,
    end_date,
    notes
  } = req.body || {};

  const normalizedType = normalizeTimeOffType(request_type);
  if (!normalizedType) {
    return res.status(400).json({ error: 'Tipo de permiso inválido' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Debes indicar fecha de inicio y fin' });
  }
  if (String(end_date) < String(start_date)) {
    return res.status(400).json({ error: 'La fecha fin no puede ser menor a la fecha inicio' });
  }

  const businessDays = computeBusinessDaysInclusive(start_date, end_date);
  if (businessDays <= 0) {
    return res.status(400).json({ error: 'El rango no incluye días laborables' });
  }

  const year = parseYearOrCurrent(String(start_date).slice(0, 4));
  if (year === null) return res.status(400).json({ error: 'Año inválido' });

  try {
    if (normalizedType === 'vacation' || normalizedType === 'sick_leave') {
      const summary = await computeTimeOffSummary(req.user.id, year);
      if (normalizedType === 'vacation' && businessDays > summary.vacation_remaining) {
        return res.status(400).json({ error: `Supera cupo anual de vacaciones. Disponible: ${summary.vacation_remaining} día(s)` });
      }
      if (normalizedType === 'sick_leave' && businessDays > summary.sick_remaining) {
        return res.status(400).json({ error: `Supera cupo anual de baja médica. Disponible: ${summary.sick_remaining} día(s)` });
      }
    }

    let result;
    try {
      result = await pool.query(
        `INSERT INTO time_off_requests (user_id, leave_type, start_date, end_date, total_days, notes, status)
         VALUES ($1, $2, $3::date, $4::date, $5, $6, 'pending')
         RETURNING id, leave_type, start_date, end_date, total_days AS days_count, notes, status, created_at`,
        [req.user.id, normalizedType, start_date, end_date, businessDays, notes || null]
      );
    } catch (err) {
      if (isPgUndefinedTableError(err)) {
        return res.status(503).json({ error: 'Calendario no inicializado. Falta aplicar migración en base de datos.' });
      }
      if (isPgUndefinedColumnError(err)) {
        const legacyTypeMap = {
          vacation: 'vacaciones',
          sick_leave: 'enfermedad',
          early_leave: 'permiso',
          other: 'permiso'
        };
        result = await pool.query(
          `INSERT INTO time_off_requests (user_id, leave_type, start_date, end_date, business_days, reason, status)
           VALUES ($1, $2, $3::date, $4::date, $5, $6, 'pendiente')
           RETURNING id, leave_type, start_date, end_date, business_days AS days_count, reason AS notes, status, created_at`,
          [req.user.id, legacyTypeMap[normalizedType] || 'permiso', start_date, end_date, businessDays, notes || null]
        );
      } else {
        throw err;
      }
    }
    const row = result.rows[0] || {};
    const normalizedInsertedType = normalizeTimeOffType(row.leave_type) || normalizedType;
    const normalizedInsertedStatus = normalizeTimeOffStatus(row.status) || 'pending';
    res.status(201).json({
      ...row,
      leave_type: normalizedInsertedType,
      request_type: normalizedInsertedType,
      status: normalizedInsertedStatus
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el permiso' });
  }
});

app.get('/api/timeoff/requests', authenticateToken, requireRole(['admin']), async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  const { start, end } = makeYearWindow(year);
  try {
    let result;
    try {
      result = await pool.query(
        `SELECT
           r.id, r.user_id, u.email AS user_email, r.leave_type, r.start_date, r.end_date,
           r.total_days AS total_days, r.status, r.notes, r.created_at, r.updated_at,
           r.approved_by, approver.email AS approved_by_email, r.approved_at
         FROM time_off_requests r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN users approver ON approver.id = r.approved_by
         WHERE r.start_date <= $2::date
           AND r.end_date >= $1::date
         ORDER BY r.start_date DESC, r.id DESC`,
        [start, end]
      );
    } catch (err) {
      if (isPgUndefinedTableError(err)) {
        return res.json([]);
      }
      if (isPgUndefinedColumnError(err)) {
        result = await pool.query(
          `SELECT
             r.id, r.user_id, u.email AS user_email, r.leave_type, r.start_date, r.end_date,
             r.business_days AS total_days, r.status, r.reason AS notes, r.created_at, r.updated_at,
             r.approved_by, approver.email AS approved_by_email, r.approved_at
           FROM time_off_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN users approver ON approver.id = r.approved_by
           WHERE r.start_date <= $2::date
             AND r.end_date >= $1::date
           ORDER BY r.start_date DESC, r.id DESC`,
          [start, end]
        );
      } else {
        throw err;
      }
    }
    const mapped = result.rows.map((row) => ({
      ...row,
      leave_type: normalizeTimeOffType(row.leave_type) || row.leave_type,
      status: normalizeTimeOffStatus(row.status) || row.status,
      leave_type_label: TIME_OFF_TYPE_LABELS[normalizeTimeOffType(row.leave_type)] || row.leave_type,
      status_label: TIME_OFF_STATUS_LABELS[normalizeTimeOffStatus(row.status)] || row.status
    }));
    res.json(mapped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar solicitudes de permisos' });
  }
});

app.get('/api/timeoff/summary', authenticateToken, requireRole(['admin']), async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    const usersRes = await pool.query(
      `SELECT id, email
       FROM users
       ORDER BY email ASC`
    );
    const rows = [];
    for (const userRow of usersRes.rows) {
      const summary = await computeTimeOffSummary(userRow.id, year);
      rows.push({
        user_id: userRow.id,
        email: userRow.email,
        ...summary
      });
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar resumen global de permisos' });
  }
});

app.patch('/api/timeoff/requests/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  const status = normalizeTimeOffStatus(req.body?.status);
  if (!status) return res.status(400).json({ error: 'Estado inválido' });
  const legacyStatusMap = {
    pending: 'pendiente',
    approved: 'aprobado',
    rejected: 'rechazado'
  };
  const shouldApprove = status === 'approved';
  const updateSql = `UPDATE time_off_requests
     SET status = $1,
         approved_by = CASE WHEN $4 THEN $2 ELSE NULL END,
         approved_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, status`;

  try {
    let result;
    try {
      result = await pool.query(updateSql, [status, req.user.id, req.params.id, shouldApprove]);
    } catch (err) {
      if (err?.code === '23514') {
        result = await pool.query(updateSql, [legacyStatusMap[status] || 'pendiente', req.user.id, req.params.id, shouldApprove]);
      } else {
        throw err;
      }
    }
    if (result.rowCount === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const normalized = normalizeTimeOffStatus(result.rows[0]?.status) || status;
    res.json({ message: 'Estado actualizado', id: result.rows[0]?.id, status: normalized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de la solicitud' });
  }
});

// ─── GET single quote for checklist with displayName ────────────────────────
app.get('/api/quotes/:id/checklist', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canAccessAllQuotes = access.pedidos_global || access.historial_global;
  const pedidosScope = getPedidosAccessScope(userContext, access);
  if (pedidosScope.error) return res.status(403).json({ error: pedidosScope.error });

  try {
    const result = await pool.query(
      `SELECT id, user_id, customer_name, customer_phone, department, provincia, store_location, 
              vendor, status, line_items, created_at, alternative_name, alternative_phone
       FROM quotes WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const quote = result.rows[0];
    if (!canAccessAllQuotes && quote.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este pedido' });
    }
    if (!canAccessAllQuotes && access.pedidos_individual && !access.historial_individual && !pedidosScope.isGlobal && quote.store_location !== pedidosScope.city) {
      return res.status(403).json({ error: 'No autorizado para ver pedidos de otra ciudad' });
    }

    const items = quote.line_items.map(row => ({
      displayName: row.displayName || row.sku || 'Producto desconocido',
      qty: row.qty || 1
    }));

    res.json({
      id: quote.id,
      customer_name: quote.customer_name,
      customer_phone: quote.customer_phone,
      alternative_name: quote.alternative_name,
      alternative_phone: quote.alternative_phone,
      department: quote.department,
      provincia: quote.provincia,
      store_location: quote.store_location,
      vendor: quote.vendor,
      status: quote.status,
      created_at: quote.created_at,
      items
    });
  } catch (err) {
    console.error('Error fetching checklist:', err);
    res.status(500).json({ error: 'Error al obtener checklist' });
  }
});

// ─── UPDATE quote status (deduct stock only from Cotizado → other) ──────────
app.patch('/api/quotes/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado'];
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canManageAnyQuote = access.pedidos_global || access.historial_global;
  const pedidosScope = getPedidosAccessScope(userContext, access);
  if (pedidosScope.error) return res.status(403).json({ error: pedidosScope.error });

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${validStatuses.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      'SELECT user_id, status, store_location, line_items FROM quotes WHERE id = $1',
      [req.params.id]
    );

    if (currentRes.rowCount === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const isPedidosIndividualScoped = access.pedidos_individual && !canManageAnyQuote && !pedidosScope.isGlobal;
    if (isPedidosIndividualScoped) {
      if (currentRes.rows[0].store_location !== pedidosScope.city) {
        return res.status(403).json({ error: 'No autorizado para actualizar pedidos de otra ciudad' });
      }
    } else if (!canManageAnyQuote && currentRes.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para actualizar este pedido' });
    }

    const currentStatus = currentRes.rows[0].status;
    const storeLocation = currentRes.rows[0].store_location;
    const lineItems = currentRes.rows[0].line_items;

    // Deduct stock only if moving FROM Cotizado to something else
    if (currentStatus === 'Cotizado' && status !== 'Cotizado') {
      await deductStockForQuote(client, req.params.id, storeLocation, lineItems);
    }

    const updateRes = await client.query(
      'UPDATE quotes SET status = $1 WHERE id = $2 RETURNING status',
      [status, req.params.id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Estado actualizado', status: updateRes.rows[0].status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al actualizar estado' });
  } finally {
    client.release();
  }
});

// ─── UPDATE quote details (owner/global roles, stock-safe) ───────────────────
app.put('/api/quotes/:id', authenticateToken, async (req, res) => {
  const quoteId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ error: 'ID de cotización inválido' });
  }

  const {
    customer_name,
    customer_phone,
    department,
    provincia,
    shipping_notes,
    alternative_name,
    alternative_phone,
    store_location,
    venta_type,
    discount_percent,
    rows,
    subtotal,
    total,
    status
  } = req.body || {};

  if (!customer_name || !customer_phone || !store_location || !venta_type) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para actualizar la cotización' });
  }

  const normalizedStatus = String(status || 'Cotizado').trim();
  if (!QUOTE_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${QUOTE_STATUSES.join(', ')}` });
  }

  let lineItemsWithDisplay;
  let subtotalValue;
  let totalValue;
  let discountPercentValue;
  try {
    lineItemsWithDisplay = parseAndNormalizeQuoteRows(rows);
    subtotalValue = Number(subtotal);
    totalValue = Number(total);
    discountPercentValue = Number(discount_percent ?? 0);
    if (!Number.isFinite(subtotalValue) || subtotalValue < 0) {
      throw createHttpError(400, 'Subtotal inválido');
    }
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      throw createHttpError(400, 'Total inválido');
    }
    if (!Number.isFinite(discountPercentValue) || discountPercentValue < 0 || discountPercentValue > 100) {
      throw createHttpError(400, 'Descuento inválido');
    }
  } catch (err) {
    const statusCode = err?.statusCode || 400;
    return res.status(statusCode).json({ error: err.message || 'Datos inválidos en la cotización' });
  }

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });

  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentQuote = await assertQuoteMutationPermission(
      client,
      quoteId,
      req.user.id,
      userContext,
      access
    );

    const oldStatus = String(currentQuote.status || 'Cotizado');
    const oldStore = currentQuote.store_location;
    const oldLineItems = Array.isArray(currentQuote.line_items) ? currentQuote.line_items : [];
    const wasFinalized = FINALIZED_QUOTE_STATUSES.includes(oldStatus);
    const willBeFinalized = FINALIZED_QUOTE_STATUSES.includes(normalizedStatus);
    const oldStoreKey = normalizeText(oldStore);
    const newStoreKey = normalizeText(store_location);
    const storeChanged = oldStoreKey !== newStoreKey;
    const lineItemsChanged = lineItemsFingerprint(oldLineItems) !== lineItemsFingerprint(lineItemsWithDisplay);

    if (wasFinalized && (!willBeFinalized || storeChanged || lineItemsChanged)) {
      await restockStockForQuote(client, oldStore, oldLineItems);
    }
    if (willBeFinalized && (!wasFinalized || storeChanged || lineItemsChanged)) {
      await deductStockForQuote(client, quoteId, store_location, lineItemsWithDisplay);
    }

    await client.query(
      `UPDATE quotes
       SET customer_name = $1,
           customer_phone = $2,
           department = $3,
           provincia = $4,
           shipping_notes = $5,
           alternative_name = $6,
           alternative_phone = $7,
           store_location = $8,
           venta_type = $9,
           discount_percent = $10,
           line_items = $11,
           subtotal = $12,
           total = $13,
           status = $14
       WHERE id = $15`,
      [
        customer_name,
        customer_phone,
        department || null,
        provincia || null,
        shipping_notes || null,
        alternative_name || null,
        alternative_phone || null,
        store_location,
        venta_type,
        discountPercentValue,
        JSON.stringify(lineItemsWithDisplay),
        subtotalValue,
        totalValue,
        normalizedStatus,
        quoteId
      ]
    );

    await client.query('COMMIT');
    return res.json({ message: 'Cotización actualizada', id: quoteId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || 'Error al actualizar cotización' });
  } finally {
    client.release();
  }
});

// ─── DELETE quote (owner/global roles, restores stock if needed) ─────────────
app.delete('/api/quotes/:id', authenticateToken, async (req, res) => {
  const quoteId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ error: 'ID de cotización inválido' });
  }

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentQuote = await assertQuoteMutationPermission(
      client,
      quoteId,
      req.user.id,
      userContext,
      access
    );

    if (FINALIZED_QUOTE_STATUSES.includes(String(currentQuote.status || 'Cotizado'))) {
      await restockStockForQuote(
        client,
        currentQuote.store_location,
        Array.isArray(currentQuote.line_items) ? currentQuote.line_items : []
      );
    }

    await client.query('DELETE FROM quotes WHERE id = $1', [quoteId]);
    await client.query('COMMIT');
    return res.json({ message: 'Cotización eliminada', id: quoteId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || 'Error al eliminar cotización' });
  } finally {
    client.release();
  }
});

// ─── Helper: Deduct stock for a quote ───────────────────────────────────────
async function deductStockForQuote(client, quoteId, storeLocation, lineItems) {
  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[storeLocation];

  if (!warehouseField) throw new Error('Almacén no válido');

  for (const row of lineItems) {
    if (row.isCombo) {
      for (const comboItem of row.comboItems || []) {
        const sku = comboItem.sku;
        const qty = comboItem.quantity * (row.qty || 1);

        const stockCheck = await client.query(
          `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
          [sku]
        );

        if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
        const currentStock = stockCheck.rows[0][warehouseField];

        if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

        await client.query(
          `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
          [qty, sku]
        );
      }
    } else {
      const sku = row.sku;
      const qty = row.qty;

      const stockCheck = await client.query(
        `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
        [sku]
      );

      if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
      const currentStock = stockCheck.rows[0][warehouseField];

      if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

      await client.query(
        `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
        [qty, sku]
      );
    }
  }
}

// ─── Helper: Restore stock for a quote ───────────────────────────────────────
async function restockStockForQuote(client, storeLocation, lineItems) {
  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[storeLocation];

  if (!warehouseField) throw new Error('Almacén no válido');

  for (const row of lineItems || []) {
    if (row?.isCombo) {
      for (const comboItem of row.comboItems || []) {
        const sku = String(comboItem?.sku || '').toUpperCase();
        const qty = Number(comboItem?.quantity || 0) * Number(row?.qty || 1);
        if (!sku || qty <= 0) continue;

        await client.query(
          `UPDATE products
           SET ${warehouseField} = ${warehouseField} + $1,
               last_updated = NOW()
           WHERE sku = $2`,
          [qty, sku]
        );
      }
      continue;
    }

    const sku = String(row?.sku || '').toUpperCase();
    const qty = Number(row?.qty || 0);
    if (!sku || qty <= 0) continue;

    await client.query(
      `UPDATE products
       SET ${warehouseField} = ${warehouseField} + $1,
           last_updated = NOW()
       WHERE sku = $2`,
      [qty, sku]
    );
  }
}

// ─── GET stock for a SKU in a specific store ───────────────────────────────
app.get('/api/stock', authenticateToken, async (req, res) => {
  const { sku, store_location } = req.query;

  if (!sku || !store_location) {
    return res.status(400).json({ error: 'SKU y store_location son requeridos' });
  }

  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[store_location];

  if (!warehouseField) return res.status(400).json({ error: 'Almacén no válido' });

  try {
    const result = await pool.query(
      `SELECT ${warehouseField} AS stock FROM products WHERE sku = $1`,
      [sku.toUpperCase()]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });

    res.json({ stock: result.rows[0].stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener stock' });
  }
});

// ─── UPDATE stock for a specific SKU in a warehouse ────────────────────────
app.patch('/api/products/:sku/stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const { store_location, new_stock } = req.body;

  if (!store_location || new_stock === undefined || isNaN(new_stock) || new_stock < 0) {
    return res.status(400).json({ error: 'store_location y new_stock (número >= 0) son requeridos' });
  }

  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[store_location];

  if (!warehouseField) return res.status(400).json({ error: 'Almacén no válido' });
  if (!inventoryScope.isGlobal && store_location !== inventoryScope.scope.canonical) {
    return res.status(403).json({ error: 'No puedes actualizar inventario de otro almacén' });
  }

  try {
    const result = await pool.query(
      `UPDATE products 
       SET ${warehouseField} = $1, last_updated = NOW() 
       WHERE sku = $2 
       RETURNING sku, ${warehouseField} AS stock`,
      [new_stock, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ 
      message: 'Stock actualizado', 
      sku: result.rows[0].sku, 
      stock: result.rows[0].stock 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar stock' });
  }
});

// ─── UPDATE minimum stock thresholds for a SKU ──────────────────────────────
app.patch('/api/products/:sku/min-stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const minFields = ['min_stock_cochabamba', 'min_stock_santacruz', 'min_stock_lima'];

  try {
    if (!inventoryScope.isGlobal) {
      const allowedMinField = inventoryScope.scope.minField;
      const providedFields = minFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
      if (providedFields.length === 0) {
        return res.status(400).json({ error: `Debes enviar ${allowedMinField}` });
      }
      if (providedFields.some((field) => field !== allowedMinField)) {
        return res.status(403).json({ error: 'No puedes actualizar mínimos de otro almacén' });
      }

      const minValue = req.body[allowedMinField];
      if (minValue === undefined || minValue === null || Number.isNaN(Number(minValue)) || Number(minValue) < 0) {
        return res.status(400).json({ error: 'El mínimo debe ser un número >= 0' });
      }

      const result = await pool.query(
        `UPDATE products
         SET ${allowedMinField} = $1,
             last_updated = NOW()
         WHERE sku = $2
         RETURNING sku, ${allowedMinField}`,
        [Number(minValue), sku.toUpperCase()]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      return res.json({
        message: 'Mínimo actualizado',
        ...result.rows[0]
      });
    }

    const {
      min_stock_cochabamba,
      min_stock_santacruz,
      min_stock_lima
    } = req.body;

    const values = [min_stock_cochabamba, min_stock_santacruz, min_stock_lima];
    if (values.some((v) => v === undefined || v === null || Number.isNaN(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ error: 'Los mínimos por almacén son requeridos y deben ser números >= 0' });
    }

    const result = await pool.query(
      `UPDATE products
       SET min_stock_cochabamba = $1,
           min_stock_santacruz = $2,
           min_stock_lima = $3,
           last_updated = NOW()
       WHERE sku = $4
       RETURNING sku, min_stock_cochabamba, min_stock_santacruz, min_stock_lima`,
      [min_stock_cochabamba, min_stock_santacruz, min_stock_lima, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({
      message: 'Mínimos actualizados',
      ...result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar mínimos' });
  }
});

// ─── MARKETING: Combos ──────────────────────────────────────────────────────

// GET all combos with items
app.get('/api/combos', authenticateToken, async (req, res) => {
  try {
    const combosResult = await pool.query(`
      SELECT 
        c.id, c.name, c.sf_price, c.cf_price, c.created_at,
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
app.post('/api/combos', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { name, sf, cf, products } = req.body;

  if (!name || !sf || !cf || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Faltan campos requeridos o productos vacíos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const comboRes = await client.query(
      'INSERT INTO combos (name, sf_price, cf_price, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, sf, cf, req.user.id]
    );
    const comboId = comboRes.rows[0].id;

    for (const item of products) {
      const { sku, quantity = 1 } = item;
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

// DELETE combo
app.delete('/api/combos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const comboRes = await pool.query('SELECT created_by FROM combos WHERE id = $1', [id]);
    if (comboRes.rowCount === 0) {
      return res.status(404).json({ error: 'Combo no encontrado' });
    }

    const creatorId = comboRes.rows[0].created_by;
    const isAdmin = req.user.role.toLowerCase() === 'admin';
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

// ─── CUPONES ────────────────────────────────────────────────────────────────

// GET all coupons
app.get('/api/cupones', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, code, discount_percent, valid_until, created_at FROM cupones ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cupones:', err);
    res.status(500).json({ error: 'No se pudieron cargar cupones' });
  }
});

// POST create new coupon
app.post('/api/cupones', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { code, discount_percent, valid_until } = req.body;

  if (!code || !discount_percent || !valid_until) {
    return res.status(400).json({ error: 'Faltan campos requeridos: code, discount_percent, valid_until' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO cupones (code, discount_percent, valid_until, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [code.toUpperCase(), discount_percent, valid_until, req.user.id]
    );
    res.status(201).json({ id: result.rows[0].id, message: 'Cupón creado' });
  } catch (err) {
    console.error('Error creating cupón:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código ya existe' });
    }
    res.status(500).json({ error: 'Error al crear cupón' });
  }
});

// DELETE coupon
app.delete('/api/cupones/:id', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM cupones WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    res.json({ message: 'Cupón eliminado' });
  } catch (err) {
    console.error('Error deleting cupón:', err);
    res.status(500).json({ error: 'Error al eliminar cupón' });
  }
});

// ─── USER MANAGEMENT (admin only) ────────────────────────────────────────────
app.get('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, city, phone, panel_access, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows.map((u) => ({ ...u, panel_access: sanitizePanelAccess(u.panel_access, u.role) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron obtener usuarios' });
  }
});

app.get('/api/role-access-defaults', authenticateToken, requireRole(['admin']), async (_req, res) => {
  res.json(DEFAULT_ROLE_ACCESS);
});

app.put('/api/role-access-defaults', authenticateToken, requireRole(['admin']), async (req, res) => {
  const roleEntries = Object.entries(req.body || {});
  if (roleEntries.length === 0) {
    return res.status(400).json({ error: 'No se enviaron roles para actualizar' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [roleLabel, accessValue] of roleEntries) {
      const sanitized = sanitizePanelAccess(accessValue, roleLabel);
      await client.query(
        'UPDATE users SET panel_access = $1::jsonb WHERE role = $2',
        [JSON.stringify(sanitized), roleLabel]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Configuración de roles actualizada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar configuración de roles' });
  } finally {
    client.release();
  }
});

app.post('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone, panel_access } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'Faltan campos requeridos' });

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const effectivePanelAccess = sanitizePanelAccess(panel_access, role);

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone, panel_access) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
      [email, hashedPass, role, city || null, phone || null, JSON.stringify(effectivePanelAccess)]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'No se pudo crear usuario' });
  }
});

app.patch('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { role, city, phone, panel_access } = req.body;
  if (!role) return res.status(400).json({ error: 'El rol es obligatorio' });

  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const cityProvided = Object.prototype.hasOwnProperty.call(req.body, 'city');
  const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const panelAccessProvided = Object.prototype.hasOwnProperty.call(req.body, 'panel_access');
  const cityValue = city === '' ? null : city;
  const phoneValue = phone === '' ? null : phone;
  const panelAccessValue = panelAccessProvided ? JSON.stringify(sanitizePanelAccess(panel_access, role)) : null;

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           city = CASE WHEN $2::boolean THEN $3 ELSE city END,
           phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
           panel_access = CASE WHEN $6::boolean THEN $7::jsonb ELSE panel_access END
       WHERE id = $8
       RETURNING id`,
      [role, cityProvided, cityValue, phoneProvided, phoneValue, panelAccessProvided, panelAccessValue, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'User updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar usuario' });
  }
});

// ─── ROLE ACCESS DEFAULTS (admin only) ──────────────────────────────────────
app.get('/api/roles/access-defaults', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT role, panel_access
       FROM role_panel_defaults
       ORDER BY role ASC`
    );
    const map = new Map(result.rows.map((row) => [normalizeRole(row.role), row.panel_access || {}]));
    const rows = ROLE_DEFAULT_ROLES.map((role) => {
      const dbAccess = map.get(normalizeRole(role));
      return {
        role,
        panel_access: sanitizePanelAccess(dbAccess, role)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de roles' });
  }
});

app.patch('/api/roles/access-defaults/:role', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rawRole = req.params.role;
  const matchedRole = ROLE_DEFAULT_ROLES.find((r) => normalizeRole(r) === normalizeRole(rawRole));
  if (!matchedRole) {
    return res.status(400).json({ error: 'Rol inválido para configuración por defecto' });
  }
  const panelAccess = sanitizePanelAccess(req.body?.panel_access, matchedRole);
  try {
    await pool.query(
      `INSERT INTO role_panel_defaults (role, panel_access)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (role)
       DO UPDATE SET panel_access = EXCLUDED.panel_access, updated_at = NOW()`,
      [matchedRole, JSON.stringify(panelAccess)]
    );
    res.json({ message: 'Configuración del rol guardada', role: matchedRole, panel_access: panelAccess });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración del rol' });
  }
});

app.post('/api/roles/access-defaults/:role/apply', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rawRole = req.params.role;
  const matchedRole = ROLE_DEFAULT_ROLES.find((r) => normalizeRole(r) === normalizeRole(rawRole));
  if (!matchedRole) {
    return res.status(400).json({ error: 'Rol inválido para aplicar configuración' });
  }
  try {
    const defaultsResult = await pool.query(
      'SELECT panel_access FROM role_panel_defaults WHERE role = $1',
      [matchedRole]
    );
    const defaultAccess = defaultsResult.rowCount > 0
      ? defaultsResult.rows[0].panel_access
      : null;
    const effectiveAccess = sanitizePanelAccess(defaultAccess, matchedRole);

    const updateResult = await pool.query(
      `UPDATE users
       SET panel_access = $1::jsonb
       WHERE LOWER(role) = LOWER($2)`,
      [JSON.stringify(effectiveAccess), matchedRole]
    );

    res.json({
      message: 'Configuración aplicada a usuarios del rol',
      role: matchedRole,
      updated_users: updateResult.rowCount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo aplicar configuración a usuarios' });
  }
});

// ─── COMMISSION SETTINGS (admin only) ────────────────────────────────────────
app.get('/api/commission/settings', authenticateToken, async (_req, res) => {
  try {
    const settings = await loadCommissionSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de comisiones' });
  }
});

app.patch('/api/commission/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const current = await loadCommissionSettings();
    const next = sanitizeCommissionSettings({
      ...current,
      ...(req.body?.settings || {})
    });
    await saveCommissionSettings(next);

    res.json({ message: 'Configuración de comisiones guardada', settings: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración de comisiones' });
  }
});

app.delete('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar usuario' });
  }
});

// ─── Performance ────────────────────────────────────────────────────────────
app.get('/api/performance', authenticateToken, async (req, res) => {
  const { team, month, year } = req.query;
  const isTeamView = team === 'true';
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);

  if (isTeamView && !access.rendimiento_global) {
    return res.status(403).json({ error: 'No tienes permiso para rendimiento global' });
  }
  if (!isTeamView && !access.rendimiento_individual) {
    return res.status(403).json({ error: 'No tienes permiso para rendimiento individual' });
  }
  const dateFilter = buildDateFilter(month, year, 'q', 2);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    if (isTeamView) {
      const queryText = `
        SELECT 
          u.id as user_id,
          u.email as usuario,
          u.role as rol,
          COUNT(q.id) FILTER (WHERE q.status = ANY($1::text[])) as cotizaciones_confirmadas,
          COALESCE(SUM(q.total) FILTER (WHERE q.status = ANY($1::text[])), 0) as ventas_totales
        FROM users u
        LEFT JOIN quotes q ON u.id = q.user_id${dateFilter.sql}
        WHERE u.role ILIKE '%ventas%' OR u.role ILIKE '%sales%' OR u.role ILIKE '%vendedor%'
        GROUP BY u.id, u.email, u.role
        ORDER BY ventas_totales DESC
      `;
      const result = await pool.query(queryText, [COMPLETED_STATUSES, ...dateFilter.params]);
      res.json(result.rows || []);
    } else {
      const personalDateFilter = buildDateFilter(month, year, 'q', 3);
      if (personalDateFilter.error) return res.status(400).json({ error: personalDateFilter.error });
      const personalParams = [req.user.id, COMPLETED_STATUSES, ...personalDateFilter.params];
      const result = await pool.query(
        `SELECT 
          COUNT(id) FILTER (WHERE status = ANY($2::text[])) as cotizaciones_confirmadas,
          COALESCE(SUM(total) FILTER (WHERE status = ANY($2::text[])), 0) as ventas_totales
        FROM quotes q
        WHERE user_id = $1${personalDateFilter.sql}`,
        personalParams
      );
      res.json(result.rows[0] || { cotizaciones_confirmadas: 0, ventas_totales: 0 });
    }
  } catch (err) {
    console.error('Performance endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener rendimiento: ' + err.message });
  }
});

// ─── Current user commission (nav box) ──────────────────────────────────────
app.get('/api/commission/current', authenticateToken, async (req, res) => {
  const { month, year } = req.query;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === ROLE_KEYS.admin;
  const isVentasLider = userRoleNormalized === ROLE_KEYS.ventasLider;
  const isMarketingLider = userRoleNormalized === ROLE_KEYS.marketingLider;
  const isSalesSeller = userRoleNormalized === ROLE_KEYS.ventas || userRoleNormalized === 'sales' || userRoleNormalized === 'vendedor';
  const isAlmacen = userRoleNormalized === ROLE_KEYS.almacen;
  const isAlmacenLider = userRoleNormalized === ROLE_KEYS.almacenLider;
  const isMarketing = userRoleNormalized === ROLE_KEYS.marketing;
  const isMicrofabricaLider = userRoleNormalized === ROLE_KEYS.microfabricaLider;
  const isMicrofabrica = userRoleNormalized === ROLE_KEYS.microfabrica;

  const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
  if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });
  const teamDateFilter = buildDateFilter(month, year, 'q', 4);
  if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });
  const ownDateFilter = buildDateFilter(month, year, 'q', 3);
  if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });
  const almacenDateFilter = buildDateFilter(month, year, 'q', 3);
  if (almacenDateFilter.error) return res.status(400).json({ error: almacenDateFilter.error });

  try {
    const commissionSettings = await loadCommissionSettings();
    const rateVentasLider = Number(commissionSettings.ventas_lider_percent || 0) / 100;
    const rateVentasTop = Number(commissionSettings.ventas_top_percent || 0) / 100;
    const rateVentasRegular = Number(commissionSettings.ventas_regular_percent || 0) / 100;
    const rateAlmacen = Number(commissionSettings.almacen_percent || 0) / 100;
    const rateMarketingLider = Number(commissionSettings.marketing_lider_percent || 0) / 100;

    // Admin: muestra comisión mensual por productos manufacturados aprobados.
    if (isAdmin) {
      const qcCommissionResult = await computeQualityControlCommissionTotal(month, year);
      if (qcCommissionResult?.error) {
        return res.status(400).json({ error: qcCommissionResult.error });
      }
      return res.json({
        commission: Number(qcCommissionResult?.total || 0),
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role || 'Admin',
          rate: 0,
          source: 'Comisión mensual por productos manufacturados aprobados'
        }
      });
    }

    // Total completed sales in period (used by leader/marketing rules).
    const allSalesRes = await pool.query(
      `SELECT COALESCE(SUM(q.total), 0) AS total_sales
       FROM quotes q
       WHERE q.status = ANY($1::text[])${allSalesDateFilter.sql}`,
      [COMPLETED_STATUSES, ...allSalesDateFilter.params]
    );
    const allSales = Number(allSalesRes.rows[0]?.total_sales || 0);

    if (isMarketingLider) {
      return res.json({
        commission: allSales * rateMarketingLider,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateMarketingLider,
          source: `${Number(commissionSettings.marketing_lider_percent || 0)}% de todas las ventas`
        }
      });
    }

    if (isVentasLider) {
      // Ventas Lider: configurable % on own sales + all users with exactly Ventas role.
      const teamSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND (LOWER(u.role) = $2 OR u.id = $3)${teamDateFilter.sql}`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventas, req.user.id, ...teamDateFilter.params]
      );
      const teamSales = Number(teamSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: teamSales * rateVentasLider,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateVentasLider,
          source: `${Number(commissionSettings.ventas_lider_percent || 0)}% ventas equipo + propias`
        }
      });
    }

    // Usuarios de ventas: quien lidera ventas recibe 12%, los demás 8%.
    if (isSalesSeller) {
      const ownSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.user_id = $1
           AND q.status = ANY($2::text[])${ownDateFilter.sql}`,
        [req.user.id, COMPLETED_STATUSES, ...ownDateFilter.params]
      );
      const ownSales = Number(ownSalesRes.rows[0]?.total_sales || 0);

      const rankingRes = await pool.query(
        `SELECT
           u.id AS user_id,
           u.email AS email,
           COALESCE(SUM(q.total), 0) AS total_sales
         FROM users u
         LEFT JOIN quotes q
           ON q.user_id = u.id
           AND q.status = ANY($1::text[])${allSalesDateFilter.sql}
         WHERE LOWER(u.role) IN ('ventas', 'sales', 'vendedor')
         GROUP BY u.id, u.email
         ORDER BY total_sales DESC, u.id ASC
         LIMIT 1`,
        [COMPLETED_STATUSES, ...allSalesDateFilter.params]
      );

      const topSeller = rankingRes.rows[0] || null;
      const topSellerId = topSeller ? Number(topSeller.user_id) : null;
      const isTopSeller = topSellerId === Number(req.user.id) && Number(topSeller.total_sales || 0) > 0;
      const rate = isTopSeller ? rateVentasTop : rateVentasRegular;

      return res.json({
        commission: ownSales * rate,
        isTopSeller,
        topSellerEmail: topSeller?.email || null,
        breakdown: {
          role: req.user.role,
          rate,
          source: `${Number(commissionSettings.ventas_top_percent || 0)}% mejor en ventas / ${Number(commissionSettings.ventas_regular_percent || 0)}% asesor de ventas`
        }
      });
    }

    if (isAlmacen) {
      const cityScope = resolveInventoryScopeByCity(userContext.city || '');
      const localStore = cityScope?.canonical || userContext.city || '';
      const localSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.status = $1
           AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
               LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
           ${almacenDateFilter.sql}`,
        ['Enviado', localStore, ...almacenDateFilter.params]
      );
      const localSales = Number(localSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: localSales * rateAlmacen,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateAlmacen,
          source: `${Number(commissionSettings.almacen_percent || 0)}% pedidos enviados de almacén local (${localStore || 'sin ciudad'})`
        }
      });
    }

    if (isAlmacenLider) {
      const qcCommissionResult = await computeQualityControlCommissionTotal(month, year);
      if (qcCommissionResult?.error) {
        return res.status(400).json({ error: qcCommissionResult.error });
      }
      return res.json({
        commission: Number(qcCommissionResult?.total || 0),
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: 0,
          source: 'Comisión mensual por productos manufacturados aprobados'
        }
      });
    }

    if (isMarketing) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0, source: 'Compensación por contrato' }
      });
    }

    if (isMicrofabricaLider || isMicrofabrica) {
      const qcCommissionResult = await computeQualityControlCommissionTotal(month, year);
      if (qcCommissionResult?.error) {
        return res.status(400).json({ error: qcCommissionResult.error });
      }
      return res.json({
        commission: Number(qcCommissionResult?.total || 0),
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: 0,
          source: 'Comisión mensual por piezas aprobadas de Control de Calidad'
        }
      });
    }

    // Non-sales roles without explicit commission rule.
    return res.json({
      commission: 0,
      isTopSeller: false,
      topSellerEmail: null,
      breakdown: { role: req.user.role || 'Sin rol', rate: 0, source: 'Rol sin comisión configurada' }
    });
  } catch (err) {
    console.error('Commission endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al calcular comisión: ' + err.message });
  }
});

// ─── Current user commission orders (debug/details) ─────────────────────────
app.get('/api/commission/current/orders', authenticateToken, async (req, res) => {
  const { month, year } = req.query;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });

  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === ROLE_KEYS.admin;
  const isVentasLider = userRoleNormalized === ROLE_KEYS.ventasLider;
  const isMarketingLider = userRoleNormalized === ROLE_KEYS.marketingLider;
  const isSalesSeller = userRoleNormalized === ROLE_KEYS.ventas || userRoleNormalized === 'sales' || userRoleNormalized === 'vendedor';
  const isAlmacen = userRoleNormalized === ROLE_KEYS.almacen;

  try {
    // Almacén: solo Enviado desde su ciudad/almacén local.
    if (isAlmacen) {
      const almacenDateFilter = buildDateFilter(month, year, 'q', 3);
      if (almacenDateFilter.error) return res.status(400).json({ error: almacenDateFilter.error });

      const cityScope = resolveInventoryScopeByCity(userContext.city || '');
      const localStore = cityScope?.canonical || userContext.city || '';
      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = $1
           AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
               LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
           ${almacenDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        ['Enviado', localStore, ...almacenDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        city: userContext.city || null,
        criteria: {
          status: 'Enviado',
          local_store_match: localStore || null,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Ventas: ventas propias en estados completados.
    if (isSalesSeller) {
      const ownDateFilter = buildDateFilter(month, year, 'q', 3);
      if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.user_id = $1
           AND q.status = ANY($2::text[])${ownDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [req.user.id, COMPLETED_STATUSES, ...ownDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          user_id: req.user.id,
          statuses: COMPLETED_STATUSES,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Ventas Lider: ventas del equipo Ventas + propias en estados completados.
    if (isVentasLider) {
      const teamDateFilter = buildDateFilter(month, year, 'q', 4);
      if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND (LOWER(u.role) = $2 OR u.id = $3)${teamDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventas, req.user.id, ...teamDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          statuses: COMPLETED_STATUSES,
          team_role: ROLE_KEYS.ventas,
          include_own_user_id: req.user.id,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Marketing Lider y Admin: todas las ventas completadas.
    if (isMarketingLider || isAdmin) {
      const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
      if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])${allSalesDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [COMPLETED_STATUSES, ...allSalesDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          statuses: COMPLETED_STATUSES,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    return res.json({
      role: req.user.role,
      criteria: { month, year },
      total_sales: 0,
      orders_count: 0,
      orders: [],
      note: 'Este rol no calcula comisión por pedidos en el endpoint actual'
    });
  } catch (err) {
    console.error('Commission orders endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener pedidos de comisión: ' + err.message });
  }
});

// ─── PRODUCT CATALOG (Admin CRUD for Cotizador) ─────────────────────────────
app.get('/api/product-catalog', authenticateToken, async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const includeInactive = Boolean(
      access?.admin &&
      ['1', 'true', 'si', 'yes'].includes(normalizeText(req.query?.include_inactive || ''))
    );
    const rows = await loadProductCatalogRows({ includeInactive });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar catálogo de productos' });
  }
});

app.post('/api/product-catalog', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const sku = validateProductSku(req.body?.sku);
    const normalized = normalizeProductPayload(req.body, { partial: false });
    const result = await pool.query(
      `INSERT INTO products (sku, name, sf_price, cf_price, is_active, last_updated)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       RETURNING sku, name, sf_price, cf_price, is_active`,
      [sku, normalized.name, normalized.sf_price, normalized.cf_price]
    );
    await loadProductCatalogRows();
    res.status(201).json({
      sku: String(result.rows[0].sku || '').toUpperCase(),
      name: result.rows[0].name,
      sf: Number(result.rows[0].sf_price || 0),
      cf: Number(result.rows[0].cf_price || 0),
      is_active: Boolean(result.rows[0].is_active)
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'El SKU ya existe' });
    res.status(500).json({ error: 'No se pudo crear producto' });
  }
});

app.patch('/api/product-catalog/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const sku = validateProductSku(req.params.sku);
    const normalized = normalizeProductPayload(req.body, { partial: true });
    const sets = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(normalized, 'name')) {
      values.push(normalized.name);
      sets.push(`name = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'sf_price')) {
      values.push(normalized.sf_price);
      sets.push(`sf_price = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'cf_price')) {
      values.push(normalized.cf_price);
      sets.push(`cf_price = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'is_active')) {
      values.push(Boolean(normalized.is_active));
      sets.push(`is_active = $${values.length}`);
    }
    values.push(sku);
    const result = await pool.query(
      `UPDATE products
       SET ${sets.join(', ')}, last_updated = NOW()
       WHERE sku = $${values.length}
       RETURNING sku, name, sf_price, cf_price, is_active`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    await loadProductCatalogRows();
    res.json({
      sku: String(result.rows[0].sku || '').toUpperCase(),
      name: result.rows[0].name,
      sf: Number(result.rows[0].sf_price || 0),
      cf: Number(result.rows[0].cf_price || 0),
      is_active: Boolean(result.rows[0].is_active)
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'No se pudo actualizar producto' });
  }
});

app.delete('/api/product-catalog/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const sku = validateProductSku(req.params.sku);
    const inUseRes = await pool.query(
      `SELECT 1
       FROM combo_items
       WHERE UPPER(sku) = $1
       LIMIT 1`,
      [sku]
    );
    if (inUseRes.rowCount > 0) {
      return res.status(409).json({ error: 'No se puede eliminar: producto usado en combos' });
    }
    const result = await pool.query(
      `UPDATE products
       SET is_active = FALSE, last_updated = NOW()
       WHERE sku = $1
       RETURNING sku`,
      [sku]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    await loadProductCatalogRows();
    res.json({ message: 'Producto desactivado', sku });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '42P01') return res.status(409).json({ error: 'No se pudo validar combos asociados' });
    res.status(500).json({ error: 'No se pudo eliminar producto' });
  }
});

// ─── INVENTORY ──────────────────────────────────────────────────────────────
app.get('/api/products', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  try {
    await ensureProductCatalogReady();
    if (!inventoryScope.isGlobal) {
      const stockField = inventoryScope.scope.stockField;
      const minField = inventoryScope.scope.minField;
      const result = await pool.query(`
        SELECT sku, name, ${stockField}, ${minField}, last_updated
        FROM products
        WHERE is_active = TRUE
        ORDER BY sku
      `);
      return res.json(result.rows);
    }

    const result = await pool.query(`
      SELECT sku, name, stock_cochabamba, stock_santacruz, stock_lima,
             min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
             last_updated
      FROM products
      WHERE is_active = TRUE
      ORDER BY sku
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

// ─── ADMIN DASHBOARD STATISTICS ─────────────────────────────────────────────
app.get('/api/admin/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { month, year } = req.query;
  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;

  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    return res.status(400).json({ error: 'Año inválido' });
  }

  const params = [];
  const dateClauses = [];
  if (monthNum !== null) {
    params.push(monthNum);
    dateClauses.push(`EXTRACT(MONTH FROM q.created_at) = $${params.length}`);
  }
  if (yearNum !== null) {
    params.push(yearNum);
    dateClauses.push(`EXTRACT(YEAR FROM q.created_at) = $${params.length}`);
  }
  const dateFilter = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';

  try {
    // 1. Most popular products
    const popularRes = await pool.query(`
      SELECT 
        li->>'sku' as sku,
        li->>'displayName' as name,
        SUM(CAST(li->>'qty' AS INTEGER)) as total_quantity
      FROM quotes q,
      LATERAL jsonb_array_elements(q.line_items) li
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY sku, name
      ORDER BY total_quantity DESC
      LIMIT 10
    `, params);

    // 2. Top salespeople
    const salesRes = await pool.query(`
      SELECT 
        q.vendor,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY q.vendor
      ORDER BY total_sales DESC
      LIMIT 10
    `, params);

    // 3. Top locations (departamento/provincia)
    const locRes = await pool.query(`
      SELECT 
        COALESCE(q.provincia, q.department, 'Sin ubicación') as location,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY location
      ORDER BY total_sales DESC
    `, params);

    // 4. Top almacenes by traffic (order count)
    const whRes = await pool.query(`
      SELECT 
        q.store_location,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY q.store_location
      ORDER BY order_count DESC
    `, params);

    res.json({
      popularProducts: popularRes.rows,
      topSalespeople: salesRes.rows,
      topLocations: locRes.rows,
      topWarehouses: whRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ─── QUALITY CONTROL ─────────────────────────────────────────────────────────
app.get('/api/qc/products', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para control de calidad' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productCatalog = await loadProductCatalogRows();
    const rows = productCatalog.map((item) => {
      const settings = settingsMap.get(String(item.sku || '').toUpperCase()) || { base_price: 0, commission_rate: 0 };
      return {
        sku: item.sku,
        name: item.name,
        base_price: Number(settings.base_price || 0),
        commission_rate: Number(settings.commission_rate || 0)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar productos de control de calidad' });
  }
});

app.post('/api/qc/checks', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para registrar control de calidad' });
  }

  const sku = String(req.body?.sku || '').toUpperCase().trim();
  const quantity = Number.parseInt(req.body?.quantity, 10);
  const resultValue = normalizeQcResult(req.body?.result);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Cantidad inválida. Debe ser un entero mayor a 0' });
  }
  if (!resultValue) {
    return res.status(400).json({ error: 'Resultado inválido. Debe ser Aprobado o Rechazado' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const productMap = await loadProductNameMap();
    if (!sku || !productMap.has(sku)) {
      return res.status(400).json({ error: 'Producto inválido para control de calidad' });
    }
    const productName = productMap.get(sku) || sku;
    const insertRes = await pool.query(
      `INSERT INTO quality_control_records (user_id, sku, product_name, quantity, result)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, sku, product_name, quantity, result, created_at`,
      [req.user.id, sku, productName, quantity, resultValue]
    );
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar control de calidad' });
  }
});

app.get('/api/qc/checks', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para ver control de calidad' });
  }

  const dateFilter = buildDateFilter(req.query.month, req.query.year, 'r', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    await ensureQcProductSettingsSeeded();
    const result = await pool.query(
      `SELECT r.id, r.user_id, u.email AS user_email, r.sku, r.product_name, r.quantity, r.result, r.created_at
       FROM quality_control_records r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE 1=1${dateFilter.sql}
       ORDER BY r.created_at DESC, r.id DESC`,
      [...dateFilter.params]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar registros de control de calidad' });
  }
});

app.patch('/api/qc/checks/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
  if (!access.control_calidad && !isAdmin) {
    return res.status(403).json({ error: 'No tienes permiso para editar control de calidad' });
  }

  const recordId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return res.status(400).json({ error: 'ID de registro inválido' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const existingRes = await pool.query(
      `SELECT id, user_id, sku, quantity, result
       FROM quality_control_records
       WHERE id = $1`,
      [recordId]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'Registro de control de calidad no encontrado' });
    }

    const existing = existingRes.rows[0];
    if (!isAdmin && Number(existing.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Solo puedes editar tus propios registros de control de calidad' });
    }

    const hasSku = Object.prototype.hasOwnProperty.call(req.body || {}, 'sku');
    const hasQuantity = Object.prototype.hasOwnProperty.call(req.body || {}, 'quantity');
    const hasResult = Object.prototype.hasOwnProperty.call(req.body || {}, 'result');
    if (!hasSku && !hasQuantity && !hasResult) {
      return res.status(400).json({ error: 'No se enviaron cambios para actualizar' });
    }

    const sku = hasSku
      ? String(req.body?.sku || '').toUpperCase().trim()
      : String(existing.sku || '').toUpperCase().trim();
    const quantity = hasQuantity
      ? Number.parseInt(req.body?.quantity, 10)
      : Number.parseInt(existing.quantity, 10);
    const resultValue = hasResult
      ? normalizeQcResult(req.body?.result)
      : normalizeQcResult(existing.result);

    const productNameMap = await getProductNameMap();
    if (!sku || !productNameMap.has(sku)) {
      return res.status(400).json({ error: 'Producto inválido para control de calidad' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida. Debe ser un entero mayor a 0' });
    }
    if (!resultValue) {
      return res.status(400).json({ error: 'Resultado inválido. Debe ser Aprobado o Rechazado' });
    }

    const productName = productNameMap.get(sku) || sku;
    const updateRes = await pool.query(
      `UPDATE quality_control_records
       SET sku = $1,
           product_name = $2,
           quantity = $3,
           result = $4
       WHERE id = $5
       RETURNING id, user_id, sku, product_name, quantity, result, created_at`,
      [sku, productName, quantity, resultValue, recordId]
    );

    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el registro de control de calidad' });
  }
});

app.delete('/api/qc/checks/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
  if (!access.control_calidad && !isAdmin) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar control de calidad' });
  }

  const recordId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return res.status(400).json({ error: 'ID de registro inválido' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const existingRes = await pool.query(
      `SELECT id, user_id
       FROM quality_control_records
       WHERE id = $1`,
      [recordId]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'Registro de control de calidad no encontrado' });
    }
    const existing = existingRes.rows[0];
    if (!isAdmin && Number(existing.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios registros de control de calidad' });
    }

    await pool.query(
      `DELETE FROM quality_control_records
       WHERE id = $1`,
      [recordId]
    );
    res.json({ message: 'Registro de control de calidad eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar el registro de control de calidad' });
  }
});

app.get('/api/qc/summary', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para ver resumen de control de calidad' });
  }

  const dateFilter = buildDateFilter(req.query.month, req.query.year, 'r', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productNameMap = await loadProductNameMap();
    const summaryRes = await pool.query(
      `SELECT r.sku, r.product_name,
              SUM(CASE WHEN r.result = 'passed' THEN r.quantity ELSE 0 END) AS qty_passed,
              SUM(CASE WHEN r.result = 'rejected' THEN r.quantity ELSE 0 END) AS qty_rejected
       FROM quality_control_records r
       WHERE 1=1${dateFilter.sql}
       GROUP BY r.sku, r.product_name
       ORDER BY r.sku ASC`,
      [...dateFilter.params]
    );
    const rows = summaryRes.rows.map((row) => {
      const sku = String(row.sku || '').toUpperCase();
      const settings = settingsMap.get(sku) || { base_price: 0, commission_rate: 0 };
      const qtyPassed = Number(row.qty_passed || 0);
      const qtyRejected = Number(row.qty_rejected || 0);
      const basePrice = Number(settings.base_price || 0);
      const commissionRate = Number(settings.commission_rate || 0);
      return {
        sku,
        product_name: row.product_name || productNameMap.get(sku) || sku,
        qty_passed: qtyPassed,
        qty_rejected: qtyRejected,
        base_price: basePrice,
        commission_rate: commissionRate,
        commission_total: qtyPassed * (basePrice * commissionRate / 100)
      };
    });
    const totalCommission = rows.reduce((sum, row) => sum + Number(row.commission_total || 0), 0);
    res.json({ rows, total_commission: totalCommission });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar resumen de control de calidad' });
  }
});

app.get('/api/microfabrica/dashboard', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
  if (!access.microfabrica_panel && !isAdmin) {
    return res.status(403).json({ error: 'No tienes permiso para ver el panel de microfabrica' });
  }

  const dateFilter = buildDateFilter(req.query.month, req.query.year, 'r', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productCatalog = await loadProductCatalogRows();
    const summaryRes = await pool.query(
      `SELECT UPPER(r.sku) AS sku,
              SUM(CASE WHEN r.result = 'passed' THEN r.quantity ELSE 0 END) AS qty_passed,
              SUM(CASE WHEN r.result = 'rejected' THEN r.quantity ELSE 0 END) AS qty_rejected
       FROM quality_control_records r
       WHERE 1=1${dateFilter.sql}
       GROUP BY UPPER(r.sku)`,
      [...dateFilter.params]
    );

    const bySku = new Map(
      summaryRes.rows.map((row) => [
        String(row.sku || '').toUpperCase(),
        {
          qty_passed: Number(row.qty_passed || 0),
          qty_rejected: Number(row.qty_rejected || 0)
        }
      ])
    );

    const rows = productCatalog.map((item) => {
      const sku = String(item.sku || '').toUpperCase();
      const totals = bySku.get(sku) || { qty_passed: 0, qty_rejected: 0 };
      const settings = settingsMap.get(sku) || { base_price: Number(item.sf || 0), commission_rate: 0 };
      const basePrice = Number(settings.base_price || 0);
      const commissionRate = Number(settings.commission_rate || 0);
      const commissionPerPiece = basePrice * commissionRate / 100;
      const subtotalCommission = Number(totals.qty_passed || 0) * commissionPerPiece;
      return {
        sku,
        product_name: item.name,
        qty_passed: Number(totals.qty_passed || 0),
        qty_rejected: Number(totals.qty_rejected || 0),
        base_price: basePrice,
        commission_rate: commissionRate,
        commission_per_piece: commissionPerPiece,
        subtotal_commission: subtotalCommission
      };
    });

    const totals = rows.reduce((acc, row) => {
      acc.qty_passed += Number(row.qty_passed || 0);
      acc.qty_rejected += Number(row.qty_rejected || 0);
      acc.total_commission += Number(row.subtotal_commission || 0);
      if (Number(row.qty_passed || 0) > 0 || Number(row.qty_rejected || 0) > 0) {
        acc.products_with_activity += 1;
      }
      return acc;
    }, {
      qty_passed: 0,
      qty_rejected: 0,
      total_commission: 0,
      products_with_activity: 0
    });

    res.json({
      rows,
      totals,
      month: req.query.month ? Number.parseInt(req.query.month, 10) : null,
      year: req.query.year ? Number.parseInt(req.query.year, 10) : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el panel de microfabrica' });
  }
});

app.get('/api/qc/commissions', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productCatalog = await loadProductCatalogRows();
    const rows = productCatalog.map((item) => {
      const settings = settingsMap.get(String(item.sku || '').toUpperCase()) || { base_price: 0, commission_rate: 0 };
      return {
        sku: item.sku,
        name: item.name,
        base_price: Number(settings.base_price || 0),
        commission_rate: Number(settings.commission_rate || 0)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar comisiones por producto de control de calidad' });
  }
});

app.patch('/api/qc/commissions', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No se enviaron filas para actualizar' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const productNameMap = await loadProductNameMap();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const sku = String(row?.sku || '').toUpperCase().trim();
        if (!sku || !productNameMap.has(sku)) continue;
        const rate = Math.max(0, Math.min(100, Number(row?.commission_rate || 0)));
        const basePrice = Math.max(0, Number(row?.base_price || 0));
        await client.query(
          `INSERT INTO quality_control_settings (sku, base_price, commission_rate, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (sku) DO UPDATE
           SET base_price = EXCLUDED.base_price,
               commission_rate = EXCLUDED.commission_rate,
               updated_at = NOW()`,
          [sku, basePrice, rate]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ message: 'Comisiones por producto actualizadas' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron guardar comisiones de control de calidad' });
  }
});

app.patch('/api/me', authenticateToken, async (req, res) => {
  const { email, city, phone } = req.body || {};
  const hasEmail = email !== undefined;
  const hasCity = city !== undefined;
  const hasPhone = phone !== undefined;

  if (!hasEmail && !hasCity && !hasPhone) {
    return res.status(400).json({ error: 'No se enviaron cambios para actualizar perfil' });
  }

  const nextEmail = hasEmail ? String(email || '').trim().toLowerCase() : undefined;
  const nextCity = hasCity ? (city ? String(city).trim() : null) : undefined;
  const nextPhone = hasPhone ? (phone ? String(phone).trim() : null) : undefined;

  if (hasEmail) {
    if (!nextEmail) {
      return res.status(400).json({ error: 'El correo no puede estar vacío' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: 'Correo electrónico inválido' });
    }
  }

  if (hasPhone && nextPhone && !/^\d{8}$/.test(nextPhone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const currentUser = await loadUserContext(req.user.id);
    if (!currentUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updatedEmail = hasEmail ? nextEmail : currentUser.email;
    const updatedCity = hasCity ? nextCity : currentUser.city;
    const updatedPhone = hasPhone ? nextPhone : currentUser.phone;

    const result = await pool.query(
      `UPDATE users
       SET email = $1,
           city = $2,
           phone = $3
       WHERE id = $4
       RETURNING id, email, role, city, phone, panel_access`,
      [updatedEmail, updatedCity, updatedPhone, req.user.id]
    );

    const updatedUser = result.rows[0];
    if (!updatedUser) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Perfil actualizado', user: buildUserPayload(updatedUser) });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El correo ya está en uso por otro usuario' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el perfil' });
  }
});

app.patch('/api/me/password', authenticateToken, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Debes enviar contraseña actual y nueva contraseña' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (confirm_password !== undefined && new_password !== confirm_password) {
    return res.status(400).json({ error: 'La confirmación de contraseña no coincide' });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = result.rows[0];
    const isValidCurrent = await bcrypt.compare(String(current_password), String(user.password_hash || ''));
    if (!isValidCurrent) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    const hashedPass = await bcrypt.hash(String(new_password), 10);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashedPass, req.user.id]
    );

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  }
});

app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const userRow = await loadUserContext(req.user.id);
    if (!userRow) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(buildUserPayload(userRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar sesión' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});