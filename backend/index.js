const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
const CUSTOMER_MENU_IMAGE_DIR = path.resolve(__dirname, 'customer-menu-images');
if (!fsSync.existsSync(CUSTOMER_MENU_IMAGE_DIR)) {
  fsSync.mkdirSync(CUSTOMER_MENU_IMAGE_DIR, { recursive: true });
}
app.use('/customer-menu-images', express.static(CUSTOMER_MENU_IMAGE_DIR));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const ensureUsersSchema = async () => {
  try {
    await pool.query(
      `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`
    );
    await pool.query(
      `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS display_name TEXT`
    );
  } catch (err) {
    console.error('No se pudo asegurar esquema users:', err.message);
  }
};

const ensureQuotesSchema = async () => {
  try {
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_code TEXT`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_discount_percent NUMERIC(10,4) DEFAULT 0`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_selection TEXT`
    );
  } catch (err) {
    console.error('No se pudo asegurar esquema quotes:', err.message);
  }
};

const ensureQuoteMarketingFields = async () => {
  try {
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_code TEXT`
    );
    await pool.query(
      `ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_option TEXT`
    );
  } catch (err) {
    console.error('No se pudo asegurar campos marketing en quotes:', err.message);
  }
};

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
  'menu_cliente',
  'calendario',
  'proyectos_panel',
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
  'gastos_panel',
  'marketing_combos',
  'marketing_cupones',
  'admin'
];

const getDefaultPanelAccessForRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  const base = {
    cotizar: false,
    menu_cliente: false,
    calendario: false,
    proyectos_panel: true,
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
    gastos_panel: false,
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
      menu_cliente: true,
      calendario: true,
      historial_individual: true,
      rendimiento_individual: true
    };
  }

  if (role === 'ventas lider') {
    return {
      ...base,
      cotizar: true,
      menu_cliente: true,
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

const EXPENSE_RECURRENCE_VALUES = ['weekly', 'monthly', 'quarterly', 'yearly'];
const EXPENSE_DEPARTMENT_BY_ROLE = {
  [ROLE_KEYS.admin]: 'Administración',
  [ROLE_KEYS.ventas]: 'Ventas',
  [ROLE_KEYS.ventasLider]: 'Ventas',
  [ROLE_KEYS.almacen]: 'Almacén',
  [ROLE_KEYS.almacenLider]: 'Almacén',
  [ROLE_KEYS.marketing]: 'Marketing',
  [ROLE_KEYS.marketingLider]: 'Marketing',
  [ROLE_KEYS.microfabrica]: 'Microfábrica',
  [ROLE_KEYS.microfabricaLider]: 'Microfábrica'
};
const PROJECT_AREA_VALUES = ['Marketing', 'Microfabrica', 'Almacen', 'Desarrollo', 'Ventas'];
const PROJECT_TASK_TYPE_VALUES = ['rutina', 'mejora', 'rutina_mejora'];
const PROJECT_TASK_STATUS_VALUES = ['pendiente', 'en_progreso', 'completada', 'bloqueada'];
const PROJECT_VERSION_BUMP_VALUES = ['none', 'patch', 'minor', 'major'];

const resolveDepartmentFromRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  return EXPENSE_DEPARTMENT_BY_ROLE[role] || null;
};

const normalizeRecurringPeriod = (value = '') => {
  const normalized = normalizeText(value).replace(/_/g, ' ').replace(/\s+/g, ' ');
  const map = {
    weekly: 'weekly',
    semanal: 'weekly',
    month: 'monthly',
    monthly: 'monthly',
    mensual: 'monthly',
    quarter: 'quarterly',
    quarterly: 'quarterly',
    trimestral: 'quarterly',
    annual: 'yearly',
    yearly: 'yearly',
    anual: 'yearly'
  };
  return map[normalized] || null;
};

const normalizeDepartmentLabel = (value = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\s+/g, ' ')
    .slice(0, 80);
};

const normalizeProjectArea = (value = '') => {
  const normalized = normalizeText(value);
  const map = {
    marketing: 'Marketing',
    microfabrica: 'Microfabrica',
    'micro fabrica': 'Microfabrica',
    almacen: 'Almacen',
    storage: 'Almacen',
    desarrollo: 'Desarrollo',
    development: 'Desarrollo',
    ventas: 'Ventas',
    sales: 'Ventas'
  };
  return map[normalized] || null;
};

const normalizeProjectTaskType = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  const map = {
    rutina: 'rutina',
    routine: 'rutina',
    mejora: 'mejora',
    improvement: 'mejora',
    rutina_mejora: 'rutina_mejora',
    rutina_con_mejora: 'rutina_mejora',
    rutina_y_mejora: 'rutina_mejora',
    routine_improvement: 'rutina_mejora',
    routine_and_improvement: 'rutina_mejora'
  };
  return map[normalized] || null;
};

const normalizeProjectTaskStatus = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  const map = {
    pendiente: 'pendiente',
    pending: 'pendiente',
    en_progreso: 'en_progreso',
    progreso: 'en_progreso',
    in_progress: 'en_progreso',
    completada: 'completada',
    completado: 'completada',
    completed: 'completada',
    done: 'completada',
    bloqueada: 'bloqueada',
    bloqueado: 'bloqueada',
    blocked: 'bloqueada'
  };
  return map[normalized] || null;
};

const normalizeProjectVersionBump = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  const map = {
    none: 'none',
    ninguna: 'none',
    no: 'none',
    patch: 'patch',
    correccion: 'patch',
    correction: 'patch',
    minor: 'minor',
    menor: 'minor',
    major: 'major',
    mayor: 'major'
  };
  return map[normalized] || null;
};

const normalizeProjectDateInput = (value, fieldLabel) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const dateText = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw createHttpError(400, `${fieldLabel} inválida. Usa formato YYYY-MM-DD`);
  }
  return dateText;
};

const bumpSemver = (currentVersion, bumpType) => {
  const current = {
    major: Math.max(0, Number.parseInt(currentVersion?.major, 10) || 0),
    minor: Math.max(0, Number.parseInt(currentVersion?.minor, 10) || 0),
    patch: Math.max(0, Number.parseInt(currentVersion?.patch, 10) || 0)
  };
  if (bumpType === 'major') {
    return { major: current.major + 1, minor: 0, patch: 0 };
  }
  if (bumpType === 'minor') {
    return { major: current.major, minor: current.minor + 1, patch: 0 };
  }
  if (bumpType === 'patch') {
    return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  }
  return current;
};

