import QuoteTool from './QuoteTool';
import QuoteHistory from './QuoteHistory';
import PerformanceDashboard from './PerformanceDashboard';
import AdminDashboard from './AdminDashboard';
import AdminPanel from './AdminPanel';
import InventoryPanel from './InventoryPanel';
import PedidosPanel from './PedidosPanel';
import Combos from './Combos';
import Cupones from './Cupones';
import TimeOffCalendar from './TimeOffCalendar';
import QualityControlPanel from './QualityControlPanel';
import MicrofabricaPanel from './MicrofabricaPanel';
import ProductionKanban from './ProductionKanban';
import ExpensesPanel from './ExpensesPanel';
import CustomerMenuTool from './CustomerMenuTool';
import ProjectsPanel from './ProjectsPanel';
import ProfilePanel from './ProfilePanel';
import { canAccessPanel } from './roleAccess';

/**
 * Single source of truth for every internal destination.
 *
 * - `routeAccess`: panel keys (any-of) required to visit the route. `null` = any logged-in user.
 * - `navAccess`: panel keys (any-of) required to SHOW the item in navigation.
 *   Defaults to `routeAccess`. Some routes are reachable by admins as a fallback
 *   without being advertised in their menus (e.g. Microfábrica).
 * - `render(ctx)`: builds the page element. `ctx` carries session data and callbacks.
 *
 * The array order is the display order of the non-admin nav (first 7 visible,
 * rest under "Más").
 */
export const NAV_ITEMS = [
  {
    path: '/',
    label: 'Cotizar',
    routeAccess: ['cotizar'],
    render: (ctx) => <QuoteTool token={ctx.token} user={ctx.user} />
  },
  {
    path: '/catalogo-clientes',
    label: 'Catálogo Cliente',
    routeAccess: ['menu_cliente'],
    render: (ctx) => <CustomerMenuTool token={ctx.token} user={ctx.user} />
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
    path: '/performance',
    label: 'Rendimiento',
    routeAccess: ['rendimiento_global', 'rendimiento_individual'],
    render: (ctx) => (
      <PerformanceDashboard token={ctx.token} user={ctx.user} role={ctx.role} access={ctx.access} />
    )
  },
  {
    path: '/gastos',
    label: 'Gastos',
    routeAccess: ['gastos_panel'],
    render: (ctx) => <ExpensesPanel token={ctx.token} user={ctx.user} role={ctx.role} />
  },
  {
    path: '/microfabrica',
    label: 'Microfábrica',
    routeAccess: ['microfabrica_panel', 'admin'],
    navAccess: ['microfabrica_panel'],
    render: (ctx) => <MicrofabricaPanel token={ctx.token} />
  },
  {
    path: '/produccion-kanban',
    label: 'Producción Kanban',
    routeAccess: ['produccion_kanban', 'admin'],
    navAccess: ['produccion_kanban'],
    render: (ctx) => <ProductionKanban token={ctx.token} />
  },
  {
    path: '/control-calidad',
    label: 'Control de Calidad',
    routeAccess: ['control_calidad', 'admin'],
    navAccess: ['control_calidad'],
    render: (ctx) => <QualityControlPanel token={ctx.token} />
  },
  {
    path: '/proyectos',
    label: 'Proyectos',
    routeAccess: ['proyectos_panel'],
    render: (ctx) => <ProjectsPanel token={ctx.token} user={ctx.user} />
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
    path: '/calendario',
    label: 'Calendario',
    routeAccess: ['calendario', 'admin'],
    render: (ctx) => <TimeOffCalendar token={ctx.token} user={ctx.user} />
  },
  {
    path: '/perfil',
    label: 'Perfil',
    routeAccess: null,
    render: (ctx) => <ProfilePanel token={ctx.token} user={ctx.user} onUserUpdated={ctx.onUserUpdated} />
  },
  {
    path: '/admin',
    label: 'Admin',
    routeAccess: ['admin'],
    render: (ctx) => <AdminPanel token={ctx.token} />
  },
  {
    path: '/dashboard',
    label: 'Estadísticas',
    routeAccess: ['admin'],
    render: (ctx) => <AdminDashboard token={ctx.token} />
  }
];

// Grouped navigation shown to admin users (desktop dropdowns + mobile groups).
const ADMIN_SECTIONS = [
  { key: 'admin', label: 'Admin', paths: ['/admin', '/calendario', '/perfil'] },
  { key: 'ventas', label: 'Ventas', paths: ['/', '/history', '/catalogo-clientes'] },
  { key: 'marketing', label: 'Marketing', paths: ['/combos', '/cupones'] },
  { key: 'almacen', label: 'Almacén', paths: ['/pedidos', '/inventory', '/produccion-kanban'] },
  { key: 'mejoras', label: 'Mejoras', paths: ['/proyectos', '/control-calidad'] },
  { key: 'finanzas', label: 'Finanzas', paths: ['/gastos'] },
  { key: 'dashboard', label: 'Dashboard', paths: ['/dashboard'] }
];

// First matching access wins; used when a user lands on a route they cannot see.
const DEFAULT_PATH_PRIORITY = [
  [['admin'], '/admin'],
  [['pedidos_global', 'pedidos_individual'], '/pedidos'],
  [['microfabrica_panel'], '/microfabrica'],
  [['produccion_kanban'], '/produccion-kanban'],
  [['gastos_panel'], '/gastos'],
  [['marketing_combos'], '/combos'],
  [['proyectos_panel'], '/proyectos'],
  [['calendario'], '/calendario']
];

export const allowsAny = (access, keys) =>
  !keys || keys.length === 0 || keys.some((key) => canAccessPanel(access, key));

const toNavItem = ({ path, label }) => ({ to: path, label });

export function getFlatNavItems(access) {
  return NAV_ITEMS
    .filter((item) => allowsAny(access, item.navAccess || item.routeAccess))
    .map(toNavItem);
}

export function getAdminNavSections(access) {
  const byPath = new Map(NAV_ITEMS.map((item) => [item.path, item]));
  return ADMIN_SECTIONS
    .map((section) => ({
      key: section.key,
      label: section.label,
      items: section.paths
        .map((path) => byPath.get(path))
        .filter((item) => item && allowsAny(access, item.navAccess || item.routeAccess))
        .map(toNavItem)
    }))
    .filter((section) => section.items.length > 0);
}

export function getDefaultPath(access) {
  const hit = DEFAULT_PATH_PRIORITY.find(([keys]) => allowsAny(access, keys));
  return hit ? hit[1] : '/';
}
