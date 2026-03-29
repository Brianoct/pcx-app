export const normalizeRole = (value = '') =>
  String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const ACCESS_TEMPLATE = {
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
  marketing_combos: false,
  marketing_cupones: false,
  admin: false
};

const ROLE_DEFAULTS = {
  ventas: {
    cotizar: true,
    calendario: true,
    historial_individual: true,
    rendimiento_individual: true
  },
  'ventas lider': {
    cotizar: true,
    calendario: true,
    historial_global: true,
    rendimiento_global: true
  },
  admin: {
    cotizar: true,
    calendario: true,
    historial_global: true,
    rendimiento_global: true,
    pedidos_global: true,
    inventario_global: true,
    marketing_combos: true,
    marketing_cupones: true,
    admin: true
  },
  almacen: {
    cotizar: true,
    calendario: true,
    pedidos_individual: true,
    inventario_individual: true
  },
  'almacen lider': {
    cotizar: true,
    calendario: true,
    pedidos_global: true,
    inventario_global: true
  },
  marketing: {
    calendario: true,
    marketing_combos: true,
    marketing_cupones: true
  },
  'marketing lider': {
    calendario: true,
    marketing_combos: true,
    marketing_cupones: true
  },
  microfabrica: {
    calendario: true
  },
  'microfabrica lider': {
    calendario: true
  }
};

export const ROLE_OPTIONS = [
  'Ventas',
  'Ventas Lider',
  'Marketing',
  'Marketing Lider',
  'Admin',
  'Almacen Lider',
  'Almacen',
  'Microfabrica Lider',
  'Microfabrica'
];

const PANEL_KEY_ALIASES = {
  cotizar: 'cotizar',
  quote: 'cotizar',
  calendario: 'calendario',
  calendar: 'calendario',
  timeoff: 'calendario',
  time_off: 'calendario',
  timeoff_calendar: 'calendario',
  timeoffcalendar: 'calendario',
  historial_individual: 'historial_individual',
  historialindividual: 'historial_individual',
  history_individual: 'historial_individual',
  historyindividual: 'historial_individual',
  historialIndividual: 'historial_individual',
  historyIndividual: 'historial_individual',
  historial_global: 'historial_global',
  historialglobal: 'historial_global',
  history_global: 'historial_global',
  historyglobal: 'historial_global',
  historialGlobal: 'historial_global',
  historyGlobal: 'historial_global',
  rendimiento_individual: 'rendimiento_individual',
  rendimientoindividual: 'rendimiento_individual',
  performance_individual: 'rendimiento_individual',
  performanceindividual: 'rendimiento_individual',
  rendimientoIndividual: 'rendimiento_individual',
  performanceIndividual: 'rendimiento_individual',
  rendimiento_global: 'rendimiento_global',
  rendimientoglobal: 'rendimiento_global',
  performance_global: 'rendimiento_global',
  performanceglobal: 'rendimiento_global',
  rendimientoGlobal: 'rendimiento_global',
  performanceGlobal: 'rendimiento_global',
  pedidos_individual: 'pedidos_individual',
  pedidosindividual: 'pedidos_individual',
  pedidosIndividual: 'pedidos_individual',
  pedidos_global: 'pedidos_global',
  pedidosglobal: 'pedidos_global',
  pedidosGlobal: 'pedidos_global',
  inventario_individual: 'inventario_individual',
  inventarioindividual: 'inventario_individual',
  inventory_individual: 'inventario_individual',
  inventoryindividual: 'inventario_individual',
  inventarioIndividual: 'inventario_individual',
  inventoryIndividual: 'inventario_individual',
  inventario_global: 'inventario_global',
  inventarioglobal: 'inventario_global',
  inventory_global: 'inventario_global',
  inventoryglobal: 'inventario_global',
  inventarioGlobal: 'inventario_global',
  inventoryGlobal: 'inventario_global',
  marketing_combos: 'marketing_combos',
  marketingcombos: 'marketing_combos',
  combos: 'marketing_combos',
  marketingCombos: 'marketing_combos',
  marketing_cupones: 'marketing_cupones',
  marketingcupones: 'marketing_cupones',
  cupones: 'marketing_cupones',
  marketingCupones: 'marketing_cupones',
  admin: 'admin'
};

const toCanonicalPanelKey = (key = '') =>
  PANEL_KEY_ALIASES[key] || PANEL_KEY_ALIASES[String(key).replace(/\s+/g, '').toLowerCase()] || null;

export function buildAccessForUser(role = '', panelAccess = null) {
  const roleKey = normalizeRole(role);
  const base = { ...ACCESS_TEMPLATE, ...(ROLE_DEFAULTS[roleKey] || {}) };
  if (!panelAccess || typeof panelAccess !== 'object' || Array.isArray(panelAccess)) {
    return base;
  }

  const merged = { ...base };
  for (const [rawKey, rawValue] of Object.entries(panelAccess)) {
    const canonical = toCanonicalPanelKey(rawKey);
    if (!canonical) continue;
    merged[canonical] = Boolean(rawValue);
  }
  return merged;
}

export function roleDefaultsFromApi(rows = []) {
  const map = {};
  for (const role of ROLE_OPTIONS) {
    map[role] = buildAccessForUser(role);
  }
  for (const row of rows || []) {
    if (!row?.role_name) continue;
    map[row.role_name] = buildAccessForUser(row.role_name, row.panel_access);
  }
  return map;
}

export function canAccessPanel(accessOrRole, maybeAccessOrKey, maybeKey) {
  let access;
  let key;

  if (typeof accessOrRole === 'object' && accessOrRole !== null && typeof maybeAccessOrKey === 'string' && maybeKey === undefined) {
    access = accessOrRole;
    key = maybeAccessOrKey;
  } else if (typeof accessOrRole === 'string' && typeof maybeAccessOrKey === 'string' && maybeKey === undefined) {
    access = buildAccessForUser(accessOrRole, null);
    key = maybeAccessOrKey;
  } else {
    access = buildAccessForUser(accessOrRole, maybeAccessOrKey);
    key = maybeKey;
  }

  const canonical = toCanonicalPanelKey(key);
  if (!canonical) return false;
  return Boolean(access?.[canonical]);
}

export const ACCESS_LABELS = [
  { key: 'cotizar', label: 'Cotizar' },
  { key: 'calendario', label: 'Calendario' },
  { key: 'historial_individual', label: 'Historial individual' },
  { key: 'historial_global', label: 'Historial global' },
  { key: 'rendimiento_individual', label: 'Rendimiento individual' },
  { key: 'rendimiento_global', label: 'Rendimiento global' },
  { key: 'pedidos_individual', label: 'Pedidos individual' },
  { key: 'pedidos_global', label: 'Pedidos global' },
  { key: 'inventario_individual', label: 'Inventario individual' },
  { key: 'inventario_global', label: 'Inventario global' },
  { key: 'marketing_combos', label: 'Combos (Marketing)' },
  { key: 'marketing_cupones', label: 'Cupones (Marketing)' },
  { key: 'admin', label: 'Panel Admin' }
];

export const ROLE_LABELS = [
  { role: 'Ventas', key: 'ventas' },
  { role: 'Ventas Lider', key: 'ventas lider' },
  { role: 'Almacen', key: 'almacen' },
  { role: 'Almacen Lider', key: 'almacen lider' },
  { role: 'Microfabrica Lider', key: 'microfabrica lider' },
  { role: 'Microfabrica', key: 'microfabrica' },
  { role: 'Marketing', key: 'marketing' },
  { role: 'Marketing Lider', key: 'marketing lider' },
  { role: 'Admin', key: 'admin' }
];