const parseBooleanLike = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  const normalized = normalizeText(String(value));
  if (['1', 'true', 'si', 'sí', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return fallback;
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

const ensureExpensesTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS department_expenses (
       id BIGSERIAL PRIMARY KEY,
       department TEXT NOT NULL,
       category TEXT NOT NULL DEFAULT 'Operativo',
       concept TEXT NOT NULL,
       vendor TEXT,
       amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
       currency TEXT NOT NULL DEFAULT 'BOB',
       is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
       recurrence_period TEXT,
       expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
       notes TEXT,
       created_by INTEGER NOT NULL REFERENCES users(id),
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       CONSTRAINT department_expenses_recurrence_chk CHECK (
         (is_recurring = FALSE AND recurrence_period IS NULL)
         OR (is_recurring = TRUE AND recurrence_period IN ('weekly', 'monthly', 'quarterly', 'yearly'))
       )
     )`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'General'`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Operativo'`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS concept TEXT NOT NULL DEFAULT 'Gasto'`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS vendor TEXT`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'BOB'`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS recurrence_period TEXT`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS expense_date DATE NOT NULL DEFAULT CURRENT_DATE`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS notes TEXT`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_department_expenses_department_date
     ON department_expenses (department, expense_date DESC, id DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_department_expenses_recurring
     ON department_expenses (is_recurring, recurrence_period)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_department_expenses_concept
     ON department_expenses (LOWER(concept))`
  );
};

const ensureProjectsTables = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS projects (
       id BIGSERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       description TEXT,
       area TEXT NOT NULL,
       work_type TEXT NOT NULL DEFAULT 'rutina_mejora',
       version_major INTEGER NOT NULL DEFAULT 1,
       version_minor INTEGER NOT NULL DEFAULT 0,
       version_patch INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       is_active BOOLEAN NOT NULL DEFAULT TRUE
     )`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS name TEXT`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS description TEXT`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS area TEXT`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS work_type TEXT NOT NULL DEFAULT 'rutina_mejora'`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_major INTEGER NOT NULL DEFAULT 1`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_minor INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_patch INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_projects_area_active
     ON projects (LOWER(area), is_active, updated_at DESC)`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_tasks (
       id BIGSERIAL PRIMARY KEY,
       project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       description TEXT,
       assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       start_date DATE,
       due_date DATE,
       status TEXT NOT NULL DEFAULT 'pendiente',
       progress_percent INTEGER NOT NULL DEFAULT 0,
       task_type TEXT NOT NULL DEFAULT 'rutina',
       version_bump TEXT NOT NULL DEFAULT 'none',
       version_applied BOOLEAN NOT NULL DEFAULT FALSE,
       cost NUMERIC(12,2),
       created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     )`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS title TEXT`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS description TEXT`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS start_date DATE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS due_date DATE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendiente'`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'rutina'`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS version_bump TEXT NOT NULL DEFAULT 'none'`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS version_applied BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS cost NUMERIC(12,2)`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_tasks_project
     ON project_tasks (project_id, updated_at DESC, id DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee
     ON project_tasks (assignee_user_id, status, due_date)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_tasks_dates
     ON project_tasks (start_date, due_date)`
  );
};

const mapExpenseRow = (row = {}) => ({
  id: Number(row.id),
  department: String(row.department || '').trim(),
  category: String(row.category || '').trim(),
  concept: String(row.concept || '').trim(),
  vendor: row.vendor || null,
  amount: Number(row.amount || 0),
  currency: String(row.currency || 'BOB').trim().toUpperCase(),
  is_recurring: Boolean(row.is_recurring),
  recurrence_period: row.recurrence_period || null,
  expense_date: row.expense_date,
  notes: row.notes || null,
  created_by: Number(row.created_by || 0),
  created_by_email: row.created_by_email || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

const formatProjectVersion = (row = {}) => {
  const major = Math.max(0, Number.parseInt(row.version_major, 10) || 0);
  const minor = Math.max(0, Number.parseInt(row.version_minor, 10) || 0);
  const patch = Math.max(0, Number.parseInt(row.version_patch, 10) || 0);
  return `${major}.${minor}.${patch}`;
};

const normalizeProjectDateOutput = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const mapProjectRow = (row = {}) => ({
  id: Number(row.id),
  name: String(row.name || '').trim(),
  description: row.description || null,
  area: normalizeProjectArea(row.area || '') || String(row.area || '').trim(),
  work_type: normalizeProjectTaskType(row.work_type || '') || 'rutina_mejora',
  version_major: Math.max(0, Number.parseInt(row.version_major, 10) || 0),
  version_minor: Math.max(0, Number.parseInt(row.version_minor, 10) || 0),
  version_patch: Math.max(0, Number.parseInt(row.version_patch, 10) || 0),
  version: formatProjectVersion(row),
  created_by: row.created_by !== null && row.created_by !== undefined ? Number(row.created_by) : null,
  created_by_name: resolveUserDisplayName({ display_name: row.created_by_name, email: row.created_by_email }, 'Usuario'),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  is_active: row.is_active !== false
});

const mapProjectTaskRow = (row = {}) => ({
  id: Number(row.id),
  project_id: Number(row.project_id),
  project_name: String(row.project_name || '').trim(),
  project_area: normalizeProjectArea(row.project_area || '') || String(row.project_area || '').trim(),
  title: String(row.title || '').trim(),
  description: row.description || null,
  assignee_user_id: row.assignee_user_id !== null && row.assignee_user_id !== undefined
    ? Number(row.assignee_user_id)
    : null,
  assignee_name: row.assignee_user_id
    ? resolveUserDisplayName({ display_name: row.assignee_name, email: row.assignee_email }, 'Sin asignar')
    : 'Sin asignar',
  start_date: normalizeProjectDateOutput(row.start_date),
  due_date: normalizeProjectDateOutput(row.due_date),
  status: normalizeProjectTaskStatus(row.status || '') || 'pendiente',
  progress_percent: Math.max(0, Math.min(100, Number.parseInt(row.progress_percent, 10) || 0)),
  task_type: normalizeProjectTaskType(row.task_type || '') || 'rutina',
  version_bump: normalizeProjectVersionBump(row.version_bump || '') || 'none',
  version_applied: Boolean(row.version_applied),
  cost: row.cost !== null && row.cost !== undefined ? Number(row.cost) : null,
  created_by: row.created_by !== null && row.created_by !== undefined ? Number(row.created_by) : null,
  created_by_name: resolveUserDisplayName({ display_name: row.created_by_name, email: row.created_by_email }, 'Usuario'),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

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
const CUSTOMER_MENU_CATEGORY_TABLEROS = 'Tableros';
const CUSTOMER_MENU_CATEGORY_ACCESORIOS = 'Accesorios';
const CUSTOMER_MENU_CATEGORIES = [CUSTOMER_MENU_CATEGORY_TABLEROS, CUSTOMER_MENU_CATEGORY_ACCESORIOS];
const CUSTOMER_MENU_TOKEN_PURPOSE = 'customer_menu_share';
const CUSTOMER_MENU_TOKEN_TTL = process.env.CUSTOMER_MENU_TOKEN_TTL || '30d';
const CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const LEGACY_MENU_IMAGE_DIR = path.resolve(__dirname, '../frontend/public/menu-images');
const CUSTOMER_MENU_IMAGE_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const ensureCustomerMenuImageDir = async () => {
  await fs.mkdir(CUSTOMER_MENU_IMAGE_DIR, { recursive: true });
};

const getRequestOrigin = (req) => {
  const forwardedProtoRaw = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHostRaw = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProtoRaw || req.protocol || 'http';
  const host = forwardedHostRaw || String(req.headers.host || '').trim();
  return host ? `${protocol}://${host}` : '';
};

const toCustomerMenuImageAbsoluteUrl = (req, relativePath) => {
  const origin = getRequestOrigin(req);
  if (!origin) return relativePath;
  return `${origin}${relativePath}`;
};

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
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS menu_category TEXT`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT`);

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
        `SELECT sku, name, sf_price, cf_price, menu_category, image_url
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
    `SELECT sku, name, sf_price, cf_price, is_active, menu_category, image_url
     FROM products
     ${whereClause}
     ORDER BY UPPER(name) ASC, UPPER(sku) ASC`
  );
  const rows = (result.rows || []).map((row) => ({
    sku: String(row.sku || '').toUpperCase(),
    name: String(row.name || '').trim(),
    sf: Number(row.sf_price || 0),
    cf: Number(row.cf_price || 0),
    is_active: Boolean(row.is_active),
    menu_category: String(row.menu_category || '').trim() || null,
    image_url: String(row.image_url || '').trim() || null
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
  const hasMenuCategory = Object.prototype.hasOwnProperty.call(src, 'menu_category');
  const hasImageUrl = Object.prototype.hasOwnProperty.call(src, 'image_url');

  if (!partial && (!hasName || !hasSf || !hasCf)) {
    throw createHttpError(400, 'Debes enviar name, sf y cf');
  }
  if (partial && !hasName && !hasSf && !hasCf && !hasIsActive && !hasMenuCategory && !hasImageUrl) {
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
  if (hasMenuCategory) {
    const raw = String(src.menu_category || '').trim();
    if (!raw) {
      normalized.menu_category = null;
    } else {
      const key = normalizeText(raw);
      if (['tablero', 'tableros', 'boards', 'board'].includes(key)) {
        normalized.menu_category = CUSTOMER_MENU_CATEGORY_TABLEROS;
      } else if (['accesorio', 'accesorios', 'accessory', 'accessories'].includes(key)) {
        normalized.menu_category = CUSTOMER_MENU_CATEGORY_ACCESORIOS;
      } else {
        throw createHttpError(400, 'menu_category inválida. Usa Tableros o Accesorios');
      }
    }
  }
  if (hasImageUrl) {
    const urlValue = String(src.image_url || '').trim();
    if (!urlValue) {
      normalized.image_url = null;
    } else {
      const isHttpUrl = /^https?:\/\//i.test(urlValue);
      const isRelativePath = /^\/[a-zA-Z0-9/_\-.%]+$/.test(urlValue) && !urlValue.includes('..');
      if (!isHttpUrl && !isRelativePath) {
        throw createHttpError(400, 'image_url debe ser URL http(s) o ruta local iniciando con /');
      }
      if (urlValue.length > 500) {
        throw createHttpError(400, 'image_url demasiado larga (máx 500)');
      }
      normalized.image_url = urlValue;
    }
  }
  return normalized;
};

const inferProductMenuCategory = (productRow = {}) => {
  const explicit = normalizeText(productRow.menu_category || '');
  if (explicit) {
    if (explicit === 'tablero' || explicit === 'tableros' || explicit === 'board' || explicit === 'boards') {
      return CUSTOMER_MENU_CATEGORY_TABLEROS;
    }
    if (explicit === 'accesorio' || explicit === 'accesorios' || explicit === 'accessory' || explicit === 'accessories') {
      return CUSTOMER_MENU_CATEGORY_ACCESORIOS;
    }
  }
  const sku = String(productRow.sku || '').toUpperCase();
  const name = normalizeText(productRow.name || '');
  if (sku.startsWith('T') || name.includes('tablero')) return CUSTOMER_MENU_CATEGORY_TABLEROS;
  return CUSTOMER_MENU_CATEGORY_ACCESORIOS;
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

const getExpensesAccessScope = (userContext, access) => {
  const hasExpensesPanel = Boolean(access?.gastos_panel);
  const isAdmin = normalizeRole(userContext?.role || '') === ROLE_KEYS.admin;
  if (!hasExpensesPanel && !isAdmin) {
    return { error: 'No tienes permiso para gastos' };
  }
  if (isAdmin) {
    return { isAdmin: true, department: null };
  }
  const department = resolveDepartmentFromRole(userContext?.role || '');
  if (!department) {
    return { error: 'No se pudo determinar tu departamento para registrar gastos' };
  }
  return { isAdmin: false, department };
};

const getProjectsAccessScope = (userContext, access) => {
  const hasProjectsPanel = Boolean(access?.proyectos_panel);
  if (!userContext?.id) {
    return { error: 'Usuario no encontrado' };
  }
  if (!hasProjectsPanel) {
    return { error: 'No tienes permiso para proyectos' };
  }
  return { allowed: true };
};

const createHttpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeDisplayName = (value, { required = false, fieldLabel = 'Nombre visible' } = {}) => {
  if (value === undefined) {
    if (required) throw createHttpError(400, `${fieldLabel} requerido`);
    return undefined;
  }
  const name = String(value || '').trim();
  if (!name) {
    if (required) throw createHttpError(400, `${fieldLabel} requerido`);
    return null;
  }
  if (name.length > 80) {
    throw createHttpError(400, `${fieldLabel} demasiado largo (máx 80)`);
  }
  return name;
};

const resolveUserDisplayName = (row = {}, fallback = '') => {
  const preferred = String(row?.display_name || '').trim();
  if (preferred) return preferred;
  const emailBase = String(row?.email || '').split('@')[0].trim();
  if (emailBase) return emailBase;
  return fallback || 'Usuario';
};

const normalizeExpenseDateInput = (value, fieldLabel = 'Fecha del gasto') => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const dateText = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw createHttpError(400, `${fieldLabel} inválida. Usa formato YYYY-MM-DD`);
  }
  return dateText;
};

const normalizeExpensePayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  const normalized = {};

  if (!partial || has('department')) {
    const value = normalizeDepartmentLabel(src.department || '');
    if (!partial && !value) {
      throw createHttpError(400, 'Departamento requerido');
    }
    if (has('department')) {
      if (!value) throw createHttpError(400, 'Departamento inválido');
      normalized.department = value;
    }
  }

  if (!partial || has('concept')) {
    const concept = String(src.concept || '').trim();
    if (!concept) throw createHttpError(400, 'Concepto requerido');
    if (concept.length > 140) throw createHttpError(400, 'Concepto demasiado largo (máx 140)');
    normalized.concept = concept;
  }

  if (!partial || has('amount')) {
    const amount = Number(src.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw createHttpError(400, 'Monto inválido (debe ser mayor a 0)');
    }
    normalized.amount = amount;
  }

  if (!partial || has('category')) {
    const category = String(src.category || 'Operativo').trim();
    if (!category) throw createHttpError(400, 'Categoría inválida');
    if (category.length > 80) throw createHttpError(400, 'Categoría demasiado larga (máx 80)');
    normalized.category = category;
  }

  if (!partial || has('currency')) {
    const currency = String(src.currency || 'BOB').trim().toUpperCase();
    if (!currency) throw createHttpError(400, 'Moneda inválida');
    if (currency.length > 10) throw createHttpError(400, 'Moneda inválida');
    normalized.currency = currency;
  }

  if (has('vendor')) {
    const vendor = String(src.vendor || '').trim();
    if (vendor.length > 140) throw createHttpError(400, 'Proveedor demasiado largo (máx 140)');
    normalized.vendor = vendor || null;
  } else if (!partial) {
    normalized.vendor = null;
  }

  if (has('notes')) {
    const notes = String(src.notes || '').trim();
    if (notes.length > 600) throw createHttpError(400, 'Notas demasiado largas (máx 600)');
    normalized.notes = notes || null;
  } else if (!partial) {
    normalized.notes = null;
  }

  if (!partial || has('expense_date')) {
    const dateValue = normalizeExpenseDateInput(src.expense_date, 'Fecha de gasto');
    if (has('expense_date')) {
      normalized.expense_date = dateValue;
    } else if (!partial) {
      normalized.expense_date = new Date().toISOString().slice(0, 10);
    }
  }

  const recurringProvided = has('is_recurring');
  const recurrenceProvided = has('recurrence_period');
  if (!partial || recurringProvided || recurrenceProvided) {
    const isRecurring = recurringProvided
      ? parseBooleanLike(src.is_recurring, false)
      : (!partial ? false : undefined);
    const recurrenceNormalized = recurrenceProvided
      ? normalizeRecurringPeriod(src.recurrence_period || '')
      : undefined;

    if (recurringProvided) {
      normalized.is_recurring = isRecurring;
    } else if (!partial) {
      normalized.is_recurring = false;
    }

    if (recurrenceProvided) {
      if (String(src.recurrence_period || '').trim() !== '' && !recurrenceNormalized) {
        throw createHttpError(400, 'Frecuencia recurrente inválida');
      }
      normalized.recurrence_period = recurrenceNormalized || null;
    } else if (!partial) {
      normalized.recurrence_period = null;
    }

    const effectiveRecurring = recurringProvided
      ? isRecurring
      : (partial ? undefined : false);
    const effectiveRecurrence = recurrenceProvided
      ? (recurrenceNormalized || null)
      : (!partial ? null : undefined);

    if (effectiveRecurring === true && effectiveRecurrence === null) {
      throw createHttpError(400, 'Debes indicar frecuencia para gastos recurrentes');
    }
    if (effectiveRecurring === false && recurrenceProvided && recurrenceNormalized) {
      throw createHttpError(400, 'Frecuencia recurrente solo aplica cuando el gasto es recurrente');
    }
  }

  return normalized;
};

const normalizeProjectPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  const normalized = {};

  if (!partial || has('name')) {
    const name = String(src.name || '').trim();
    if (!name) throw createHttpError(400, 'Nombre del proyecto requerido');
    if (name.length > 140) throw createHttpError(400, 'Nombre del proyecto demasiado largo (máx 140)');
    normalized.name = name;
  }

  if (!partial || has('description')) {
    const description = String(src.description || '').trim();
    if (description.length > 2000) throw createHttpError(400, 'Descripción demasiado larga (máx 2000)');
    normalized.description = description || null;
  }

  if (!partial || has('area')) {
    const area = normalizeProjectArea(src.area || '');
    if (!area) {
      throw createHttpError(400, `Área inválida. Usa: ${PROJECT_AREA_VALUES.join(', ')}`);
    }
    normalized.area = area;
  }

  if (!partial || has('work_type')) {
    const workType = normalizeProjectTaskType(src.work_type || src.type || 'rutina_mejora');
    if (!workType) {
      throw createHttpError(400, 'Tipo de proyecto inválido. Usa: rutina, mejora o rutina_mejora');
    }
    normalized.work_type = workType;
  }

  const versionKeys = ['version_major', 'version_minor', 'version_patch'];
  const hasVersionOverride = versionKeys.some((key) => has(key));
  if (!partial || hasVersionOverride) {
    const major = Number.parseInt(src.version_major ?? 1, 10);
    const minor = Number.parseInt(src.version_minor ?? 0, 10);
    const patch = Number.parseInt(src.version_patch ?? 0, 10);
    if (![major, minor, patch].every((value) => Number.isInteger(value) && value >= 0 && value <= 9999)) {
      throw createHttpError(400, 'Versión inválida. Usa números enteros entre 0 y 9999');
    }
    normalized.version_major = major;
    normalized.version_minor = minor;
    normalized.version_patch = patch;
  }

  return normalized;
};

const normalizeProjectTaskPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  const normalized = {};

  if (!partial || has('title')) {
    const title = String(src.title || '').trim();
    if (!title) throw createHttpError(400, 'Título de la tarea requerido');
    if (title.length > 180) throw createHttpError(400, 'Título de la tarea demasiado largo (máx 180)');
    normalized.title = title;
  }

  if (!partial || has('description')) {
    const description = String(src.description || '').trim();
    if (description.length > 2500) throw createHttpError(400, 'Descripción de la tarea demasiado larga (máx 2500)');
    normalized.description = description || null;
  }

  if (!partial || has('assignee_user_id')) {
    const rawAssignee = src.assignee_user_id;
    if (rawAssignee === null || rawAssignee === '' || rawAssignee === undefined) {
      normalized.assignee_user_id = null;
    } else {
      const assigneeId = Number.parseInt(rawAssignee, 10);
      if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
        throw createHttpError(400, 'Usuario asignado inválido');
      }
      normalized.assignee_user_id = assigneeId;
    }
  }

  if (!partial || has('start_date')) {
    normalized.start_date = normalizeProjectDateInput(src.start_date, 'Fecha de inicio');
  }

  if (!partial || has('due_date')) {
    normalized.due_date = normalizeProjectDateInput(src.due_date, 'Fecha de entrega');
  }

  const effectiveStart = Object.prototype.hasOwnProperty.call(normalized, 'start_date') ? normalized.start_date : null;
  const effectiveDue = Object.prototype.hasOwnProperty.call(normalized, 'due_date') ? normalized.due_date : null;
  if (effectiveStart && effectiveDue && effectiveDue < effectiveStart) {
    throw createHttpError(400, 'La fecha de entrega no puede ser menor a la fecha de inicio');
  }

  if (!partial || has('status')) {
    const status = normalizeProjectTaskStatus(src.status || 'pendiente');
    if (!status) {
      throw createHttpError(400, `Estado inválido. Usa: ${PROJECT_TASK_STATUS_VALUES.join(', ')}`);
    }
    normalized.status = status;
  }

  if (!partial || has('progress_percent') || has('progress')) {
    const rawProgress = src.progress_percent ?? src.progress ?? 0;
    const progress = Number.parseInt(rawProgress, 10);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw createHttpError(400, 'Progreso inválido. Usa un número entero entre 0 y 100');
    }
    normalized.progress_percent = progress;
  }

  if (!partial || has('task_type') || has('type')) {
    const taskType = normalizeProjectTaskType(src.task_type || src.type || 'rutina');
    if (!taskType) {
      throw createHttpError(400, `Tipo de tarea inválido. Usa: ${PROJECT_TASK_TYPE_VALUES.join(', ')}`);
    }
    normalized.task_type = taskType;
  }

  if (!partial || has('version_bump') || has('version_change')) {
    const versionBump = normalizeProjectVersionBump(src.version_bump || src.version_change || 'none');
    if (!versionBump) {
      throw createHttpError(400, `Cambio de versión inválido. Usa: ${PROJECT_VERSION_BUMP_VALUES.join(', ')}`);
    }
    normalized.version_bump = versionBump;
  }

  if (!partial || has('cost')) {
    const rawCost = src.cost;
    if (rawCost === '' || rawCost === null || rawCost === undefined) {
      normalized.cost = null;
    } else {
      const cost = Number(rawCost);
      if (!Number.isFinite(cost) || cost < 0 || cost > 1000000000) {
        throw createHttpError(400, 'Costo inválido. Debe ser un número entre 0 y 1000000000');
      }
      normalized.cost = Number(cost.toFixed(2));
    }
  }

  const effectiveStatus = Object.prototype.hasOwnProperty.call(normalized, 'status')
    ? normalized.status
    : null;
  if (effectiveStatus === 'completada') {
    normalized.progress_percent = 100;
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'progress_percent')
    && normalized.progress_percent === 100
    && !Object.prototype.hasOwnProperty.call(normalized, 'status')
    && !partial) {
    normalized.status = 'completada';
  }

  return normalized;
};

const maybeApplyTaskVersionBump = async (client, taskRow) => {
  const status = normalizeProjectTaskStatus(taskRow?.status || '');
  const bumpType = normalizeProjectVersionBump(taskRow?.version_bump || '');
  const alreadyApplied = Boolean(taskRow?.version_applied);
  if (status !== 'completada' || !bumpType || bumpType === 'none' || alreadyApplied) {
    return null;
  }

  const projectRes = await client.query(
    `SELECT id, version_major, version_minor, version_patch
     FROM projects
     WHERE id = $1
       AND is_active = TRUE
     FOR UPDATE`,
    [taskRow.project_id]
  );
  if (projectRes.rowCount === 0) {
    throw createHttpError(404, 'Proyecto no encontrado');
  }
  const current = projectRes.rows[0];
  const nextVersion = bumpSemver(
    {
      major: current.version_major,
      minor: current.version_minor,
      patch: current.version_patch
    },
    bumpType
  );
  await client.query(
    `UPDATE projects
     SET version_major = $1,
         version_minor = $2,
         version_patch = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [nextVersion.major, nextVersion.minor, nextVersion.patch, taskRow.project_id]
  );
  await client.query(
    `UPDATE project_tasks
     SET version_applied = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [taskRow.id]
  );
  return nextVersion;
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

const getUserDisplayName = (userRow, fallback = 'Usuario') => {
  const explicit = String(userRow?.display_name || '').trim();
  if (explicit) return explicit;
  const fromEmail = String(userRow?.email || '').split('@')[0].trim();
  return fromEmail || fallback;
};

const buildUserPayload = (userRow) => {
  const panel_access = sanitizePanelAccess(userRow.panel_access, userRow.role);
  return {
    id: userRow.id,
    email: userRow.email,
    display_name: getUserDisplayName(userRow),
    role: userRow.role,
    city: userRow.city,
    phone: userRow.phone,
    panel_access
  };
};

const loadUserContext = async (userId) => {
  const result = await pool.query(
    'SELECT id, email, display_name, role, city, phone, panel_access FROM users WHERE id = $1',
    [userId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

const resolveAssignableVendorName = async (sellerUserId, fallbackName = '') => {
  const parsedId = Number.parseInt(sellerUserId, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw createHttpError(400, 'Vendedor asignado inválido');
  }
  const sellerRes = await pool.query(
    `SELECT id, email, display_name, role
     FROM users
     WHERE id = $1
       AND is_active = TRUE`,
    [parsedId]
  );
  if (sellerRes.rowCount === 0) {
    throw createHttpError(404, 'Vendedor asignado no encontrado o desactivado');
  }
  const seller = sellerRes.rows[0];
  const sellerRole = normalizeRole(seller.role || '');
  const isAssignableSeller = sellerRole === ROLE_KEYS.ventas
    || sellerRole === ROLE_KEYS.ventasLider
    || sellerRole === 'sales'
    || sellerRole === 'vendedor';
  if (!isAssignableSeller) {
    throw createHttpError(400, 'El usuario asignado no pertenece al equipo de ventas');
  }
  const displayName = resolveUserDisplayName(seller, fallbackName || 'Vendedor');
  return displayName;
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

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    try {
      const result = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [user.id]);
      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'Usuario no encontrado' });
      }
      if (!result.rows[0].is_active) {
        return res.status(403).json({ error: 'Cuenta desactivada. Contacta a un administrador.' });
      }
      req.user = user;
      next();
    } catch (dbErr) {
      console.error(dbErr);
      return res.status(500).json({ error: 'No se pudo validar sesión' });
    }
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
  const { email, password, role, city, phone, display_name } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const safeDisplayName = normalizeDisplayName(display_name, { required: false });
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone, display_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [email, hashedPass, role, city || null, phone || null, safeDisplayName]
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
    if (user && user.is_active === false) {
      return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta a un administrador.' });
    }
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

// ─── LIST assignable sellers for delegated quote assignment ──────────────────
app.get('/api/sellers/assignable', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE is_active = TRUE
         AND (role ILIKE '%ventas%' OR role ILIKE '%sales%' OR role ILIKE '%vendedor%')
       ORDER BY email ASC`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        display_name: resolveUserDisplayName(row, 'Vendedor')
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
      `SELECT id, email, display_name, role
       FROM users
       WHERE is_active = TRUE
         AND (role ILIKE '%ventas%' OR role ILIKE '%sales%' OR role ILIKE '%vendedor%')
       ORDER BY email ASC`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      display_name: resolveUserDisplayName(row, 'Vendedor')
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la lista de vendedores' });
  }
});

const loadCustomerMenuEditorContext = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'menu_cliente')) {
    res.status(403).json({ error: 'No tienes permiso para gestionar el catálogo de clientes' });
    return null;
  }
  return userContext;
};

