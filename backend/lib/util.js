const { normalizeText } = require('./rbac');

const normalizeDepartmentLabel = (value = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\s+/g, ' ')
    .slice(0, 80);
};

const parseBooleanLike = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  const normalized = normalizeText(String(value));
  if (['1', 'true', 'si', 'sí', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return fallback;
};

const clampPercent = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

const parseJsonInput = (value, { expected = 'object', fieldLabel = 'JSON' } = {}) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (expected === 'array' && !Array.isArray(parsed)) throw new Error('not_array');
      if (expected === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('not_object');
      return parsed;
    } catch {
      throw createHttpError(400, `${fieldLabel} no tiene formato JSON válido`);
    }
  }
  if (expected === 'array' && !Array.isArray(value)) {
    throw createHttpError(400, `${fieldLabel} debe ser un arreglo`);
  }
  if (expected === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw createHttpError(400, `${fieldLabel} debe ser un objeto`);
  }
  return value;
};

const parseOptionalBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return defaultValue;
};

const createHttpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const getUserDisplayName = (userRow, fallback = 'Usuario') => {
  const explicit = String(userRow?.display_name || '').trim();
  if (explicit) return explicit;
  const fromEmail = String(userRow?.email || '').split('@')[0].trim();
  return fromEmail || fallback;
};

module.exports = {
  clampPercent,
  createHttpError,
  getUserDisplayName,
  normalizeDepartmentLabel,
  parseBooleanLike,
  parseJsonInput,
  parseOptionalBoolean
};
