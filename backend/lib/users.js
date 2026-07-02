const { pool } = require('../db');
const { sanitizePanelAccess } = require('./rbac');
const { createHttpError, getUserDisplayName } = require('./util');

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

// Format a DATE column as YYYY-MM-DD for <input type="date"> without timezone
// drift (pg may return a Date object or a string depending on driver settings).
const formatDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  return str ? str.slice(0, 10) : null;
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
    avatar_url: userRow.avatar_url || null,
    payment_qr_url: userRow.payment_qr_url || null,
    payment_info: userRow.payment_info || null,
    national_id: userRow.national_id || null,
    birth_date: formatDateOnly(userRow.birth_date),
    emergency_contact_name: userRow.emergency_contact_name || null,
    emergency_contact_phone: userRow.emergency_contact_phone || null,
    created_at: userRow.created_at || null,
    panel_access
  };
};

const USER_CONTEXT_COLUMNS = `id, email, display_name, role, city, phone,
  avatar_url, payment_qr_url, payment_info, national_id, birth_date,
  emergency_contact_name, emergency_contact_phone, created_at, panel_access`;

const loadUserContext = async (userId) => {
  const result = await pool.query(
    `SELECT ${USER_CONTEXT_COLUMNS} FROM users WHERE id = $1`,
    [userId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

module.exports = {
  buildUserPayload,
  loadUserContext,
  normalizeDisplayName,
  resolveUserDisplayName
};