// ─── CUSTOMER PUBLIC MENU (sales share link + public ordering) ───────────────
app.get('/api/customer-menu/images', authenticateToken, async (req, res) => {
  const userContext = await loadCustomerMenuEditorContext(req, res);
  if (!userContext) return;

  try {
    await ensureCustomerMenuImageDir();
    const ownFiles = await fs.readdir(CUSTOMER_MENU_IMAGE_DIR, { withFileTypes: true });
    const legacyFiles = await fs.readdir(LEGACY_MENU_IMAGE_DIR, { withFileTypes: true }).catch(() => []);

    const ownImages = ownFiles
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => {
        const encoded = encodeURIComponent(name);
        const relativePath = `/customer-menu-images/${encoded}`;
        return {
          name,
          source: 'subidas',
          relative_path: relativePath,
          image_url: toCustomerMenuImageAbsoluteUrl(req, relativePath)
        };
      });

    const legacyImages = legacyFiles
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => ({
        name,
        source: 'menu-images',
        relative_path: `/menu-images/${encodeURIComponent(name)}`,
        image_url: `/menu-images/${encodeURIComponent(name)}`
      }));

    const merged = [...ownImages, ...legacyImages].sort((a, b) => (
      `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`)
    ));
    return res.json(merged);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudieron listar imágenes del catálogo' });
  }
});

