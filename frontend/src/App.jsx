// App.jsx (full code - no omissions)
import { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import QuoteTool from './QuoteTool'; // Separated component
import QuoteHistory from './QuoteHistory';
import PerformanceDashboard from './PerformanceDashboard';
import AdminPanel from './AdminPanel';
import InventoryPanel from './InventoryPanel';
import PedidosPanel from './PedidosPanel';
import Combos from './Combos';
import Cupones from './Cupones';
import TimeOffCalendar from './TimeOffCalendar';
import QualityControlPanel from './QualityControlPanel';
import MicrofabricaPanel from './MicrofabricaPanel';
import ExpensesPanel from './ExpensesPanel';
import CustomerMenuTool from './CustomerMenuTool';
import PublicCustomerMenu from './PublicCustomerMenu';
import ProjectsPanel from './ProjectsPanel';
import ProfilePanel from './ProfilePanel';
import logo from './assets/PCX.png';
import './index.css';
import { buildAccessForUser, canAccessPanel } from './roleAccess';
import { apiRequest } from './apiClient';
import { useOnlineStatus } from './useOnlineStatus';
import { useOutbox } from './OutboxProvider';

// ─── Login Component ────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await apiRequest('/api/login', {
        method: 'POST',
        body: { email, password },
        retries: 0
      });
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <h2 className="login-title">
          PCX
        </h2>
        {error && <p className="login-error">{error}</p>}
      <form onSubmit={handleSubmit}>
        <div className="login-field">
          <label className="login-label">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ejemplo@sales.com"
            required
            className="login-input"
          />
        </div>
        <div className="login-field">
          <label className="login-label">Contraseña</label>
          <div className="password-input-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="login-input"
            />
            <button
              type="button"
              className="password-toggle-btn"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>
        <button type="submit" className="btn btn-primary login-submit">
          Iniciar Sesión
        </button>
      </form>
      </div>
    </div>
  );
}

