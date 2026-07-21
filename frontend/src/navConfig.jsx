import { lazy } from 'react';
import { canAccessPanel } from './roleAccess';

// Route-level code splitting: each panel loads on first visit, keeping the
// initial bundle small for mobile connections.
const Dashboard = lazy(() => import('./Dashboard'));
const QuoteTool = lazy(() => import('./QuoteTool'));
const QuoteHistory = lazy(() => import('./QuoteHistory'));
const AdminDashboard = lazy(() => import('./AdminDashboard'));
const AdminPanel = lazy(() => import('./admin/AdminPanel'));
const InventoryPanel = lazy(() => import('./InventoryPanel'));
const PedidosPanel = lazy(() => import('./PedidosPanel'));
const Combos = lazy(() => import('./Combos'));
const Cupones = lazy(() => import('./Cupones'));
const Calendar = lazy(() => import('./Calendar'));
const ProductionKanban = lazy(() => import('./ProductionKanban'));
const ProductionPlanning = lazy(() => import('./ProductionPlanning'));
const ProductionReception = lazy(() => import('./ProductionReception'));
const MejorasPanel = lazy(() => import('./MejorasPanel'));
const ExpensesPanel = lazy(() => import('./ExpensesPanel'));
const ProfilePanel = lazy(() => import('./ProfilePanel'));
const ComprasBoard = lazy(() => import('./ComprasBoard'));
const CampaignsPanel = lazy(() => import('./CampaignsPanel'));
const LivePanel = lazy(() => import('./LivePanel'));
const ForjaPanel = lazy(() => import('./ForjaPanel'));

/**
 * Single source of truth for every internal destination.
 *
 * - `routeAccess`: panel keys (any-of) required to visit the route. `null` = any logged-in user.
 * - `navAccess`: panel keys (any-of) required to SHOW the item in navigation.
 *   Defaults to `routeAccess`. Some routes are reachable by admins as a fallback
 *   without being advertised in their menus.
 * - `render(ctx)`: builds the page element. `ctx` carries session data and callbacks.
 *
 * The array order is the display order of the non-admin nav (first 7 visible,
 * rest under "Más").
 */