app.post('/api/customer-menu/images', authenticateToken, async (req, res) => {
  const userContext = await loadCustomerMenuEditorContext(req, res);
  if (!userContext) return;

  try {
    const rawFilename = String(req.body?.filename || '').trim();
    const dataUrl = String(req.body?.data_url || '').trim();
    if (!rawFilename || !dataUrl) {
      return res.status(400).json({ error: 'Debes enviar filename y data_url' });
    }

    const dataUrlMatch = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!dataUrlMatch) {
      return res.status(400).json({ error: 'Formato de imagen inválido' });
    }
    const mimeType = String(dataUrlMatch[1] || '').toLowerCase();
    const base64Payload = String(dataUrlMatch[2] || '').replace(/\s+/g, '');
    const mimeExt = CUSTOMER_MENU_IMAGE_MIME_TO_EXT[mimeType];
    if (!mimeExt || !CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(mimeExt)) {
      return res.status(400).json({ error: 'Formato no soportado. Usa JPG, PNG, WEBP o GIF' });
    }

    const sourceExt = path.extname(rawFilename).toLowerCase();
    const finalExt = CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(sourceExt) ? sourceExt : mimeExt;
    const baseName = path.basename(rawFilename, path.extname(rawFilename))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'catalogo';
    const finalFilename = `${Date.now()}-${baseName}${finalExt}`;
    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Imagen vacía' });
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'La imagen supera 8MB' });
    }

    await ensureCustomerMenuImageDir();
    const absolutePath = path.join(CUSTOMER_MENU_IMAGE_DIR, finalFilename);
    await fs.writeFile(absolutePath, buffer);

    const relativePath = `/customer-menu-images/${encodeURIComponent(finalFilename)}`;
    return res.status(201).json({
      filename: finalFilename,
      relative_path: relativePath,
      image_url: toCustomerMenuImageAbsoluteUrl(req, relativePath),
      uploaded_by: resolveUserDisplayName(userContext, 'Usuario')
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudo subir la imagen' });
  }
});

app.post('/api/customer-menu/share-link', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'menu_cliente')) {
    return res.status(403).json({ error: 'No tienes permiso para generar enlaces de catálogo' });
  }

  try {
    const shareToken = jwt.sign(
      {
        purpose: CUSTOMER_MENU_TOKEN_PURPOSE,
        seller_user_id: userContext.id
      },
      process.env.JWT_SECRET,
      { expiresIn: CUSTOMER_MENU_TOKEN_TTL }
    );
    const requestOrigin = String(req.headers.origin || '').trim();
    const publicBase = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || requestOrigin || 'http://localhost:5173').trim();
    const shareUrl = `${publicBase.replace(/\/+$/, '')}/#/catalogo/${shareToken}`;
    return res.json({
      share_token: shareToken,
      share_url: shareUrl,
      expires_in: CUSTOMER_MENU_TOKEN_TTL,
      seller: {
        id: userContext.id,
        display_name: resolveUserDisplayName(userContext, 'Vendedor')
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudo generar el enlace de catálogo' });
  }
});

app.get('/api/public/menu/:shareToken', async (req, res) => {
  const shareToken = String(req.params.shareToken || '').trim();
  if (!shareToken) return res.status(400).json({ error: 'Token de catálogo inválido' });

  try {
    const decoded = jwt.verify(shareToken, process.env.JWT_SECRET);
    if (decoded?.purpose !== CUSTOMER_MENU_TOKEN_PURPOSE) {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }
    const sellerUserId = Number.parseInt(decoded?.seller_user_id, 10);
    if (!Number.isInteger(sellerUserId) || sellerUserId <= 0) {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }

    const sellerRes = await pool.query(
      `SELECT id, email, display_name, role, panel_access, city, is_active
       FROM users
       WHERE id = $1`,
      [sellerUserId]
    );
    if (sellerRes.rowCount === 0 || sellerRes.rows[0].is_active === false) {
      return res.status(404).json({ error: 'Vendedor no disponible para este enlace' });
    }
    const seller = sellerRes.rows[0];
    if (!canAccessPanel(seller.panel_access, seller.role, 'menu_cliente')) {
      return res.status(403).json({ error: 'Este enlace no corresponde a un usuario autorizado' });
    }

    const cityScope = resolveInventoryScopeByCity(seller.city || '');
    const defaultStore = cityScope?.canonical || 'Cochabamba';
    const productRows = await loadProductCatalogRows({ includeInactive: false });
    const products = productRows
      .map((row) => ({
        sku: String(row.sku || '').toUpperCase(),
        name: String(row.name || '').trim(),
        price: Number(row.sf || 0),
        price_sf: Number(row.sf || 0),
        price_cf: Number(row.cf || row.sf || 0),
        image_url: String(row.image_url || '').trim() || null,
        category: inferProductMenuCategory(row)
      }))
      .sort((a, b) => {
        const catA = CUSTOMER_MENU_CATEGORIES.indexOf(a.category);
        const catB = CUSTOMER_MENU_CATEGORIES.indexOf(b.category);
        if (catA !== catB) return catA - catB;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      });

    return res.json({
      seller: {
        id: seller.id,
        display_name: resolveUserDisplayName(seller, 'Vendedor')
      },
      default_store: defaultStore,
      categories: CUSTOMER_MENU_CATEGORIES,
      products
    });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(410).json({ error: 'Este enlace expiró. Pide uno nuevo al vendedor.' });
    }
    if (err?.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }
    console.error(err);
    return res.status(500).json({ error: 'No se pudo cargar el catálogo compartido' });
  }
});

