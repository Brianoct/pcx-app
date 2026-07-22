const { ROLE_KEYS, normalizeRole, normalizeText } = require('./rbac');

const INVENTORY_CITY_SCOPE = {
  cochabamba: {
    canonical: 'Cochabamba',
    stockField: 'stock_cochabamba',
    minField: 'min_stock_cochabamba',
    maxField: 'max_stock_cochabamba',
    aliases: ['cochabamba', 'cbba']
  },
  'santa cruz': {
    canonical: 'Santa Cruz',
    stockField: 'stock_santacruz',
    minField: 'min_stock_santacruz',
    maxField: 'max_stock_santacruz',
    aliases: ['santa cruz', 'santacruz', 'scz']
  },
  lima: {
    canonical: 'Lima',
    stockField: 'stock_lima',
    minField: 'min_stock_lima',
    maxField: 'max_stock_lima',
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

const getProductionKanbanAccessScope = (userContext, access) => {
  const isAdmin = normalizeRole(userContext?.role || '') === ROLE_KEYS.admin;
  // recepcion_panel también lee el tablero: la página Recepción (almacén)
  // necesita ver las tarjetas en etapa 'recepcion' para recibirlas.
  const hasKanbanAccess = Boolean(access?.produccion_kanban) || Boolean(access?.recepcion_panel) || isAdmin;
  if (!hasKanbanAccess) {
    return { error: 'No tienes permiso para Kanban de producción' };
  }
  return { allowed: true };
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

module.exports = {
  INVENTORY_CITY_SCOPE,
  getInventoryAccessScope,
  getPedidosAccessScope,
  getProductionKanbanAccessScope,
  resolveInventoryScopeByCity
};
