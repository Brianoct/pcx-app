import { NavLink, useNavigate } from 'react-router-dom';
import logo from './assets/PCX.png';
import { getSidebarSections } from './navConfig';

// Iconos por ruta: monocromos y discretos para que la barra se lea limpia.
const NAV_ICONS = {
  '/': '⌂',
  '/calendario': '☑',
  '/cotizar': '✚',
  '/history': '≣',
  '/pedidos': '⧉',
  '/inventory': '▤',
  '/recepcion': '⬇',
  '/produccion-planificacion': '◫',
  '/produccion-kanban': '⚙',
  '/mejoras': '✦',
  '/marketing-calendario': '▦',
  '/campanas': '◈',
  '/live': '●',
  '/promos': '%',
  '/marketing-inversion': '↗',
  '/combos': '❖',
  '/gastos': '$',
  '/comprar': '⊞',
  '/admin': '⛭',
  '/dashboard': '𝄜'
};

function Sidebar({ access, displayName, roleName, onLogout, onNavigate }) {
  const sections = getSidebarSections(access);
  const navigate = useNavigate();
  const initial = String(displayName || '?').trim().charAt(0).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src={logo} alt="PCX" className="app-logo" />
      </div>

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div key={section.key} className="sidebar-section">
            <div className="sidebar-section-title">{section.label}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={onNavigate}
              >
                <span className="sidebar-link-icon" aria-hidden="true">{NAV_ICONS[item.to] || '·'}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-user"
          title="Mi perfil"
          onClick={() => {
            onNavigate?.();
            navigate('/perfil');
          }}
        >
          <span className="sidebar-user-avatar" aria-hidden="true">{initial}</span>
          <span className="sidebar-user-info">
            <strong>{displayName}</strong>
            {roleName && <small>{roleName}</small>}
          </span>
        </button>
        <button type="button" className="sidebar-logout" onClick={onLogout} title="Cerrar sesión">
          Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