export const NAV_ITEMS = [
  {
    path: '/',
    label: 'Inicio',
    routeAccess: null,
    render: (ctx) => (
      <Dashboard token={ctx.token} user={ctx.user} role={ctx.role} access={ctx.access} />
    )
  },
  {
    path: '/cotizar',
    label: 'Cotizar',
    routeAccess: ['cotizar'],
    render: (ctx) => <QuoteTool token={ctx.token} user={ctx.user} />
  },
  {
    path: '/history',
    label: 'Historial',
    routeAccess: ['historial_global', 'historial_individual'],
    render: (ctx) => (
      <QuoteHistory token={ctx.token} role={ctx.role} access={ctx.access} onStatusUpdated={ctx.onQuoteStatusChanged} />
    )
  },
  {
    path: '/pedidos',
    label: 'Pedidos',
    routeAccess: ['pedidos_global', 'pedidos_individual'],
    render: (ctx) => (
      <PedidosPanel token={ctx.token} role={ctx.role} access={ctx.access} onStatusUpdated={ctx.onQuoteStatusChanged} />
    )
  },
  {
    path: '/inventory',
    label: 'Inventario',
    routeAccess: ['inventario_global', 'inventario_individual'],
    render: (ctx) => <InventoryPanel token={ctx.token} role={ctx.role} access={ctx.access} />
  },
  {
    path: '/comprar',
    label: 'Compras',
    routeAccess: ['compras_panel'],
    render: (ctx) => <ComprasBoard token={ctx.token} />
  },
  {
    path: '/gastos',
    label: 'Gastos',
    routeAccess: ['gastos_panel'],
    render: (ctx) => <ExpensesPanel token={ctx.token} user={ctx.user} role={ctx.role} />
  },
  {
    path: '/produccion-planificacion',
    label: 'Planificación',
    routeAccess: ['produccion_kanban', 'admin'],
    navAccess: ['produccion_kanban'],
    render: (ctx) => <ProductionPlanning token={ctx.token} />
  },
  {
    path: '/produccion-kanban',
    label: 'Kanban',
    routeAccess: ['produccion_kanban', 'admin'],
    navAccess: ['produccion_kanban'],
    render: (ctx) => <ProductionKanban token={ctx.token} onCommissionChanged={ctx.onQuoteStatusChanged} />
  },
  {
    path: '/recepcion',
    label: 'Recepción',
    routeAccess: ['produccion_kanban', 'inventario_global', 'inventario_individual', 'admin'],
    navAccess: ['produccion_kanban', 'inventario_global', 'inventario_individual'],
    render: (ctx) => <ProductionReception token={ctx.token} />
  },
  {
    path: '/mejoras',
    label: 'Mejoras',
    routeAccess: ['proyectos_panel', 'admin'],
    navAccess: ['proyectos_panel'],
    render: (ctx) => <MejorasPanel token={ctx.token} />
  },
  {
    path: '/combos',
    label: 'Combos',
    routeAccess: ['marketing_combos'],
    render: (ctx) => <Combos token={ctx.token} />
  },
  {
    path: '/cupones',
    label: 'Cupones',
    routeAccess: ['marketing_cupones'],
    render: (ctx) => <Cupones token={ctx.token} />
  },
  {
    path: '/campanas',
    label: 'Campañas',
    routeAccess: null,
    render: (ctx) => <CampaignsPanel token={ctx.token} user={ctx.user} role={ctx.role} />
  },
  {
    path: '/live',
    label: 'Live',
    routeAccess: null,
    render: (ctx) => <LivePanel token={ctx.token} role={ctx.role} />
  },
  {
    path: '/calendario',
    label: 'Plan del día',
    routeAccess: ['calendario', 'admin'],
    render: (ctx) => <Calendar token={ctx.token} user={ctx.user} />
  },
  {
    path: '/perfil',
    label: 'Perfil',
    routeAccess: null,
    render: (ctx) => <ProfilePanel token={ctx.token} user={ctx.user} onUserUpdated={ctx.onUserUpdated} />
  },
  {
    path: '/montana',
    label: 'La Montaña',
    routeAccess: ['admin'],
    // Hidden on purpose: no aparece en ningún menú (reuniones con pantalla
    // compartida). Se entra escribiendo la URL /#/montana directamente.
    hidden: true,
    render: (ctx) => <ForjaPanel token={ctx.token} />
  },
  {
    path: '/admin',
    label: 'Admin',
    routeAccess: ['admin'],
    render: (ctx) => <AdminPanel token={ctx.token} user={ctx.user} />
  },
  {
    path: '/dashboard',
    label: 'Estadísticas',
    routeAccess: ['admin'],
    render: (ctx) => <AdminDashboard token={ctx.token} />
  }
];

// Sidebar groups, shown to every user. A section renders only when the user
// can see at least one of its items, so most roles get a short sidebar.
const SIDEBAR_SECTIONS = [
  { key: 'principal', label: 'Principal', paths: ['/', '/calendario'] },
  { key: 'ventas', label: 'Ventas', paths: ['/cotizar', '/history'] },
  { key: 'almacen', label: 'Almacén', paths: ['/pedidos', '/inventory', '/recepcion', '/comprar'] },
  { key: 'produccion', label: 'Producción', paths: ['/produccion-planificacion', '/produccion-kanban'] },
  { key: 'mejoras', label: 'Mejoras', paths: ['/mejoras'] },
  { key: 'marketing', label: 'Marketing', paths: ['/campanas', '/live', '/combos', '/cupones'] },
  { key: 'finanzas', label: 'Finanzas', paths: ['/gastos'] },
  { key: 'administracion', label: 'Administración', paths: ['/admin', '/dashboard'] }
];

export const allowsAny = (access, keys) =>
  !keys || keys.length === 0 || keys.some((key) => canAccessPanel(access, key));

export function getSidebarSections(access) {
  const byPath = new Map(NAV_ITEMS.map((item) => [item.path, item]));
  return SIDEBAR_SECTIONS
    .map((section) => ({
      key: section.key,
      label: section.label,
      items: section.paths
        .map((path) => byPath.get(path))
        .filter((item) => item && !item.hidden && allowsAny(access, item.navAccess || item.routeAccess))
        .map(({ path, label }) => ({ to: path, label }))
    }))
    .filter((section) => section.items.length > 0);
}

export function getNavLabel(pathname) {
  const item = NAV_ITEMS.find((entry) => entry.path === pathname);
  return item ? item.label : 'PCX';
}

// The command center at "/" is available to every authenticated user, so it is
// the universal landing page and the safe redirect target for blocked routes.
export function getDefaultPath() {
  return '/';
}
