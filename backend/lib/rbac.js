
const normalizeText = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const normalizeRole = (value = '') => normalizeText(value);

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
  'produccion_kanban',
  'gastos_panel',
  'compras_panel',
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
    produccion_kanban: false,
    gastos_panel: false,
    compras_panel: false,
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
      inventario_individual: true,
      produccion_kanban: true
    };
  }

  if (role === 'almacen lider') {
    return {
      ...base,
      cotizar: true,
      calendario: true,
      pedidos_global: true,
      inventario_global: true,
      control_calidad: true,
      produccion_kanban: true,
      compras_panel: true
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
      microfabrica_panel: true,
      produccion_kanban: true
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

module.exports = {
  DEFAULT_ROLE_ACCESS,
  PANEL_KEYS,
  ROLE_DEFAULT_ROLES,
  ROLE_KEYS,
  canAccessPanel,
  getDefaultPanelAccessForRole,
  mergeAccessWithDefaults,
  normalizeRole,
  normalizeText,
  sanitizePanelAccess
};
