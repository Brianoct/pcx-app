// 'Produccion' replaced Microfabrica / Microfabrica Lider; alias legacy names.
export const normalizeRole = (value = '') => {
  const normalized = String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (normalized === 'microfabrica' || normalized === 'microfabrica lider') return 'produccion';
  return normalized;
};

const ACCESS_TEMPLATE = {
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
  campanas_live: true,
  marketing_calendario: false,
  marketing_inversion: false,
  admin: false
};

const ROLE_DEFAULTS = {
  ventas: {
    cotizar: true,
    menu_cliente: true,
    calendario: true,
    historial_individual: true,
    rendimiento_individual: true
  },
  'ventas lider': {
    cotizar: true,
    menu_cliente: true,
    calendario: true,
    historial_global: true,
    rendimiento_global: true
  },
  admin: {
    cotizar: true,
    menu_cliente: true,
    calendario: true,
    historial_global: true,
    rendimiento_global: true,
    pedidos_global: true,
    inventario_global: true,
    gastos_panel: true,
    compras_panel: true,
    marketing_combos: true,
    marketing_cupones: true,
    marketing_calendario: true,
    marketing_inversion: true,
    admin: true
  },
  almacen: {
    cotizar: true,
    calendario: true,
    pedidos_individual: true,
    inventario_individual: true,
    produccion_kanban: true
  },
  'almacen lider': {
    cotizar: true,
    calendario: true,
    pedidos_global: true,
    inventario_global: true,
    control_calidad: true,
    produccion_kanban: true,
    compras_panel: true
  },
  marketing: {
    calendario: true,
    marketing_combos: true,
    marketing_cupones: true,
    marketing_calendario: true,
    marketing_inversion: true
  },
  'marketing lider': {
    calendario: true,
    marketing_combos: true,
    marketing_cupones: true,
    marketing_calendario: true,
    marketing_inversion: true
  },
  produccion: {
    calendario: true,
    microfabrica_panel: true,
    produccion_kanban: true
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
  'Produccion'
];

const PANEL_KEY_ALIASES = {
  cotizar: 'cotizar',
  quote: 'cotizar',
  menu_cliente: 'menu_cliente',
  menucliente: 'menu_cliente',
  menu_clientes: 'menu_cliente',
  menuclientes: 'menu_cliente',
  customer_menu: 'menu_cliente',
  customermenu: 'menu_cliente',
  customer_menu_tool: 'menu_cliente',
  customerMenu: 'menu_cliente',
  calendario: 'calendario',
  calendar: 'calendario',
  timeoff: 'calendario',
  time_off: 'calendario',
  timeoff_calendar: 'calendario',
  timeoffcalendar: 'calendario',
  proyectos_panel: 'proyectos_panel',
  proyectospanel: 'proyectos_panel',
  proyectos: 'proyectos_panel',
  proyecto: 'proyectos_panel',
  projects_panel: 'proyectos_panel',
  projectspanel: 'proyectos_panel',
  projects: 'proyectos_panel',
  project: 'proyectos_panel',
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
  control_calidad: 'control_calidad',
  controlcalidad: 'control_calidad',
  quality_control: 'control_calidad',
  qualitycontrol: 'control_calidad',
  qc: 'control_calidad',
  controlCalidad: 'control_calidad',
  microfabrica_panel: 'microfabrica_panel',
  microfabricapanel: 'microfabrica_panel',
  microfabrica: 'microfabrica_panel',
  microfactory: 'microfabrica_panel',
  microfactory_panel: 'microfabrica_panel',
  microfactorypanel: 'microfabrica_panel',
  produccion_kanban: 'produccion_kanban',
  produccionkanban: 'produccion_kanban',
  produccion: 'produccion_kanban',
  production_kanban: 'produccion_kanban',
  productionkanban: 'produccion_kanban',
  production: 'produccion_kanban',
  kanban_produccion: 'produccion_kanban',
  kanbanproduccion: 'produccion_kanban',
  productionKanban: 'produccion_kanban',
  gastos_panel: 'gastos_panel',
  gastospanel: 'gastos_panel',
  gastos: 'gastos_panel',
  expenses: 'gastos_panel',
  expenses_panel: 'gastos_panel',
  expensespanel: 'gastos_panel',
  gastosPanel: 'gastos_panel',
  expensesPanel: 'gastos_panel',
  compras_panel: 'compras_panel',
  compraspanel: 'compras_panel',
  compras: 'compras_panel',
  comprar: 'compras_panel',
  procurement: 'compras_panel',
  purchasing: 'compras_panel',
  comprasPanel: 'compras_panel',
  marketing_combos: 'marketing_combos',
  marketingcombos: 'marketing_combos',
  combos: 'marketing_combos',
  marketingCombos: 'marketing_combos',
  marketing_cupones: 'marketing_cupones',
  marketingcupones: 'marketing_cupones',
  cupones: 'marketing_cupones',
  marketingCupones: 'marketing_cupones',
  campanas_live: 'campanas_live',
  campanaslive: 'campanas_live',
  campanas: 'campanas_live',
  live: 'campanas_live',
  marketing_calendario: 'marketing_calendario',
  marketingcalendario: 'marketing_calendario',
  marketing_inversion: 'marketing_inversion',
  marketinginversion: 'marketing_inversion',
  inversion: 'marketing_inversion',
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

// Permisos agrupados igual que el menú lateral: la persona que asigna
// permisos piensa en secciones, no en una lista plana.
export const ACCESS_GROUPS = [
  {
    label: 'Principal',
    keys: [
      { key: 'calendario', label: 'Plan del día' }
    ]
  },
  {
    label: 'Ventas',
    keys: [
      { key: 'cotizar', label: 'Cotizar' },
      { key: 'menu_cliente', label: 'Catálogo para clientes (enlace)' },
      { key: 'historial_individual', label: 'Historial (solo lo suyo)' },
      { key: 'historial_global', label: 'Historial (todo el equipo)' },
      { key: 'rendimiento_individual', label: 'Rendimiento (solo lo suyo)' },
      { key: 'rendimiento_global', label: 'Rendimiento (todo el equipo)' }
    ]
  },
  {
    label: 'Almacén',
    keys: [
      { key: 'pedidos_individual', label: 'Pedidos (su ciudad)' },
      { key: 'pedidos_global', label: 'Pedidos (todas las ciudades)' },
      { key: 'inventario_individual', label: 'Inventario (su ciudad)' },
      { key: 'inventario_global', label: 'Inventario (todas las ciudades)' },
      { key: 'control_calidad', label: 'Registros de control de calidad' }
    ]
  },
  {
    label: 'Producción',
    keys: [
      { key: 'produccion_kanban', label: 'Planificación, Kanban y Recepción' },
      { key: 'microfabrica_panel', label: 'Aprobar control de calidad (Kanban)' }
    ]
  },
  {
    label: 'Mejoras',
    keys: [
      { key: 'proyectos_panel', label: 'Mejoras (bono por estándares)' }
    ]
  },
  {
    label: 'Marketing',
    keys: [
      { key: 'campanas_live', label: 'Campañas y Live (ver y marcar su área)' },
      { key: 'marketing_calendario', label: 'Calendario de Marketing' },
      { key: 'marketing_inversion', label: 'Inversión (costos y retorno)' },
      { key: 'marketing_combos', label: 'Combos' },
      { key: 'marketing_cupones', label: 'Cupones' }
    ]
  },
  {
    label: 'Finanzas',
    keys: [
      { key: 'gastos_panel', label: 'Gastos' }
    ]
  },
  {
    label: 'Administración',
    keys: [
      { key: 'compras_panel', label: 'Compras' },
      { key: 'admin', label: 'Panel Admin y Estadísticas' }
    ]
  }
];

// Lista plana (compatibilidad con pantallas que iteran todos los permisos).
export const ACCESS_LABELS = ACCESS_GROUPS.flatMap((group) => group.keys);

export const ROLE_LABELS = [
  { role: 'Ventas', key: 'ventas' },
  { role: 'Ventas Lider', key: 'ventas lider' },
  { role: 'Almacen', key: 'almacen' },
  { role: 'Almacen Lider', key: 'almacen lider' },
  { role: 'Produccion', key: 'produccion' },
  { role: 'Marketing', key: 'marketing' },
  { role: 'Marketing Lider', key: 'marketing lider' },
  { role: 'Admin', key: 'admin' }
];
