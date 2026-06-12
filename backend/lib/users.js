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

module.exports = {
  buildUserPayload,
  loadUserContext,
  normalizeDisplayName,
  resolveUserDisplayName
};