app.post('/api/public/menu/:shareToken/order', async (req, res) => {
  const shareToken = String(req.params.shareToken || '').trim();
  if (!shareToken) return res.status(400).json({ error: 'Token de catálogo inválido' });
  try {
    const decoded = jwt.verify(shareToken, process.env.JWT_SECRET);
    if (decoded?.purpose !== CUSTOMER_MENU_TOKEN_PURPOSE) {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }
    const sellerUserId = Number.parseInt(decoded?.seller_user_id, 10);
    if (!Number.isInteger(sellerUserId) || sellerUserId <= 0) {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }

    const sellerRes = await pool.query(
      `SELECT id, email, display_name, role, panel_access, city, is_active
       FROM users
       WHERE id = $1`,
      [sellerUserId]
    );
    if (sellerRes.rowCount === 0 || sellerRes.rows[0].is_active === false) {
      return res.status(404).json({ error: 'Vendedor no disponible para este enlace' });
    }
    const seller = sellerRes.rows[0];
    if (!canAccessPanel(seller.panel_access, seller.role, 'menu_cliente')) {
      return res.status(403).json({ error: 'Este enlace no corresponde a un usuario autorizado' });
    }

    const customerName = String(req.body?.customer_name || '').trim();
    const customerPhone = String(req.body?.customer_phone || '').trim();
    const department = normalizeDepartmentLabel(req.body?.department || '');
    const provincia = normalizeDepartmentLabel(req.body?.provincia || '');
    const customerNotes = String(req.body?.notes || '').trim();
    const ventaTypeRaw = normalizeText(req.body?.venta_type || 'sf').replace(/\s+/g, '');
    const ventaType = ventaTypeRaw === 'cf' || ventaTypeRaw === 'confactura'
      ? 'cf'
      : (ventaTypeRaw === 'sf' || ventaTypeRaw === 'sinfactura' ? 'sf' : '');
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!customerName || !customerPhone) {
      return res.status(400).json({ error: 'Completa nombre y teléfono para enviar el pedido' });
    }
    if (!ventaType) {
      return res.status(400).json({ error: 'Selecciona si el pedido es con factura o sin factura' });
    }
    if (!department && !provincia) {
      return res.status(400).json({ error: 'Selecciona departamento o provincia para enviar el pedido' });
    }
    if (department && provincia) {
      return res.status(400).json({ error: 'Envía solo departamento o provincia, no ambos' });
    }
    if (customerName.length > 120) {
      return res.status(400).json({ error: 'Nombre demasiado largo (máx 120)' });
    }
    if (customerPhone.length > 30) {
      return res.status(400).json({ error: 'Teléfono inválido (máx 30)' });
    }
    if (customerNotes.length > 600) {
      return res.status(400).json({ error: 'Notas demasiado largas (máx 600)' });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos un producto al pedido' });
    }

    const qtyBySku = new Map();
    for (const item of rawItems) {
      const sku = normalizeProductSku(item?.sku || '');
      const qty = Number.parseInt(item?.qty, 10);
      if (!sku || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Hay productos inválidos en el pedido' });
      }
      qtyBySku.set(sku, (qtyBySku.get(sku) || 0) + qty);
    }
    const skus = [...qtyBySku.keys()];
    const productsRes = await pool.query(
      `SELECT sku, name, sf_price, cf_price
       FROM products
       WHERE UPPER(sku) = ANY($1::text[])
         AND is_active = TRUE`,
      [skus]
    );
    if (productsRes.rowCount !== skus.length) {
      return res.status(400).json({ error: 'Uno o más productos ya no están disponibles' });
    }
    const productsBySku = new Map(
      productsRes.rows.map((row) => [String(row.sku || '').toUpperCase(), row])
    );
    const lineItems = skus.map((sku) => {
      const product = productsBySku.get(sku);
      const qty = Number(qtyBySku.get(sku) || 0);
      const unitPrice = ventaType === 'cf'
        ? Number(product?.cf_price || product?.sf_price || 0)
        : Number(product?.sf_price || 0);
      return {
        sku,
        displayName: String(product?.name || sku),
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
        isCombo: false,
        comboItems: []
      };
    });
    const normalizedLineItems = parseAndNormalizeQuoteRows(lineItems);
    const subtotal = normalizedLineItems.reduce((sum, row) => sum + Number(row.lineTotal || 0), 0);
    const total = subtotal;
    const cityScope = resolveInventoryScopeByCity(seller.city || '');
    const storeLocation = cityScope?.canonical || 'Cochabamba';
    const vendorName = resolveUserDisplayName(seller, 'Vendedor');

    const insertResult = await pool.query(
      `INSERT INTO quotes (
        user_id, customer_name, customer_phone, department, provincia, shipping_notes,
        alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent, line_items, subtotal,
        total, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id, created_at`,
      [
        seller.id,
        customerName,
        customerPhone,
        department || null,
        provincia || null,
        customerNotes || null,
        null,
        null,
        storeLocation,
        vendorName,
        ventaType,
        0,
        JSON.stringify(normalizedLineItems),
        subtotal,
        total,
        'Cotizado'
      ]
    );

    return res.status(201).json({
      message: 'Pedido enviado correctamente',
      quote_id: insertResult.rows[0]?.id || null,
      created_at: insertResult.rows[0]?.created_at || null,
      seller_name: vendorName
    });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(410).json({ error: 'Este enlace expiró. Pide uno nuevo al vendedor.' });
    }
    if (err?.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'No se pudo enviar el pedido' });
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
    seller_user_id,
    venta_type,
    discount_percent,
    rows,
    subtotal,
    total,
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
    if (totalValue - subtotalValue > 0.01) {
      throw createHttpError(400, 'El total no puede ser mayor al subtotal');
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
    const isSalesOwnerRole = creatorRole === ROLE_KEYS.ventas
      || creatorRole === ROLE_KEYS.ventasLider
      || creatorRole === 'sales'
      || creatorRole === 'vendedor';
    const requiresAssignedSeller = !isSalesOwnerRole;
    let quoteOwnerId = req.user.id;
    let vendorDisplayName = String(vendor || '').trim() || getUserDisplayName(userContext, 'Usuario');

    if (requiresAssignedSeller) {
      const selectedSellerId = Number.parseInt(seller_user_id, 10);
      if (!Number.isInteger(selectedSellerId)) {
        throw createHttpError(400, 'Selecciona un vendedor válido para asignar la cotización');
      }
      const sellerRes = await client.query(
        'SELECT id, email, display_name, role FROM users WHERE id = $1 AND is_active = TRUE',
        [selectedSellerId]
      );
      if (sellerRes.rowCount === 0) {
        throw createHttpError(400, 'El vendedor seleccionado no existe o está desactivado');
      }
      const seller = sellerRes.rows[0];
      const sellerRole = normalizeRole(seller.role || '');
      const isAssignableSeller = sellerRole === ROLE_KEYS.ventas || sellerRole === ROLE_KEYS.ventasLider || sellerRole === 'sales' || sellerRole === 'vendedor';
      if (!isAssignableSeller) {
        throw createHttpError(400, 'Solo puedes asignar la cotización a un usuario de ventas');
      }
      quoteOwnerId = seller.id;
      vendorDisplayName = resolveUserDisplayName(seller, vendorDisplayName);
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

// ─── PROJECTS / TASKS COLLABORATION ──────────────────────────────────────────
app.get('/api/projects/users', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const result = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE is_active = TRUE
       ORDER BY LOWER(COALESCE(display_name, email)) ASC`
    );
    res.json((result.rows || []).map((row) => ({
      id: Number(row.id),
      role: row.role || null,
      email: row.email || null,
      display_name: resolveUserDisplayName(row, 'Usuario')
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar usuarios para proyectos' });
  }
});

app.get('/api/projects/dashboard', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const [projectsRes, tasksRes] = await Promise.all([
      pool.query(
        `SELECT
           p.id, p.name, p.description, p.area, p.work_type,
           p.version_major, p.version_minor, p.version_patch,
           p.created_by, p.created_at, p.updated_at, p.is_active,
           u.email AS created_by_email,
           u.display_name AS created_by_name
         FROM projects p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.is_active = TRUE
         ORDER BY p.updated_at DESC, p.id DESC`
      ),
      pool.query(
        `SELECT
           t.id, t.project_id, t.title, t.description,
           t.assignee_user_id, t.start_date, t.due_date, t.status,
           t.progress_percent, t.task_type, t.version_bump, t.version_applied,
           t.cost, t.created_by, t.created_at, t.updated_at,
           p.name AS project_name,
           p.area AS project_area,
           au.email AS assignee_email,
           au.display_name AS assignee_name,
           cu.email AS created_by_email,
           cu.display_name AS created_by_name
         FROM project_tasks t
         INNER JOIN projects p ON p.id = t.project_id
         LEFT JOIN users au ON au.id = t.assignee_user_id
         LEFT JOIN users cu ON cu.id = t.created_by
         WHERE p.is_active = TRUE
         ORDER BY COALESCE(t.due_date, t.start_date) ASC NULLS LAST, t.updated_at DESC, t.id DESC`
      )
    ]);

    const projects = (projectsRes.rows || []).map((row) => mapProjectRow(row));
    const tasks = (tasksRes.rows || []).map((row) => mapProjectTaskRow(row));
    const summaryByProjectId = new Map(
      projects.map((project) => [project.id, {
        total_tasks: 0,
        completed_tasks: 0,
        pending_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        progress_sum: 0,
        total_cost: 0
      }])
    );
    const myProjectIds = new Set();
    for (const project of projects) {
      if (project.created_by === req.user.id) {
        myProjectIds.add(project.id);
      }
    }
    for (const task of tasks) {
      const summary = summaryByProjectId.get(task.project_id);
      if (summary) {
        summary.total_tasks += 1;
        summary.progress_sum += Number(task.progress_percent || 0);
        summary.total_cost += Number(task.cost || 0);
        if (task.status === 'completada') summary.completed_tasks += 1;
        if (task.status === 'pendiente') summary.pending_tasks += 1;
        if (task.status === 'en_progreso') summary.in_progress_tasks += 1;
        if (task.status === 'bloqueada') summary.blocked_tasks += 1;
      }
      if (task.assignee_user_id === req.user.id) {
        myProjectIds.add(task.project_id);
      }
    }

    const projectsWithSummary = projects.map((project) => {
      const summary = summaryByProjectId.get(project.id) || {
        total_tasks: 0,
        completed_tasks: 0,
        pending_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        progress_sum: 0,
        total_cost: 0
      };
      const progressPercent = summary.total_tasks > 0
        ? Math.round(summary.progress_sum / summary.total_tasks)
        : 0;
      return {
        ...project,
        ...summary,
        progress_percent: progressPercent,
        is_working_on: myProjectIds.has(project.id)
      };
    });

    res.json({
      current_user_id: Number(req.user.id),
      areas: PROJECT_AREA_VALUES,
      task_type_values: PROJECT_TASK_TYPE_VALUES,
      task_status_values: PROJECT_TASK_STATUS_VALUES,
      version_bump_values: PROJECT_VERSION_BUMP_VALUES,
      projects: projectsWithSummary,
      tasks
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el tablero de proyectos' });
  }
});

app.post('/api/projects', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const normalized = normalizeProjectPayload(req.body || {}, { partial: false });
    const result = await pool.query(
      `INSERT INTO projects (
         name, description, area, work_type,
         version_major, version_minor, version_patch,
         created_by, created_at, updated_at, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), TRUE)
       RETURNING id, name, description, area, work_type, version_major, version_minor, version_patch,
                 created_by, created_at, updated_at, is_active`,
      [
        normalized.name,
        normalized.description,
        normalized.area,
        normalized.work_type,
        normalized.version_major,
        normalized.version_minor,
        normalized.version_patch,
        req.user.id
      ]
    );
    const created = mapProjectRow(result.rows[0] || {});
    res.status(201).json({ message: 'Proyecto creado', project: created });
  } catch (err) {
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo crear el proyecto' });
  }
});

app.post('/api/projects/:projectId/tasks', authenticateToken, async (req, res) => {
  const projectId = Number.parseInt(req.params.projectId, 10);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Proyecto inválido' });
  }

  const client = await pool.connect();
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const normalized = normalizeProjectTaskPayload(req.body || {}, { partial: false });
    await client.query('BEGIN');
    const projectRes = await client.query(
      `SELECT id
       FROM projects
       WHERE id = $1
         AND is_active = TRUE
       FOR UPDATE`,
      [projectId]
    );
    if (projectRes.rowCount === 0) {
      throw createHttpError(404, 'Proyecto no encontrado');
    }
    if (normalized.assignee_user_id) {
      const assigneeRes = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND is_active = TRUE`,
        [normalized.assignee_user_id]
      );
      if (assigneeRes.rowCount === 0) {
        throw createHttpError(400, 'Usuario asignado no encontrado o desactivado');
      }
    }

    const insertRes = await client.query(
      `INSERT INTO project_tasks (
         project_id, title, description, assignee_user_id, start_date, due_date,
         status, progress_percent, task_type, version_bump, version_applied, cost, created_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, $12, NOW(), NOW())
       RETURNING id, project_id, title, description, assignee_user_id, start_date, due_date,
                 status, progress_percent, task_type, version_bump, version_applied, cost, created_by, created_at, updated_at`,
      [
        projectId,
        normalized.title,
        normalized.description,
        normalized.assignee_user_id,
        normalized.start_date,
        normalized.due_date,
        normalized.status,
        normalized.progress_percent,
        normalized.task_type,
        normalized.version_bump,
        normalized.cost,
        req.user.id
      ]
    );
    await maybeApplyTaskVersionBump(client, insertRes.rows[0]);
    const taskId = Number(insertRes.rows[0]?.id || 0);
    const taskRes = await client.query(
      `SELECT
         t.id, t.project_id, t.title, t.description,
         t.assignee_user_id, t.start_date, t.due_date, t.status,
         t.progress_percent, t.task_type, t.version_bump, t.version_applied,
         t.cost, t.created_by, t.created_at, t.updated_at,
         p.name AS project_name,
         p.area AS project_area,
         au.email AS assignee_email,
         au.display_name AS assignee_name,
         cu.email AS created_by_email,
         cu.display_name AS created_by_name
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN users au ON au.id = t.assignee_user_id
       LEFT JOIN users cu ON cu.id = t.created_by
       WHERE t.id = $1`,
      [taskId]
    );
    await client.query('COMMIT');
    res.status(201).json({
      message: 'Tarea creada',
      task: mapProjectTaskRow(taskRes.rows[0] || {})
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo crear la tarea' });
  } finally {
    client.release();
  }
});

app.delete('/api/projects/tasks/:taskId', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.taskId, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'Tarea inválida' });
  }

  const client = await pool.connect();
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    await client.query('BEGIN');
    const currentRes = await client.query(
      `SELECT t.id, t.title, t.project_id, p.is_active
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1
       FOR UPDATE`,
      [taskId]
    );
    if (currentRes.rowCount === 0) {
      throw createHttpError(404, 'Tarea no encontrada');
    }
    const current = currentRes.rows[0];
    if (current.is_active === false) {
      throw createHttpError(400, 'No se puede eliminar una tarea de un proyecto inactivo');
    }

    await client.query(
      `DELETE FROM project_tasks
       WHERE id = $1`,
      [taskId]
    );
    await client.query('COMMIT');
    res.json({
      message: 'Tarea eliminada',
      task_id: taskId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo eliminar la tarea' });
  } finally {
    client.release();
  }
});

