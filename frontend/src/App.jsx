// App.jsx (full code - no omissions)
import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
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
import ProfilePanel from './ProfilePanel';
import logo from './assets/PCX.png';
import './index.css';
import { buildAccessForUser, canAccessPanel } from './roleAccess';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ─── Login Component ────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo iniciar sesión');
      }
      const data = await res.json();
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="login-input"
          />
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
  const canQuote = canAccessPanel(access, 'cotizar');
  const canSeeHistory = canAccessPanel(access, 'historialGlobal') || canAccessPanel(access, 'historialIndividual');
  const canSeePerformance = canAccessPanel(access, 'rendimientoGlobal') || canAccessPanel(access, 'rendimientoIndividual');
  const canSeePedidos = canAccessPanel(access, 'pedidosGlobal') || canAccessPanel(access, 'pedidosIndividual');
  const canSeeInventory = canAccessPanel(access, 'inventarioGlobal') || canAccessPanel(access, 'inventarioIndividual');
  const canSeeQualityControl = canAccessPanel(access, 'control_calidad');
  const canSeeMicrofabricaPanel = canAccessPanel(access, 'microfabrica_panel');
  const canSeeAdmin = canAccessPanel(access, 'admin');
  const canSeeCalendar = canAccessPanel(access, 'calendario') || canSeeAdmin;

  useEffect(() => {
    setMenuOpen(false);
    setDesktopMoreOpen(false);
  }, [location.pathname]);

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

  const allNavItems = [
    canQuote ? { to: '/', label: 'Cotizar' } : null,
    canSeeHistory ? { to: '/history', label: 'Historial' } : null,
    canSeePerformance ? { to: '/performance', label: 'Rendimiento' } : null,
    canSeePedidos ? { to: '/pedidos', label: 'Pedidos' } : null,
    canSeeInventory ? { to: '/inventory', label: 'Inventario' } : null,
    canSeeQualityControl ? { to: '/control-calidad', label: 'Control Calidad' } : null,
    canSeeMicrofabricaPanel ? { to: '/microfabrica', label: 'Microfábrica' } : null,
    canSeeCalendar ? { to: '/calendario', label: 'Calendario' } : null,
    { to: '/perfil', label: 'Perfil' },
    canAccessPanel(access, 'marketingCombos') ? { to: '/combos', label: 'Combos' } : null,
    canAccessPanel(access, 'marketingCupones') ? { to: '/cupones', label: 'Cupones' } : null,
    canSeeAdmin ? { to: '/admin', label: 'Admin' } : null
  ].filter(Boolean);

  const MAX_DESKTOP_VISIBLE = 7;
  const desktopPrimaryItems = allNavItems.slice(0, MAX_DESKTOP_VISIBLE);
  const desktopOverflowItems = allNavItems.slice(MAX_DESKTOP_VISIBLE);

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
                  className={`nav-link ${location.pathname === item.to ? 'active' : ''}`}
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
                  className={`more-menu-button ${desktopOverflowItems.some((item) => location.pathname === item.to) ? 'active' : ''}`}
                  onClick={() => setDesktopMoreOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={desktopMoreOpen}
                >
                  Más ▾
                </button>
                {desktopMoreOpen && (
                  <div className="more-menu-list" role="menu">
                    {desktopOverflowItems.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`more-menu-item ${location.pathname === item.to ? 'active' : ''}`}
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
          <span className="desktop-user-name">
            {displayName}
          </span>
          <span className={`commission-chip ${isTopSeller ? 'is-top' : ''}`}>
            +{(currentCommission || 0).toFixed(2)} Bs
          </span>
        </div>

        <div className="desktop-user">
          <span className="desktop-user-name">
            {displayName}
          </span>
          <span className={`commission-chip ${isTopSeller ? 'is-top' : ''}`}>
            +{(currentCommission || 0).toFixed(2)} Bs
          </span>
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
            className={`nav-link ${location.pathname === item.to ? 'active' : ''}`}
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

// ─── Main App ────────────────────────────────────────────────────────────────
function App() {
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
    const syncSession = async () => {
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/api/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const me = await res.json();
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
  }, [token, API_BASE]);

  const fetchPersonalCommission = async () => {
    try {
      const params = new URLSearchParams({
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      });

      const res = await fetch(`${API_BASE}/api/commission/current?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('No se pudo cargar la comisión');

      const data = await res.json();
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
    return <Login onLogin={handleLogin} />;
  }

  const displayName = user ? user.email.split('@')[0] : 'Usuario';
  const effectiveAccess = buildAccessForUser(role, access);
  const defaultPath = canAccessPanel(effectiveAccess, 'admin')
    ? '/admin'
    : canAccessPanel(effectiveAccess, 'pedidos_global') || canAccessPanel(effectiveAccess, 'pedidos_individual')
      ? '/pedidos'
      : canAccessPanel(effectiveAccess, 'microfabrica_panel')
        ? '/microfabrica'
      : canAccessPanel(effectiveAccess, 'marketing_combos')
        ? '/combos'
        : canAccessPanel(effectiveAccess, 'calendario')
          ? '/calendario'
        : '/';

  return (
    <Router>
      <NavMenu 
        displayName={displayName}
        handleLogout={handleLogout}
        currentCommission={currentCommission}
        isTopSeller={isTopSeller}
        role={role}
        access={effectiveAccess}
      />

      <Routes>
        <Route
          path="/"
          element={canAccessPanel(effectiveAccess, 'cotizar') ? <QuoteTool token={token} user={user} /> : <Navigate to={defaultPath} replace />}
        />
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