// ─── NavMenu Component ──────────────────────────────────────────────────────
function NavMenu({ displayName, handleLogout, currentCommission, isTopSeller, access }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminTabPath = location.pathname === '/admin';
  const canQuote = canAccessPanel(access, 'cotizar');
  const canSeeHistory = canAccessPanel(access, 'historialGlobal') || canAccessPanel(access, 'historialIndividual');
  const canSeePerformance = canAccessPanel(access, 'rendimientoGlobal') || canAccessPanel(access, 'rendimientoIndividual');
  const canSeePedidos = canAccessPanel(access, 'pedidosGlobal') || canAccessPanel(access, 'pedidosIndividual');
  const canSeeInventory = canAccessPanel(access, 'inventarioGlobal') || canAccessPanel(access, 'inventarioIndividual');
  const canSeeExpenses = canAccessPanel(access, 'gastos_panel');
  const canSeeQualityControl = canAccessPanel(access, 'control_calidad');
  const canSeeMicrofabricaPanel = canAccessPanel(access, 'microfabrica_panel');
  const canSeeAdmin = canAccessPanel(access, 'admin');
  const canSeeProjects = canAccessPanel(access, 'proyectos_panel');
  const canSeeCalendar = canAccessPanel(access, 'calendario') || canSeeAdmin;
  const isAdminUser = canSeeAdmin;
  const canUseCustomerMenu = canAccessPanel(access, 'menu_cliente');

  useEffect(() => {
    setMenuOpen(false);
    setDesktopMoreOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuOpen && !event.target.closest('.nav-links.mobile') && !event.target.closest('.hamburger')) {
        setMenuOpen(false);
      }
      if (desktopMoreOpen && !event.target.closest('.more-menu')) {
        setDesktopMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen, desktopMoreOpen]);

  const adminCoreNavItems = isAdminUser
    ? [
        { to: '/admin?tab=usuarios', label: 'Usuarios' },
        { to: '/admin?tab=roles', label: 'Roles' },
        { to: '/admin?tab=productos', label: 'Productos' },
        { to: '/admin?tab=comisiones', label: 'Comisiones' },
        { to: '/admin?tab=estadisticas', label: 'Estadísticas' }
      ]
    : [];

  const sharedNavItems = [
    canQuote ? { to: '/', label: 'Cotizar' } : null,
    canUseCustomerMenu ? { to: '/catalogo-clientes', label: 'Catalogo Cliente' } : null,
    canSeeHistory ? { to: '/history', label: 'Historial' } : null,
    canSeePerformance ? { to: '/performance', label: 'Rendimiento' } : null,
    canSeePedidos ? { to: '/pedidos', label: 'Pedidos' } : null,
    canSeeInventory ? { to: '/inventory', label: 'Inventario' } : null,
    canSeeExpenses ? { to: '/gastos', label: 'Gastos' } : null,
    canSeeQualityControl ? { to: '/control-calidad', label: 'Control Calidad' } : null,
    canSeeMicrofabricaPanel ? { to: '/microfabrica', label: 'Microfábrica' } : null,
    canSeeProjects ? { to: '/proyectos', label: 'Proyectos' } : null,
    canAccessPanel(access, 'marketingCombos') ? { to: '/combos', label: 'Combos' } : null,
    canAccessPanel(access, 'marketingCupones') ? { to: '/cupones', label: 'Cupones' } : null,
    canSeeCalendar ? { to: '/calendario', label: 'Calendario' } : null,
    { to: '/perfil', label: 'Perfil' }
  ].filter(Boolean);

  const rolePreferredOrder = ['cotizar', 'catalogo-clientes', 'history', 'pedidos', 'inventory', 'performance', 'gastos', 'proyectos', 'calendario', 'perfil'];
  const roleOrderedSharedNavItems = !isAdminUser
    ? [...sharedNavItems].sort((a, b) => {
        const keyOf = (item) => {
          if (item.to === '/') return 'cotizar';
          if (item.to === '/catalogo-clientes' || item.to === '/menu-clientes') return 'catalogo-clientes';
          if (item.to === '/history') return 'history';
          if (item.to === '/pedidos') return 'pedidos';
          if (item.to === '/inventory') return 'inventory';
          if (item.to === '/performance') return 'performance';
          if (item.to === '/gastos') return 'gastos';
          if (item.to === '/proyectos') return 'proyectos';
          if (item.to === '/calendario') return 'calendario';
          if (item.to === '/perfil') return 'perfil';
          return item.to || '';
        };
        const aKey = keyOf(a);
        const bKey = keyOf(b);
        const aIndex = rolePreferredOrder.indexOf(aKey);
        const bIndex = rolePreferredOrder.indexOf(bKey);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      })
    : sharedNavItems;

  const allNavItems = isAdminUser
    ? [...adminCoreNavItems, ...sharedNavItems]
    : roleOrderedSharedNavItems;

  const MAX_DESKTOP_VISIBLE = isAdminUser
    ? (isAdminTabPath ? adminCoreNavItems.length : 0)
    : 7;
  const desktopPrimaryItems = allNavItems.slice(0, MAX_DESKTOP_VISIBLE);
  const desktopOverflowItems = allNavItems.slice(MAX_DESKTOP_VISIBLE);
  const isNavItemActive = (item) => {
    const [itemPath, itemQuery = ''] = String(item.to || '').split('?');
    if (location.pathname !== itemPath) return false;
    if (!itemQuery) return true;
    const itemParams = new URLSearchParams(itemQuery);
    const currentParams = new URLSearchParams(location.search || '');
    for (const [key, value] of itemParams.entries()) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  };

  return (
    <>
      <nav className="app-nav">
        <div className="app-nav-left">
          <img
            src={logo}
            alt="PCX"
            className="app-logo"
          />

          <button 
            className="hamburger"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          <div className="desktop-nav-cluster">
            <div className="nav-links desktop">
              {desktopPrimaryItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-link ${isNavItemActive(item) ? 'active' : ''}`}
                  onClick={() => setDesktopMoreOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {desktopOverflowItems.length > 0 && (
              <div className="more-menu">
                <button
                  type="button"
                  className={`more-menu-button ${desktopOverflowItems.some((item) => isNavItemActive(item)) ? 'active' : ''}`}
                  onClick={() => setDesktopMoreOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={desktopMoreOpen}
                >
                  {isAdminUser ? 'Operaciones ▾' : 'Más ▾'}
                </button>
                {desktopMoreOpen && (
                  <div className="more-menu-list" role="menu">
                    {desktopOverflowItems.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`more-menu-item ${isNavItemActive(item) ? 'active' : ''}`}
                        onClick={() => setDesktopMoreOpen(false)}
                        role="menuitem"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mobile-user-inline">
          <button
            type="button"
            className="desktop-user-name"
            onClick={() => navigate('/perfil')}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}
          >
            {displayName}
          </button>
          <button
            type="button"
            className={`commission-chip ${isTopSeller ? 'is-top' : ''}`}
            onClick={() => navigate('/performance')}
            style={{ border: 'none', cursor: 'pointer' }}
          >
            +{(currentCommission || 0).toFixed(2)} Bs
          </button>
        </div>

        <div className="desktop-user">
          <button
            type="button"
            className="desktop-user-name"
            onClick={() => navigate('/perfil')}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}
          >
            {displayName}
          </button>
          <button
            type="button"
            className={`commission-chip ${isTopSeller ? 'is-top' : ''}`}
            onClick={() => navigate('/performance')}
            style={{ border: 'none', cursor: 'pointer' }}
          >
            +{(currentCommission || 0).toFixed(2)} Bs
          </button>
          <button onClick={handleLogout} className="btn app-logout-btn">
            Cerrar
          </button>
        </div>
      </nav>

      {menuOpen && <div className="mobile-menu-overlay active" onClick={() => setMenuOpen(false)} />}

      <div className={`nav-links mobile ${menuOpen ? 'active' : ''}`}>
        {allNavItems.map((item) => (
          <Link
            key={`mobile-${item.to}`}
            to={item.to}
            className={`nav-link ${isNavItemActive(item) ? 'active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}

        <div className="mobile-user-panel">
          <button onClick={handleLogout} className="mobile-logout-btn">
            Cerrar Sesión
          </button>
        </div>
      </div>
    </>
  );
}

function OutboxPanel({
  items,
  pendingCount,
  errorCount,
  processing,
  open,
  onToggle,
  onRetry,
  onRetryWithLatest,
  onCancel,
  onOpenRecord
}) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const sortedItems = [...items]
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .slice(0, 8);

  const statusLabel = (item) => {
    if (item.status === 'syncing') return 'Sincronizando';
    if (item.status === 'pending') return 'Pendiente';
    if (item.status === 'error' && item.retryable === false) return 'Error manual';
    if (item.status === 'error') return 'Error reintento';
    return 'Pendiente';
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '';
    }
  };

  return (
    <aside className="outbox-panel" aria-live="polite">
      <div className="outbox-panel-header">
        <div>
          <h4 className="outbox-panel-title">Acciones pendientes</h4>
          <div className="outbox-panel-meta">
            {pendingCount} pendientes · {errorCount} errores
          </div>
        </div>
        <button type="button" className="outbox-panel-refresh" onClick={onToggle}>
          {open ? 'Ocultar' : 'Ver'}
        </button>
      </div>
      {open && (
        <div className="outbox-panel-list">
          {sortedItems.map((item) => (
            <div key={item.id} className="outbox-item">
              <div className="outbox-item-head">
                <div className="outbox-item-label">
                  {item.meta?.label || `${item.request?.method || 'POST'} ${item.request?.path || ''}`}
                </div>
                <span className={`outbox-item-status ${item.status === 'syncing' ? 'syncing' : item.status === 'error' ? 'error' : 'pending'}`}>
                  {statusLabel(item)}
                </span>
              </div>
              <div className="outbox-item-detail">
                Creado: {formatDate(item.created_at)} · Intentos: {Number(item.attempts || 0)}
              </div>
              {item.status === 'error' && item.retryable === false && (
                <div className="outbox-item-conflict">
                  {item.user_message || 'Accion requiere revision manual.'}
                </div>
              )}
              {item.status === 'error' && item.last_error && (
                <div className="outbox-item-error">Detalle: {item.last_error}</div>
              )}
              {item.status === 'error' && item.retryable === false && (
                <div className="outbox-item-guidance">
                  Sugerencia: {item.recommended_action || 'Revisa el registro y vuelve a intentar con datos actuales.'}
                </div>
              )}
              <div className="outbox-item-actions">
                <button
                  type="button"
                  className="outbox-item-btn retry"
                  onClick={() => onRetry(item.id)}
                  disabled={processing || item.status === 'syncing'}
                >
                  Reintentar
                </button>
                {item.status === 'error' && item.retryable === false && (
                  <>
                    <button
                      type="button"
                      className="outbox-item-btn open"
                      onClick={() => onOpenRecord(item)}
                      disabled={processing || item.status === 'syncing'}
                    >
                      Abrir registro
                    </button>
                    <button
                      type="button"
                      className="outbox-item-btn latest"
                      onClick={() => onRetryWithLatest(item.id)}
                      disabled={processing || item.status === 'syncing'}
                    >
                      Reintentar con datos actuales
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="outbox-item-btn cancel"
                  onClick={() => onCancel(item.id)}
                  disabled={processing || item.status === 'syncing'}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ))}
          {items.length > sortedItems.length && (
            <div className="outbox-item-detail">
              +{items.length - sortedItems.length} acciones mas en cola
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
function App() {
  const isOnline = useOnlineStatus();
  const {
    items,
    pendingCount,
    errorCount,
    processing,
    retryItem,
    retryWithLatestItem,
    queuePausedReason,
    cancelItem
  } = useOutbox();
  const [outboxPanelOpen, setOutboxPanelOpen] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [role, setRole] = useState(() => localStorage.getItem('role'));
  const [currentCommission, setCurrentCommission] = useState(0);
  const [isTopSeller, setIsTopSeller] = useState(false);
  const [access, setAccess] = useState(() => {
    const saved = localStorage.getItem('panel_access');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (newToken, userData) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('role', userData.role);
    localStorage.setItem('panel_access', JSON.stringify(userData.panel_access || null));
    setToken(newToken);
    setUser(userData);
    setRole(userData.role);
    setAccess(userData.panel_access || null);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    localStorage.removeItem('panel_access');
    setToken(null);
    setUser(null);
    setRole(null);
    setCurrentCommission(0);
    setIsTopSeller(false);
    setAccess(null);
  };

  const handleTopSellerUpdate = () => {};

  useEffect(() => {
    if (token && user) {
      fetchPersonalCommission();
    }
  }, [token, user, role]);

  useEffect(() => {
    if (errorCount > 0) {
      setOutboxPanelOpen(true);
    }
  }, [errorCount]);

  useEffect(() => {
    const syncSession = async () => {
      if (!token) return;
      try {
        const me = await apiRequest('/api/me', {
          token,
          timeoutMs: 10000
        });
        localStorage.setItem('user', JSON.stringify(me));
        localStorage.setItem('role', me.role);
        localStorage.setItem('panel_access', JSON.stringify(me.panel_access || null));
        setUser(me);
        setRole(me.role);
        setAccess(me.panel_access || null);
      } catch {
        // no-op; keep cached session
      }
    };
    syncSession();
  }, [token]);

  const fetchPersonalCommission = async () => {
    try {
      const params = new URLSearchParams({
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      });

      const data = await apiRequest(`/api/commission/current?${params.toString()}`, {
        token,
        timeoutMs: 10000
      });
      setCurrentCommission(Number(data?.commission || 0));
      setIsTopSeller(Boolean(data?.isTopSeller));
    } catch (err) {
      console.error('Error fetching personal commission:', err);
      setCurrentCommission(0);
      setIsTopSeller(false);
    }
  };

  const handleQuoteStatusChanged = () => {
    fetchPersonalCommission();
  };

  if (!token) {
    return (
      <Router>
        <Routes>
          <Route path="/catalogo/:shareToken" element={<PublicCustomerMenu />} />
          <Route path="/menu/:shareToken" element={<PublicCustomerMenu />} />
          <Route path="*" element={<Login onLogin={handleLogin} />} />
        </Routes>
      </Router>
    );
  }

  const displayName = user
    ? (String(user.display_name || '').trim() || String(user.email || '').split('@')[0] || 'Usuario')
    : 'Usuario';
  const effectiveAccess = buildAccessForUser(role, access);
  const defaultPath = canAccessPanel(effectiveAccess, 'admin')
    ? '/admin'
    : canAccessPanel(effectiveAccess, 'pedidos_global') || canAccessPanel(effectiveAccess, 'pedidos_individual')
      ? '/pedidos'
      : canAccessPanel(effectiveAccess, 'microfabrica_panel')
        ? '/microfabrica'
      : canAccessPanel(effectiveAccess, 'gastos_panel')
        ? '/gastos'
      : canAccessPanel(effectiveAccess, 'marketing_combos')
        ? '/combos'
        : canAccessPanel(effectiveAccess, 'proyectos_panel')
          ? '/proyectos'
        : canAccessPanel(effectiveAccess, 'calendario')
          ? '/calendario'
        : '/';

  const openOutboxRecord = (item) => {
    if (!item) return;
    const type = String(item?.meta?.recordType || item?.last_error_type || '').toLowerCase();
    if (type === 'inventory' || String(item?.request?.path || '').includes('/api/products/')) {
      window.location.hash = '#/inventory';
      return;
    }
    if (type === 'timeoff' || String(item?.request?.path || '').includes('/api/time-off')) {
      window.location.hash = '#/calendario';
      return;
    }
    if (String(item?.request?.path || '').includes('/api/qc/')) {
      window.location.hash = '#/control-calidad';
      return;
    }
    if (String(item?.request?.path || '').includes('/api/combos')) {
      window.location.hash = '#/combos';
      return;
    }
    if (String(item?.request?.path || '').includes('/api/cupones')) {
      window.location.hash = '#/cupones';
      return;
    }
    if (String(item?.request?.path || '').includes('/api/me')) {
      window.location.hash = '#/perfil';
      return;
    }
    if (String(item?.request?.path || '').includes('/api/expenses')) {
      window.location.hash = '#/gastos';
      return;
    }
    if (String(item?.request?.path || '').includes('/api/projects')) {
      window.location.hash = '#/proyectos';
      return;
    }
    window.location.hash = '#/history';
  };

  const retryOutboxWithLatest = (item) => {
    if (!item?.id) return;
    retryWithLatestItem(item.id);
  };

  return (
    <Router>
      {!isOnline && (
        <div className="network-banner offline" role="status" aria-live="polite">
          Sin conexión. Los cambios se guardan localmente cuando es posible.
        </div>
      )}
      {isOnline && pendingCount > 0 && (
        <div className="outbox-banner" role="status" aria-live="polite">
          Sincronizando acciones pendientes: {pendingCount}
        </div>
      )}
      {queuePausedReason === 'auth' && (
        <div className="outbox-banner outbox-banner-warning" role="status" aria-live="polite">
          La sincronizacion esta en pausa por sesion expirada. Cierra sesion y vuelve a iniciar para continuar.
        </div>
      )}
      <OutboxPanel
        items={items}
        pendingCount={pendingCount}
        errorCount={errorCount}
        processing={processing}
        open={outboxPanelOpen}
        onToggle={() => setOutboxPanelOpen((prev) => !prev)}
        onRetry={(itemId) => {
          retryItem(itemId);
        }}
        onRetryWithLatest={(itemId) => {
          retryWithLatestItem(itemId);
        }}
        onCancel={(itemId) => {
          cancelItem(itemId);
        }}
        onOpenRecord={openOutboxRecord}
      />
      <NavMenu 
        displayName={displayName}
        handleLogout={handleLogout}
        currentCommission={currentCommission}
        isTopSeller={isTopSeller}
        access={effectiveAccess}
      />

      <Routes>
        <Route
          path="/"
          element={canAccessPanel(effectiveAccess, 'cotizar') ? <QuoteTool token={token} user={user} /> : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/catalogo-clientes"
          element={
            canAccessPanel(effectiveAccess, 'menu_cliente')
              ? <CustomerMenuTool token={token} user={user} />
              : <Navigate to={defaultPath} replace />
          }
        />
        <Route path="/menu-clientes" element={<Navigate to="/catalogo-clientes" replace />} />
        <Route path="/catalogo/:shareToken" element={<PublicCustomerMenu />} />
        <Route path="/menu/:shareToken" element={<PublicCustomerMenu />} />
        <Route
          path="/history"
          element={
            canAccessPanel(effectiveAccess, 'historial_global') || canAccessPanel(effectiveAccess, 'historial_individual')
              ? <QuoteHistory token={token} role={role} access={effectiveAccess} onStatusUpdated={handleQuoteStatusChanged} />
              : <Navigate to={defaultPath} replace />
          }
        />
        <Route 
          path="/performance" 
          element={
            canAccessPanel(effectiveAccess, 'rendimiento_global') || canAccessPanel(effectiveAccess, 'rendimiento_individual')
              ? (
                <PerformanceDashboard 
                  token={token} 
                  user={user}
                  role={role}
                  access={effectiveAccess}
                  onTopSellerChange={handleTopSellerUpdate} 
                />
              )
              : <Navigate to={defaultPath} replace />
          } 
        />
        <Route
          path="/combos"
          element={canAccessPanel(effectiveAccess, 'marketing_combos') ? <Combos token={token} /> : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/cupones"
          element={canAccessPanel(effectiveAccess, 'marketing_cupones') ? <Cupones token={token} /> : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/admin"
          element={canAccessPanel(effectiveAccess, 'admin') ? <AdminPanel token={token} /> : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/inventory"
          element={
            canAccessPanel(effectiveAccess, 'inventario_global') || canAccessPanel(effectiveAccess, 'inventario_individual')
              ? <InventoryPanel token={token} role={role} access={effectiveAccess} />
              : <Navigate to={defaultPath} replace />
          }
        />
        <Route
          path="/pedidos"
          element={
            canAccessPanel(effectiveAccess, 'pedidos_global') || canAccessPanel(effectiveAccess, 'pedidos_individual')
              ? <PedidosPanel token={token} role={role} access={effectiveAccess} onStatusUpdated={handleQuoteStatusChanged} />
              : <Navigate to={defaultPath} replace />
          }
        />
        <Route
          path="/gastos"
          element={
            canAccessPanel(effectiveAccess, 'gastos_panel')
              ? <ExpensesPanel token={token} user={user} role={role} />
              : <Navigate to={defaultPath} replace />
          }
        />
        <Route
          path="/control-calidad"
          element={canAccessPanel(effectiveAccess, 'control_calidad') || canAccessPanel(effectiveAccess, 'admin')
            ? <QualityControlPanel token={token} />
            : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/microfabrica"
          element={canAccessPanel(effectiveAccess, 'microfabrica_panel') || canAccessPanel(effectiveAccess, 'admin')
            ? <MicrofabricaPanel token={token} />
            : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/calendario"
          element={canAccessPanel(effectiveAccess, 'calendario') || canAccessPanel(effectiveAccess, 'admin')
            ? <TimeOffCalendar token={token} user={user} />
            : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/proyectos"
          element={canAccessPanel(effectiveAccess, 'proyectos_panel')
            ? <ProjectsPanel token={token} user={user} />
            : <Navigate to={defaultPath} replace />}
        />
        <Route
          path="/perfil"
          element={
            <ProfilePanel
              token={token}
              user={user}
              onUserUpdated={(nextUser) => {
                if (!nextUser) return;
                localStorage.setItem('user', JSON.stringify(nextUser));
                localStorage.setItem('role', nextUser.role);
                localStorage.setItem('panel_access', JSON.stringify(nextUser.panel_access || null));
                setUser(nextUser);
                setRole(nextUser.role);
                setAccess(nextUser.panel_access || null);
              }}
            />
          }
        />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Router>
  );
}

export default App;