app.patch('/api/projects/tasks/:taskId', authenticateToken, async (req, res) => {
  const taskId = Number.parseInt(req.params.taskId, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'Tarea inválida' });
  }

  const client = await pool.connect();
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getProjectsAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    await ensureProjectsTables();
    const normalized = normalizeProjectTaskPayload(req.body || {}, { partial: true });
    if (Object.keys(normalized).length === 0) {
      throw createHttpError(400, 'No se enviaron cambios para la tarea');
    }

    await client.query('BEGIN');
    const currentRes = await client.query(
      `SELECT t.*, p.is_active
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1
       FOR UPDATE`,
      [taskId]
    );
    if (currentRes.rowCount === 0) {
      throw createHttpError(404, 'Tarea no encontrada');
    }
    const current = currentRes.rows[0];
    if (current.is_active === false) {
      throw createHttpError(400, 'No se puede actualizar una tarea de un proyecto inactivo');
    }

    if (Object.prototype.hasOwnProperty.call(normalized, 'assignee_user_id') && normalized.assignee_user_id) {
      const assigneeRes = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND is_active = TRUE`,
        [normalized.assignee_user_id]
      );
      if (assigneeRes.rowCount === 0) {
        throw createHttpError(400, 'Usuario asignado no encontrado o desactivado');
      }
    }

    const nextStartDate = Object.prototype.hasOwnProperty.call(normalized, 'start_date')
      ? normalized.start_date
      : current.start_date;
    const nextDueDate = Object.prototype.hasOwnProperty.call(normalized, 'due_date')
      ? normalized.due_date
      : current.due_date;
    if (nextStartDate && nextDueDate && nextDueDate < nextStartDate) {
      throw createHttpError(400, 'La fecha de entrega no puede ser menor a la fecha de inicio');
    }

    let nextStatus = Object.prototype.hasOwnProperty.call(normalized, 'status')
      ? normalized.status
      : (normalizeProjectTaskStatus(current.status || '') || 'pendiente');
    let nextProgress = Object.prototype.hasOwnProperty.call(normalized, 'progress_percent')
      ? normalized.progress_percent
      : Math.max(0, Math.min(100, Number.parseInt(current.progress_percent, 10) || 0));
    if (nextStatus === 'completada') {
      nextProgress = 100;
    } else if (nextProgress === 100 && !Object.prototype.hasOwnProperty.call(normalized, 'status')) {
      nextStatus = 'completada';
    }

    const nextTask = {
      title: Object.prototype.hasOwnProperty.call(normalized, 'title') ? normalized.title : current.title,
      description: Object.prototype.hasOwnProperty.call(normalized, 'description') ? normalized.description : current.description,
      assignee_user_id: Object.prototype.hasOwnProperty.call(normalized, 'assignee_user_id')
        ? normalized.assignee_user_id
        : current.assignee_user_id,
      start_date: nextStartDate,
      due_date: nextDueDate,
      status: nextStatus,
      progress_percent: nextProgress,
      task_type: Object.prototype.hasOwnProperty.call(normalized, 'task_type')
        ? normalized.task_type
        : (normalizeProjectTaskType(current.task_type || '') || 'rutina'),
      version_bump: Object.prototype.hasOwnProperty.call(normalized, 'version_bump')
        ? normalized.version_bump
        : (normalizeProjectVersionBump(current.version_bump || '') || 'none'),
      cost: Object.prototype.hasOwnProperty.call(normalized, 'cost')
        ? normalized.cost
        : (current.cost !== null && current.cost !== undefined ? Number(current.cost) : null),
      version_applied: Boolean(current.version_applied)
    };

    const updateRes = await client.query(
      `UPDATE project_tasks
       SET title = $1,
           description = $2,
           assignee_user_id = $3,
           start_date = $4,
           due_date = $5,
           status = $6,
           progress_percent = $7,
           task_type = $8,
           version_bump = $9,
           cost = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING id, project_id, title, description, assignee_user_id, start_date, due_date,
                 status, progress_percent, task_type, version_bump, version_applied, cost, created_by, created_at, updated_at`,
      [
        nextTask.title,
        nextTask.description,
        nextTask.assignee_user_id,
        nextTask.start_date,
        nextTask.due_date,
        nextTask.status,
        nextTask.progress_percent,
        nextTask.task_type,
        nextTask.version_bump,
        nextTask.cost,
        taskId
      ]
    );
    const updatedTask = updateRes.rows[0];
    await maybeApplyTaskVersionBump(client, updatedTask);
    const taskRes = await client.query(
      `SELECT
         t.id, t.project_id, t.title, t.description,
         t.assignee_user_id, t.start_date, t.due_date, t.status,
         t.progress_percent, t.task_type, t.version_bump, t.version_applied,
         t.cost, t.created_by, t.created_at, t.updated_at,
         p.name AS project_name,
         p.area AS project_area,
         au.email AS assignee_email,
         au.display_name AS assignee_name,
         cu.email AS created_by_email,
         cu.display_name AS created_by_name
       FROM project_tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN users au ON au.id = t.assignee_user_id
       LEFT JOIN users cu ON cu.id = t.created_by
       WHERE t.id = $1`,
      [taskId]
    );
    await client.query('COMMIT');
    res.json({
      message: 'Tarea actualizada',
      task: mapProjectTaskRow(taskRes.rows[0] || {})
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo actualizar la tarea' });
  } finally {
    client.release();
  }
});

// ─── EXPENSES / COST ACCOUNTABILITY ──────────────────────────────────────────
app.get('/api/expenses', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const monthRaw = req.query?.month;
  const yearRaw = req.query?.year;
  const month = monthRaw !== undefined ? Number.parseInt(monthRaw, 10) : null;
  const year = yearRaw !== undefined ? Number.parseInt(yearRaw, 10) : null;
  if (monthRaw !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
  }
  if (yearRaw !== undefined && (!Number.isInteger(year) || year < 2000 || year > 3000)) {
    return res.status(400).json({ error: 'Año inválido' });
  }

  const recurringOnly = parseBooleanLike(req.query?.recurring_only, false);
  const departmentFilter = normalizeDepartmentLabel(req.query?.department || '');
  const search = String(req.query?.q || '').trim();

  try {
    await ensureExpensesTable();
    const where = [];
    const params = [];

    if (scope.isAdmin) {
      if (departmentFilter) {
        params.push(departmentFilter);
        where.push(`LOWER(e.department) = LOWER($${params.length})`);
      }
    } else {
      params.push(scope.department);
      where.push(`LOWER(e.department) = LOWER($${params.length})`);
    }

    if (Number.isInteger(month)) {
      params.push(month);
      where.push(`EXTRACT(MONTH FROM e.expense_date) = $${params.length}`);
    }
    if (Number.isInteger(year)) {
      params.push(year);
      where.push(`EXTRACT(YEAR FROM e.expense_date) = $${params.length}`);
    }
    if (recurringOnly) {
      where.push('e.is_recurring = TRUE');
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        e.concept ILIKE $${params.length}
        OR COALESCE(e.vendor, '') ILIKE $${params.length}
        OR COALESCE(e.category, '') ILIKE $${params.length}
      )`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT
         e.id, e.department, e.category, e.concept, e.vendor,
         e.amount, e.currency, e.is_recurring, e.recurrence_period,
         e.expense_date, e.notes, e.created_by, e.created_at, e.updated_at,
         u.email AS created_by_email
       FROM department_expenses e
       LEFT JOIN users u ON u.id = e.created_by
       ${whereSql}
       ORDER BY e.expense_date DESC, e.id DESC
       LIMIT 500`,
      params
    );
    res.json((result.rows || []).map((row) => mapExpenseRow(row)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar gastos' });
  }
});

app.get('/api/expenses/variance', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const months = Number.parseInt(req.query?.months, 10);
  const safeMonths = Number.isInteger(months) ? Math.max(1, Math.min(36, months)) : 6;
  const limit = Number.parseInt(req.query?.limit, 10);
  const safeLimit = Number.isInteger(limit) ? Math.max(5, Math.min(200, limit)) : 30;
  const departmentFilter = normalizeDepartmentLabel(req.query?.department || '');
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - safeMonths);
  const startDateText = startDate.toISOString().slice(0, 10);

  try {
    await ensureExpensesTable();
    const where = ['e.is_recurring = TRUE', `e.expense_date >= $1::date`];
    const params = [startDateText];

    if (scope.isAdmin) {
      if (departmentFilter) {
        params.push(departmentFilter);
        where.push(`LOWER(e.department) = LOWER($${params.length})`);
      }
    } else {
      params.push(scope.department);
      where.push(`LOWER(e.department) = LOWER($${params.length})`);
    }

    const result = await pool.query(
      `SELECT
         e.id, e.department, e.concept, e.vendor, e.amount, e.currency,
         e.recurrence_period, e.expense_date
       FROM department_expenses e
       WHERE ${where.join(' AND ')}
       ORDER BY LOWER(e.department) ASC, LOWER(e.concept) ASC, COALESCE(e.recurrence_period, '') ASC, e.expense_date DESC, e.id DESC`,
      params
    );

    const grouped = new Map();
    for (const row of result.rows || []) {
      const key = [
        normalizeText(row.department || ''),
        normalizeText(row.concept || ''),
        String(row.recurrence_period || '')
      ].join('|');
      const bucket = grouped.get(key) || [];
      bucket.push({
        department: row.department,
        concept: row.concept,
        vendor: row.vendor || null,
        amount: Number(row.amount || 0),
        recurrence_period: row.recurrence_period || null,
        expense_date: row.expense_date
      });
      grouped.set(key, bucket);
    }

    const summary = [];
    for (const entries of grouped.values()) {
      if (!Array.isArray(entries) || entries.length < 2) continue;
      const latest = entries[0];
      const previous = entries[1];
      const amounts = entries.map((item) => Number(item.amount || 0));
      const sum = amounts.reduce((acc, value) => acc + value, 0);
      const deltaAmount = Number(latest.amount || 0) - Number(previous.amount || 0);
      const previousAmount = Number(previous.amount || 0);
      const deltaPercent = previousAmount > 0 ? (deltaAmount / previousAmount) * 100 : null;
      summary.push({
        department: latest.department,
        concept: latest.concept,
        recurrence_period: latest.recurrence_period,
        samples: entries.length,
        latest_amount: Number(latest.amount || 0),
        previous_amount: previousAmount,
        delta_amount: deltaAmount,
        delta_percent: deltaPercent,
        avg_amount: sum / amounts.length,
        min_amount: Math.min(...amounts),
        max_amount: Math.max(...amounts),
        latest_vendor: latest.vendor,
        previous_vendor: previous.vendor,
        latest_date: latest.expense_date,
        previous_date: previous.expense_date
      });
    }

    summary.sort((a, b) => {
      if (b.delta_amount !== a.delta_amount) return b.delta_amount - a.delta_amount;
      const absDiff = Math.abs(b.delta_amount) - Math.abs(a.delta_amount);
      if (absDiff !== 0) return absDiff;
      return String(a.concept || '').localeCompare(String(b.concept || ''), 'es');
    });

    res.json(summary.slice(0, safeLimit));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo calcular variación de gastos recurrentes' });
  }
});

app.post('/api/expenses', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  try {
    await ensureExpensesTable();
    const body = scope.isAdmin
      ? req.body
      : { ...(req.body || {}), department: scope.department };
    const normalized = normalizeExpensePayload(body, { partial: false });
    if (!scope.isAdmin && normalizeText(normalized.department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No puedes registrar gastos para otro departamento' });
    }
    if (!normalized.is_recurring) {
      normalized.recurrence_period = null;
    }

    const result = await pool.query(
      `INSERT INTO department_expenses (
         department, category, concept, vendor, amount, currency,
         is_recurring, recurrence_period, expense_date, notes, created_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, NOW(), NOW())
       RETURNING id, department, category, concept, vendor, amount, currency, is_recurring, recurrence_period, expense_date, notes, created_by, created_at, updated_at`,
      [
        normalized.department,
        normalized.category,
        normalized.concept,
        normalized.vendor,
        normalized.amount,
        normalized.currency,
        Boolean(normalized.is_recurring),
        normalized.recurrence_period,
        normalized.expense_date,
        normalized.notes,
        req.user.id
      ]
    );
    res.status(201).json(mapExpenseRow({ ...result.rows[0], created_by_email: userContext.email }));
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({ error: err.message || 'Datos de gasto inválidos' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar gasto' });
  }
});

app.patch('/api/expenses/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const expenseId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(400).json({ error: 'ID de gasto inválido' });
  }

  try {
    await ensureExpensesTable();
    const existingRes = await pool.query(
      `SELECT id, department, category, concept, vendor, amount, currency, is_recurring, recurrence_period, expense_date, notes, created_by
       FROM department_expenses
       WHERE id = $1`,
      [expenseId]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }

    const current = existingRes.rows[0];
    if (!scope.isAdmin && normalizeText(current.department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No autorizado para editar este gasto' });
    }

    const normalized = normalizeExpensePayload(req.body, { partial: true });
    if (Object.keys(normalized).length === 0) {
      return res.status(400).json({ error: 'No se enviaron cambios' });
    }
    if (!scope.isAdmin && Object.prototype.hasOwnProperty.call(normalized, 'department')
      && normalizeText(normalized.department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No puedes mover gastos a otro departamento' });
    }

    const nextDepartment = scope.isAdmin
      ? (normalized.department ?? current.department)
      : scope.department;
    const nextCategory = normalized.category ?? current.category;
    const nextConcept = normalized.concept ?? current.concept;
    const nextVendor = Object.prototype.hasOwnProperty.call(normalized, 'vendor')
      ? normalized.vendor
      : current.vendor;
    const nextAmount = Object.prototype.hasOwnProperty.call(normalized, 'amount')
      ? normalized.amount
      : Number(current.amount || 0);
    const nextCurrency = normalized.currency ?? current.currency;
    const nextIsRecurring = Object.prototype.hasOwnProperty.call(normalized, 'is_recurring')
      ? Boolean(normalized.is_recurring)
      : Boolean(current.is_recurring);
    const requestedRecurrence = Object.prototype.hasOwnProperty.call(normalized, 'recurrence_period')
      ? normalized.recurrence_period
      : current.recurrence_period;
    const nextRecurrence = nextIsRecurring ? requestedRecurrence : null;
    if (nextIsRecurring && !nextRecurrence) {
      return res.status(400).json({ error: 'Debes indicar frecuencia para gastos recurrentes' });
    }
    const nextExpenseDate = Object.prototype.hasOwnProperty.call(normalized, 'expense_date')
      ? normalized.expense_date
      : current.expense_date;
    const nextNotes = Object.prototype.hasOwnProperty.call(normalized, 'notes')
      ? normalized.notes
      : current.notes;

    const result = await pool.query(
      `UPDATE department_expenses
       SET department = $1,
           category = $2,
           concept = $3,
           vendor = $4,
           amount = $5,
           currency = $6,
           is_recurring = $7,
           recurrence_period = $8,
           expense_date = $9::date,
           notes = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING id, department, category, concept, vendor, amount, currency, is_recurring, recurrence_period, expense_date, notes, created_by, created_at, updated_at`,
      [
        nextDepartment,
        nextCategory,
        nextConcept,
        nextVendor,
        nextAmount,
        nextCurrency,
        nextIsRecurring,
        nextRecurrence,
        nextExpenseDate,
        nextNotes,
        expenseId
      ]
    );

    const row = result.rows[0];
    const ownerRes = await pool.query('SELECT email FROM users WHERE id = $1', [row.created_by]);
    res.json(mapExpenseRow({ ...row, created_by_email: ownerRes.rows[0]?.email || null }));
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({ error: err.message || 'Datos inválidos' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar gasto' });
  }
});

app.delete('/api/expenses/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const expenseId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(400).json({ error: 'ID de gasto inválido' });
  }

  try {
    await ensureExpensesTable();
    const rowRes = await pool.query(
      'SELECT id, department FROM department_expenses WHERE id = $1',
      [expenseId]
    );
    if (rowRes.rowCount === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }
    if (!scope.isAdmin && normalizeText(rowRes.rows[0].department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No autorizado para eliminar este gasto' });
    }
    await pool.query('DELETE FROM department_expenses WHERE id = $1', [expenseId]);
    res.json({ message: 'Gasto eliminado', id: expenseId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar gasto' });
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
              vendor, status, line_items, created_at, alternative_name, alternative_phone,
              coupon_code, coupon_discount_percent, gift_name
       FROM quotes WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const quote = result.rows[0];
    const isPedidosIndividualScoped = Boolean(access?.pedidos_individual)
      && !canAccessAllQuotes
      && !Boolean(access?.historial_individual)
      && !pedidosScope.isGlobal;
    if (isPedidosIndividualScoped) {
      if (quote.store_location !== pedidosScope.city) {
        return res.status(403).json({ error: 'No autorizado para ver pedidos de otra ciudad' });
      }
    } else if (!canAccessAllQuotes && quote.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este pedido' });
    }

    const rawLineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
    const parseComboIdFromSku = (skuValue = '') => {
      const match = String(skuValue || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
      return match ? Number.parseInt(match[1], 10) : null;
    };
    const formatRowLabel = (row) => {
      const rawLabel = String(row?.displayName || row?.skuDisplay || row?.sku || 'Producto desconocido').trim() || 'Producto desconocido';
      const comboMatch = String(row?.sku || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
      if (!comboMatch) return rawLabel;
      const cleaned = rawLabel.replace(/^COMBO_\d+\s*-\s*/i, '').trim();
      return cleaned || rawLabel;
    };

    const resolveComboItems = async (row) => {
      const comboId = parseComboIdFromSku(row?.sku);
      if (Number.isInteger(comboId) && comboId > 0) {
        const comboItemsRes = await pool.query(
          `SELECT ci.sku, ci.quantity, p.name
           FROM combo_items ci
           LEFT JOIN products p ON p.sku = ci.sku
           WHERE ci.combo_id = $1
           ORDER BY ci.sku ASC`,
          [comboId]
        );
        const normalizedFromDb = (comboItemsRes.rows || [])
          .map((comboItem) => ({
            sku: String(comboItem?.sku || '').trim().toUpperCase(),
            quantity: Number.parseInt(comboItem?.quantity, 10),
            name: String(comboItem?.name || '').trim()
          }))
          .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
        if (normalizedFromDb.length > 0) {
          return normalizedFromDb;
        }
      }

      const inlineItems = Array.isArray(row?.comboItems) ? row.comboItems : [];
      const normalizedInline = inlineItems
        .map((comboItem) => ({
          sku: String(comboItem?.sku || '').trim().toUpperCase(),
          quantity: Number.parseInt(comboItem?.quantity, 10),
          name: String(comboItem?.name || comboItem?.displayName || '').trim()
        }))
        .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
      if (normalizedInline.length === 0) {
        return [];
      }
      const missingNameSkus = normalizedInline
        .filter((comboItem) => !comboItem.name)
        .map((comboItem) => comboItem.sku);
      if (missingNameSkus.length === 0) {
        return normalizedInline;
      }
      const namesRes = await pool.query(
        `SELECT sku, name
         FROM products
         WHERE sku = ANY($1::text[])`,
        [missingNameSkus]
      );
      const namesBySku = new Map(
        (namesRes.rows || []).map((productRow) => [
          String(productRow?.sku || '').trim().toUpperCase(),
          String(productRow?.name || '').trim()
        ])
      );
      return normalizedInline.map((comboItem) => ({
        ...comboItem,
        name: comboItem.name || namesBySku.get(comboItem.sku) || comboItem.sku
      }));
    };

    const items = [];
    for (const row of rawLineItems) {
      const rowQty = Number.parseInt(row?.qty, 10);
      if (!Number.isInteger(rowQty) || rowQty <= 0) continue;

      const rowLabel = formatRowLabel(row);
      const comboItems = await resolveComboItems(row);
      if (comboItems.length > 0) {
        items.push({
          displayName: rowLabel,
          qty: rowQty,
          isComboHeader: true,
          isIndented: false,
          isCheckable: false
        });
        for (const comboItem of comboItems) {
          const componentQty = comboItem.quantity * rowQty;
          items.push({
            displayName: comboItem.name || comboItem.sku,
            sku: comboItem.sku,
            qty: componentQty,
            isComboHeader: false,
            isIndented: true,
            isCheckable: true
          });
        }
        continue;
      }

      items.push({
        displayName: rowLabel,
        sku: String(row?.sku || '').trim().toUpperCase() || null,
        qty: rowQty,
        isComboHeader: false,
        isIndented: false,
        isCheckable: true
      });
    }

    if (quote.coupon_code) {
      const couponPercent = Number(quote.coupon_discount_percent || 0);
      const couponLabel = Number.isFinite(couponPercent) && couponPercent > 0
        ? `Cupón ${String(quote.coupon_code).trim().toUpperCase()} (${couponPercent}%)`
        : `Cupón ${String(quote.coupon_code).trim().toUpperCase()}`;
      items.push({
        displayName: couponLabel,
        sku: 'CUPON',
        qty: 1,
        isComboHeader: false,
        isIndented: false,
        isCheckable: false
      });
    }

    if (quote.gift_name) {
      items.push({
        displayName: `Regalo: ${String(quote.gift_name).trim()}`,
        sku: 'REGALO',
        qty: 1,
        isComboHeader: false,
        isIndented: false,
        isCheckable: false
      });
    }

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
      coupon_code: quote.coupon_code,
      coupon_discount_percent: quote.coupon_discount_percent,
      gift_name: quote.gift_name,
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
    vendor,
    seller_user_id,
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
  const nextVendor = String(vendor || '').trim();
  if (nextVendor && nextVendor.length > 120) {
    return res.status(400).json({ error: 'Vendedor demasiado largo (máx 120)' });
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
    if (totalValue - subtotalValue > 0.01) {
      throw createHttpError(400, 'El total no puede ser mayor al subtotal');
    }
  } catch (err) {
    const statusCode = err?.statusCode || 400;
    return res.status(statusCode).json({ error: err.message || 'Datos inválidos en la cotización' });
  }

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });

  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canManageAnyQuote = Boolean(access?.pedidos_global || access?.historial_global);
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
    const hasSellerUserId = seller_user_id !== undefined && seller_user_id !== null && String(seller_user_id).trim() !== '';

    let nextQuoteOwnerId = currentQuote.user_id;
    let nextVendorName = nextVendor || currentQuote.vendor || null;
    if (hasSellerUserId) {
      if (!canManageAnyQuote) {
        throw createHttpError(403, 'No autorizado para reasignar vendedor en esta cotización');
      }
      const selectedSellerId = Number.parseInt(seller_user_id, 10);
      if (!Number.isInteger(selectedSellerId) || selectedSellerId <= 0) {
        throw createHttpError(400, 'Vendedor asignado inválido');
      }
      nextVendorName = await resolveAssignableVendorName(selectedSellerId, nextVendorName || '');
      nextQuoteOwnerId = selectedSellerId;
    }

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
           user_id = $9,
           vendor = $10,
           venta_type = $11,
           discount_percent = $12,
           line_items = $13,
           subtotal = $14,
           total = $15,
           status = $16
      WHERE id = $17`,
      [
        customer_name,
        customer_phone,
        department || null,
        provincia || null,
        shipping_notes || null,
        alternative_name || null,
        alternative_phone || null,
        store_location,
        nextQuoteOwnerId,
        nextVendorName,
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

  const parseComboIdFromSku = (skuValue = '') => {
    const match = String(skuValue || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const resolveComboItems = async (row) => {
    const comboId = parseComboIdFromSku(row?.sku);
    if (Number.isInteger(comboId) && comboId > 0) {
      const comboItemsRes = await client.query(
        `SELECT sku, quantity
         FROM combo_items
         WHERE combo_id = $1`,
        [comboId]
      );
      const normalizedFromDb = (comboItemsRes.rows || [])
        .map((comboItem) => ({
          sku: String(comboItem?.sku || '').trim().toUpperCase(),
          quantity: Number.parseInt(comboItem?.quantity, 10)
        }))
        .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
      if (normalizedFromDb.length > 0) {
        return normalizedFromDb;
      }
      throw new Error(`Combo COMBO_${comboId} no tiene productos configurados`);
    }

    const inlineItems = Array.isArray(row?.comboItems) ? row.comboItems : [];
    return inlineItems
      .map((comboItem) => ({
        sku: String(comboItem?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(comboItem?.quantity, 10)
      }))
      .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
  };

  for (const row of lineItems || []) {
    const rowQty = Number.parseInt(row?.qty, 10);
    if (!Number.isInteger(rowQty) || rowQty <= 0) continue;

    const comboItems = await resolveComboItems(row);
    if (comboItems.length > 0) {
      for (const comboItem of comboItems) {
        const sku = comboItem.sku;
        const qty = comboItem.quantity * rowQty;

        const stockCheck = await client.query(
          `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
          [sku]
        );

        if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
        const currentStock = Number(stockCheck.rows[0][warehouseField] || 0);

        if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

        await client.query(
          `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
          [qty, sku]
        );
      }
      continue;
    }

    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku) continue;
    const qty = rowQty;

    const stockCheck = await client.query(
      `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
      [sku]
    );

    if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
    const currentStock = Number(stockCheck.rows[0][warehouseField] || 0);

    if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

    await client.query(
      `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
      [qty, sku]
    );
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

  const parseComboIdFromSku = (skuValue = '') => {
    const match = String(skuValue || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const resolveComboItems = async (row) => {
    const comboId = parseComboIdFromSku(row?.sku);
    if (Number.isInteger(comboId) && comboId > 0) {
      const comboItemsRes = await client.query(
        `SELECT sku, quantity
         FROM combo_items
         WHERE combo_id = $1`,
        [comboId]
      );
      const normalizedFromDb = (comboItemsRes.rows || [])
        .map((comboItem) => ({
          sku: String(comboItem?.sku || '').trim().toUpperCase(),
          quantity: Number.parseInt(comboItem?.quantity, 10)
        }))
        .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
      if (normalizedFromDb.length > 0) {
        return normalizedFromDb;
      }
    }

    const inlineItems = Array.isArray(row?.comboItems) ? row.comboItems : [];
    return inlineItems
      .map((comboItem) => ({
        sku: String(comboItem?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(comboItem?.quantity, 10)
      }))
      .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
  };

  for (const row of lineItems || []) {
    const rowQty = Number.parseInt(row?.qty, 10);
    if (!Number.isInteger(rowQty) || rowQty <= 0) continue;

    const comboItems = await resolveComboItems(row);
    if (comboItems.length > 0) {
      for (const comboItem of comboItems) {
        const sku = String(comboItem?.sku || '').toUpperCase();
        const qty = Number(comboItem?.quantity || 0) * rowQty;
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
    const qty = rowQty;
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

  const sfNumber = Number(sf);
  const cfNumber = Number(cf);
  const normalizedProducts = Array.isArray(products)
    ? products
      .map((item) => ({
        sku: String(item?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(item?.quantity, 10)
      }))
      .filter((item) => item.sku && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
  if (
    !String(name || '').trim() ||
    normalizedProducts.length === 0 ||
    !Number.isFinite(sfNumber) ||
    !Number.isFinite(cfNumber) ||
    sfNumber < 0 ||
    cfNumber < 0
  ) {
    return res.status(400).json({ error: 'Faltan campos requeridos o productos vacíos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const comboRes = await client.query(
      'INSERT INTO combos (name, sf_price, cf_price, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [String(name).trim(), sfNumber, cfNumber, req.user.id]
    );
    const comboId = comboRes.rows[0].id;

    for (const item of normalizedProducts) {
      const { sku, quantity } = item;
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

// PUT update combo
app.put('/api/combos/:id', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const comboId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(comboId) || comboId <= 0) {
    return res.status(400).json({ error: 'Combo inválido' });
  }

  const { name, sf, cf, products } = req.body;
  const sfNumber = Number(sf);
  const cfNumber = Number(cf);
  const normalizedProducts = Array.isArray(products)
    ? products
      .map((item) => ({
        sku: String(item?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(item?.quantity, 10)
      }))
      .filter((item) => item.sku && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
  if (
    !String(name || '').trim() ||
    normalizedProducts.length === 0 ||
    !Number.isFinite(sfNumber) ||
    !Number.isFinite(cfNumber) ||
    sfNumber < 0 ||
    cfNumber < 0
  ) {
    return res.status(400).json({ error: 'Faltan campos requeridos o productos vacíos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentRes = await client.query(
      'SELECT created_by FROM combos WHERE id = $1 FOR UPDATE',
      [comboId]
    );
    if (currentRes.rowCount === 0) {
      throw createHttpError(404, 'Combo no encontrado');
    }

    const creatorId = Number(currentRes.rows[0]?.created_by || 0) || null;
    const isAdmin = normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;
    if (creatorId && creatorId !== req.user.id && !isAdmin) {
      throw createHttpError(403, 'No autorizado para editar este combo');
    }

    await client.query(
      `UPDATE combos
       SET name = $1,
           sf_price = $2,
           cf_price = $3
       WHERE id = $4`,
      [String(name || '').trim(), sfNumber, cfNumber, comboId]
    );
    await client.query('DELETE FROM combo_items WHERE combo_id = $1', [comboId]);
    for (const item of normalizedProducts) {
      await client.query(
        'INSERT INTO combo_items (combo_id, sku, quantity) VALUES ($1, $2, $3)',
        [comboId, item.sku, item.quantity]
      );
    }

    await client.query('COMMIT');
    res.json({ id: comboId, message: 'Combo actualizado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating combo:', err);
    res.status(err?.statusCode || 500).json({ error: err.message || 'No se pudo actualizar combo' });
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
    const isAdmin = normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;
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
      'SELECT id, email, display_name, role, city, phone, panel_access, created_at, is_active FROM users ORDER BY created_at DESC'
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
  const { email, password, role, city, phone, panel_access, display_name } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'Faltan campos requeridos' });

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const effectivePanelAccess = sanitizePanelAccess(panel_access, role);
  const safeDisplayName = normalizeDisplayName(display_name, { required: false });

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone, panel_access, display_name) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [email, hashedPass, role, city || null, phone || null, JSON.stringify(effectivePanelAccess), safeDisplayName]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'No se pudo crear usuario' });
  }
});

app.patch('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { role, city, phone, panel_access, display_name } = req.body;
  if (!role) return res.status(400).json({ error: 'El rol es obligatorio' });

  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const cityProvided = Object.prototype.hasOwnProperty.call(req.body, 'city');
  const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const displayNameProvided = Object.prototype.hasOwnProperty.call(req.body, 'display_name');
  const panelAccessProvided = Object.prototype.hasOwnProperty.call(req.body, 'panel_access');
  const cityValue = city === '' ? null : city;
  const phoneValue = phone === '' ? null : phone;
  const displayNameValue = displayNameProvided ? normalizeDisplayName(display_name, { required: false, fieldLabel: 'Nombre visible' }) : null;
  const panelAccessValue = panelAccessProvided ? JSON.stringify(sanitizePanelAccess(panel_access, role)) : null;

  try {
    const currentResult = await pool.query(
      'SELECT display_name, email FROM users WHERE id = $1',
      [req.params.id]
    );
    if (currentResult.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    const previousDisplayName = resolveUserDisplayName(currentResult.rows[0], '');
    const nextDisplayName = displayNameProvided
      ? resolveUserDisplayName({ display_name: displayNameValue, email: currentResult.rows[0].email }, previousDisplayName)
      : previousDisplayName;

    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           city = CASE WHEN $2::boolean THEN $3 ELSE city END,
           phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
           display_name = CASE WHEN $6::boolean THEN $7 ELSE display_name END,
           panel_access = CASE WHEN $8::boolean THEN $9::jsonb ELSE panel_access END
       WHERE id = $10
       RETURNING id`,
      [
        role,
        cityProvided,
        cityValue,
        phoneProvided,
        phoneValue,
        displayNameProvided,
        displayNameValue,
        panelAccessProvided,
        panelAccessValue,
        req.params.id
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    let updatedQuotesVendor = 0;
    if (displayNameProvided && normalizeText(previousDisplayName) !== normalizeText(nextDisplayName)) {
      const quoteUpdate = await pool.query(
        `UPDATE quotes
         SET vendor = $1
         WHERE user_id = $2
           AND LOWER(TRIM(vendor)) = LOWER(TRIM($3))`,
        [nextDisplayName, req.params.id, previousDisplayName]
      );
      updatedQuotesVendor = Number(quoteUpdate.rowCount || 0);
    }

    res.json({
      message: 'User updated',
      updated_quotes_vendor: updatedQuotesVendor,
      new_display_name: nextDisplayName
    });
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
  const applyToUsers = Boolean(req.body?.apply_to_users);
  const roleAccentMapFrom = 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛáàäâéèëêíìïîóòöôúùüû';
  const roleAccentMapTo = 'AAAAEEEEIIIIOOOOUUUUaaaaeeeeiiiioooouuuu';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO role_panel_defaults (role, panel_access)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (role)
       DO UPDATE SET panel_access = EXCLUDED.panel_access, updated_at = NOW()`,
      [matchedRole, JSON.stringify(panelAccess)]
    );
    let updatedUsers = 0;
    if (applyToUsers) {
      const updateResult = await client.query(
        `UPDATE users
         SET panel_access = $1::jsonb
         WHERE LOWER(translate(role, $3, $4)) = LOWER(translate($2, $3, $4))`,
        [JSON.stringify(panelAccess), matchedRole, roleAccentMapFrom, roleAccentMapTo]
      );
      updatedUsers = Number(updateResult.rowCount || 0);
    }
    await client.query('COMMIT');
    res.json({
      message: applyToUsers ? 'Configuración del rol guardada y aplicada a usuarios' : 'Configuración del rol guardada',
      role: matchedRole,
      panel_access: panelAccess,
      updated_users: updatedUsers
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración del rol' });
  } finally {
    client.release();
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
    const targetId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
    if (targetId === Number(req.user.id)) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }
    const result = await pool.query(
      `UPDATE users
       SET is_active = FALSE
       WHERE id = $1
       RETURNING id`,
      [targetId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo desactivar usuario' });
  }
});

app.patch('/api/users/:id/activation', authenticateToken, requireRole(['admin']), async (req, res) => {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
  if (targetId === Number(req.user.id) && req.body?.is_active === false) {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
  }
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active')) {
    return res.status(400).json({ error: 'Debes enviar is_active' });
  }
  const isActive = Boolean(req.body.is_active);
  try {
    const result = await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, is_active`,
      [isActive, targetId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      message: isActive ? 'Usuario reactivado' : 'Usuario desactivado',
      id: result.rows[0].id,
      is_active: Boolean(result.rows[0].is_active)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de usuario' });
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
        WHERE u.is_active = TRUE
          AND (u.role ILIKE '%ventas%' OR u.role ILIKE '%sales%' OR u.role ILIKE '%vendedor%')
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
           AND u.is_active = TRUE
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
           AND u.is_active = TRUE
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
           AND u.is_active = TRUE
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
      `INSERT INTO products (sku, name, sf_price, cf_price, is_active, menu_category, image_url, last_updated)
       VALUES ($1, $2, $3, $4, TRUE, $5, $6, NOW())
       RETURNING sku, name, sf_price, cf_price, is_active, menu_category, image_url`,
      [sku, normalized.name, normalized.sf_price, normalized.cf_price, normalized.menu_category || null, normalized.image_url || null]
    );
    await loadProductCatalogRows();
    res.status(201).json({
      sku: String(result.rows[0].sku || '').toUpperCase(),
      name: result.rows[0].name,
      sf: Number(result.rows[0].sf_price || 0),
      cf: Number(result.rows[0].cf_price || 0),
      is_active: Boolean(result.rows[0].is_active),
      menu_category: String(result.rows[0].menu_category || '').trim() || null,
      image_url: String(result.rows[0].image_url || '').trim() || null
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
    if (Object.prototype.hasOwnProperty.call(normalized, 'menu_category')) {
      values.push(normalized.menu_category || null);
      sets.push(`menu_category = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'image_url')) {
      values.push(normalized.image_url || null);
      sets.push(`image_url = $${values.length}`);
    }
    values.push(sku);
    const result = await pool.query(
      `UPDATE products
       SET ${sets.join(', ')}, last_updated = NOW()
       WHERE sku = $${values.length}
       RETURNING sku, name, sf_price, cf_price, is_active, menu_category, image_url`,
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
      is_active: Boolean(result.rows[0].is_active),
      menu_category: String(result.rows[0].menu_category || '').trim() || null,
      image_url: String(result.rows[0].image_url || '').trim() || null
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
  const { email, city, phone, display_name } = req.body || {};
  const hasEmail = email !== undefined;
  const hasCity = city !== undefined;
  const hasPhone = phone !== undefined;
  const hasDisplayName = display_name !== undefined;

  if (!hasEmail && !hasCity && !hasPhone && !hasDisplayName) {
    return res.status(400).json({ error: 'No se enviaron cambios para actualizar perfil' });
  }

  const nextEmail = hasEmail ? String(email || '').trim().toLowerCase() : undefined;
  const nextCity = hasCity ? (city ? String(city).trim() : null) : undefined;
  const nextPhone = hasPhone ? (phone ? String(phone).trim() : null) : undefined;
  let nextDisplayName;
  if (hasDisplayName) {
    try {
      nextDisplayName = normalizeDisplayName(display_name, { required: false, fieldLabel: 'Nombre visible' });
    } catch (nameErr) {
      return res.status(nameErr?.statusCode || 400).json({ error: nameErr.message || 'Nombre visible inválido' });
    }
  }

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
    const updatedDisplayName = hasDisplayName ? nextDisplayName : (currentUser.display_name || null);

    const result = await pool.query(
      `UPDATE users
       SET email = $1,
           city = $2,
           phone = $3,
           display_name = $4
       WHERE id = $5
       RETURNING id, email, display_name, role, city, phone, panel_access`,
      [updatedEmail, updatedCity, updatedPhone, updatedDisplayName, req.user.id]
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

app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'La imagen es demasiado pesada para subir. Intenta con una imagen más liviana (máx ~8MB).'
    });
  }
  return next(err);
});

const PORT = process.env.PORT || 4000;
const startServer = async () => {
  await ensureUsersSchema();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

void startServer();