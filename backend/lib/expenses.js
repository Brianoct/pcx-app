const { pool } = require('../db');
const { ROLE_KEYS, normalizeRole, normalizeText } = require('./rbac');
const { createHttpError, normalizeDepartmentLabel, parseBooleanLike } = require('./util');

const EXPENSE_RECURRENCE_VALUES = ['weekly', 'monthly', 'quarterly', 'yearly'];

const EXPENSE_CURRENCY_DEFAULT = 'BS';

const EXPENSE_DEPARTMENT_BY_ROLE = {
  [ROLE_KEYS.admin]: 'Administración',
  [ROLE_KEYS.ventas]: 'Ventas',
  [ROLE_KEYS.ventasLider]: 'Ventas',
  [ROLE_KEYS.almacen]: 'Almacén',
  [ROLE_KEYS.almacenLider]: 'Almacén',
  [ROLE_KEYS.marketing]: 'Marketing',
  [ROLE_KEYS.marketingLider]: 'Marketing',
  desarrollo: 'Desarrollo',
  'desarrollo lider': 'Desarrollo',
  [ROLE_KEYS.produccion]: 'Producción'
};

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

const normalizeExpenseCurrency = (value = 'BS') => {
  const raw = String(value || 'BS').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'BOB') return 'BS';
  if (raw === 'BS') return 'BS';
  return raw;
};

const mapExpenseRow = (row = {}) => ({
  id: Number(row.id),
  department: String(row.department || '').trim(),
  category: String(row.category || '').trim(),
  concept: String(row.concept || '').trim(),
  vendor: row.vendor || null,
  quantity: Math.max(1, Number.parseInt(row.quantity, 10) || 1),
  amount: Number(row.amount || 0),
  currency: normalizeExpenseCurrency(row.currency || 'BS'),
  is_recurring: Boolean(row.is_recurring),
  recurrence_period: row.recurrence_period || null,
  expense_date: row.expense_date,
  notes: row.notes || null,
  created_by: Number(row.created_by || 0),
  created_by_email: row.created_by_email || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

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

  if (!partial || has('quantity')) {
    const quantity = Number.parseInt(src.quantity ?? 1, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw createHttpError(400, 'Cantidad inválida (debe ser entero mayor a 0)');
    }
    normalized.quantity = quantity;
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
    const currency = normalizeExpenseCurrency(src.currency || 'BS');
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

module.exports = {
  EXPENSE_CURRENCY_DEFAULT,
  EXPENSE_DEPARTMENT_BY_ROLE,
  EXPENSE_RECURRENCE_VALUES,
  getExpensesAccessScope,
  mapExpenseRow,
  normalizeExpenseCurrency,
  normalizeExpenseDateInput,
  normalizeExpensePayload,
  normalizeRecurringPeriod,
  resolveDepartmentFromRole
};
