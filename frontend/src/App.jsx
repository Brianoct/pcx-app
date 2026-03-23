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
import './index.css';

// ─── Login Component ────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('http://localhost:4000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Login failed');
      }
      const data = await res.json();
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ 
      maxWidth: '420px', 
      margin: '80px auto', 
      padding: '32px 16px', 
      background: '#1e293b', 
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '24px', color: '#e11d48' }}>
        PCX
      </h2>
      {error && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af' }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ejemplo@sales.com"
            required
            style={{ 
              width: '100%', 
              padding: '12px', 
              fontSize: '1rem', 
              border: '1px solid #374151', 
              borderRadius: '8px', 
              background: '#0f172a', 
              color: 'white' 
            }}
          />
        </div>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af' }}>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ 
              width: '100%', 
              padding: '12px', 
              fontSize: '1rem', 
              border: '1px solid #374151', 
              borderRadius: '8px', 
              background: '#0f172a', 
              color: 'white' 
            }}
          />
        </div>
        <button 
          type="submit" 
          style={{ 
            width: '100%', 
            padding: '14px', 
            background: '#e11d48', 
            color: 'white', 
            border: 'none', 
            borderRadius: '8px', 
            fontSize: '1.1rem', 
            fontWeight: '600', 
            cursor: 'pointer' 
          }}
        >
          Iniciar Sesión
        </button>
      </form>
    </div>
  );
}

// ─── NavMenu Component ──────────────────────────────────────────────────────
function NavMenu({ displayName, handleLogout, currentCommission, isTopSeller }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuOpen && !event.target.closest('.nav-links.mobile') && !event.target.closest('.hamburger')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const NavLink = ({ to, label }) => {
    const loc = useLocation();
    const isActive = loc.pathname === to;
    return (
      <Link
        to={to}
        className={`nav-link ${isActive ? 'active' : ''}`}
        onClick={() => setMenuOpen(false)}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <nav style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: '#0f172a',
        borderBottom: '1px solid #374151',
        padding: '10px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '1.3rem', fontWeight: '700', color: '#e11d48' }}>
            PCX
          </span>

          <button 
            className="hamburger"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ fontSize: '1.8rem', background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer' }}
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          <div className="nav-links" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <NavLink to="/" label="Cotizar" />
            <NavLink to="/history" label="Historial" />
            <NavLink to="/performance" label="Rendimiento" />
          </div>
        </div>

        <div className="desktop-user" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ color: '#9ca3af', fontWeight: '500', fontSize: '0.95rem' }}>
            {displayName}
          </span>
          <span 
            style={{ 
              color: '#10b981', 
              fontWeight: '600', 
              fontSize: '1rem',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '6px 14px',
              borderRadius: '10px',
              border: isTopSeller ? '2px solid gold' : '1px solid #374151',
              boxShadow: isTopSeller ? '0 0 15px rgba(255, 215, 0, 0.7)' : 'none',
              transition: 'all 0.3s ease'
            }}
          >
            +{(currentCommission || 0).toFixed(2)} Bs
          </span>
          <button 
            onClick={handleLogout}
            style={{ 
              padding: '8px 14px', 
              background: '#374151', 
              color: '#ef4444', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Cerrar
          </button>
        </div>
      </nav>

      {menuOpen && <div className="mobile-menu-overlay active" onClick={() => setMenuOpen(false)} />}

      <div className={`nav-links mobile ${menuOpen ? 'active' : ''}`}>
        <NavLink to="/" label="Cotizar" />
        <NavLink to="/history" label="Historial" />
        <NavLink to="/performance" label="Rendimiento" />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px' }}>
          <span style={{ color: '#9ca3af', fontWeight: '500' }}>
            {displayName}
          </span>
          <span 
            style={{ 
              color: '#10b981', 
              fontWeight: '600',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '6px 14px',
              borderRadius: '10px',
              border: isTopSeller ? '2px solid gold' : '1px solid #374151',
              boxShadow: isTopSeller ? '0 0 15px rgba(255, 215, 0, 0.7)' : 'none',
              transition: 'all 0.3s ease'
            }}
          >
            +{(currentCommission || 0).toFixed(2)} Bs
          </span>
          <div 
            onClick={handleLogout}
            style={{ cursor: 'pointer', color: '#ef4444', fontWeight: '600' }}
          >
            Cerrar Sesión
          </div>
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

  const handleLogin = (newToken, userData) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('role', userData.role);
    setToken(newToken);
    setUser(userData);
    setRole(userData.role);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    setToken(null);
    setUser(null);
    setRole(null);
    setCurrentCommission(0);
    setIsTopSeller(false);
  };

  const handleTopSellerUpdate = (topInfo) => {
    if (!topInfo || !user) return;

    if (topInfo.comision !== null && topInfo.comision !== undefined) {
      const isMeTop = topInfo.vendor && topInfo.vendor.toLowerCase().includes(user.email.toLowerCase());
      setIsTopSeller(isMeTop);
      setCurrentCommission(topInfo.comision);
    }
  };

  useEffect(() => {
    if (token && user) {
      fetchPersonalCommission();
    }
  }, [token, user]);

  const fetchPersonalCommission = async () => {
    try {
      const params = new URLSearchParams({
        team: 'false',
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      });

      const res = await fetch(`http://localhost:4000/api/performance?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to fetch personal data');

      const data = await res.json();

      let commission = 0;
      let topSeller = false;

      if (role?.toLowerCase().includes('ventas lider') || role?.toLowerCase() === 'admin') {
        // Leader: 5% override
        const teamRes = await fetch(`http://localhost:4000/api/performance?team=true&month=${params.get('month')}&year=${params.get('year')}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (teamRes.ok) {
          const teamData = await teamRes.json();
          const totalTeam = Array.isArray(teamData) ? teamData.reduce((sum, item) => sum + Number(item.ventas_totales || 0), 0) : 0;
          commission = totalTeam * 0.05;
        }
      } else {
        // Regular seller: personal commission (8% default)
        const mySales = Number(data.ventas_totales || 0);
        commission = mySales * 0.08;
        topSeller = false; // Regular users cannot see team ranking
      }

      setCurrentCommission(commission);
      setIsTopSeller(topSeller);
    } catch (err) {
      console.error('Error fetching personal commission:', err);
      setCurrentCommission(0);
      setIsTopSeller(false);
    }
  };

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  const displayName = user ? user.email.split('@')[0] : 'Usuario';

  const isAlmacenLider = role?.toLowerCase().includes('almacen lider');
  const isMarketingLider = role?.toLowerCase().includes('marketing lider');

  const defaultPath = isAlmacenLider ? '/pedidos' : isMarketingLider ? '/combos' : '/';

  return (
    <Router>
      <NavMenu 
        displayName={displayName}
        handleLogout={handleLogout}
        currentCommission={currentCommission}
        isTopSeller={isTopSeller}
      />

      <Routes>
        <Route path="/" element={<QuoteTool token={token} user={user} />} />
        <Route path="/history" element={<QuoteHistory token={token} role={role} />} />
        <Route 
          path="/performance" 
          element={
            <PerformanceDashboard 
              token={token} 
              user={user}
              role={role} 
              onTopSellerChange={handleTopSellerUpdate} 
            />
          } 
        />
        <Route path="/combos" element={<Combos token={token} />} />
        <Route path="/cupones" element={<Cupones token={token} />} />
        <Route path="/admin" element={<AdminPanel token={token} />} />
        <Route path="/inventory" element={<InventoryPanel token={token} />} />
        <Route path="/pedidos" element={<PedidosPanel token={token} role={role} />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Router>
  );
}

export default App;