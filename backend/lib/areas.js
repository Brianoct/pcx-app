const { ROLE_KEYS, normalizeRole } = require('./rbac');

// Áreas del negocio. Mismas claves que AREA_LABELS del frontend
// (campaignShared.js): se usan en Campañas, Mejoras e Inicio.
const AREA_KEYS = ['ventas', 'almacen', 'produccion', 'marketing', 'admin'];

const AREA_LABELS = {
  ventas: 'Ventas',
  almacen: 'Almacén',
  produccion: 'Producción',
  marketing: 'Marketing',
  admin: 'Admin',
  general: 'General'
};

// A qué área pertenece un rol. Admin es el comodín de todo.
const areaForRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  if (role === ROLE_KEYS.admin) return 'admin';
  if (role === ROLE_KEYS.ventas || role === ROLE_KEYS.ventasLider || role === 'sales' || role === 'vendedor') return 'ventas';
  if (role === ROLE_KEYS.almacen || role === ROLE_KEYS.almacenLider) return 'almacen';
  if (role === ROLE_KEYS.produccion) return 'produccion';
  if (role === ROLE_KEYS.marketing || role === ROLE_KEYS.marketingLider) return 'marketing';
  return null;
};

module.exports = { AREA_KEYS, AREA_LABELS, areaForRole };
