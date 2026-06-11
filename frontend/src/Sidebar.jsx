import { NavLink, useNavigate } from 'react-router-dom';
import logo from './assets/PCX.png';
import { getSidebarSections } from './navConfig';

function Sidebar({ access, displayName, onLogout, onNavigate }) {
  const sections = getSidebarSections(access);
  const navigate = useNavigate();

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
          onClick={() => {
            onNavigate?.();
            navigate('/perfil');
          }}
        >
          {displayName}
        </button>
        <button type="button" className="sidebar-logout" onClick={onLogout}>
          Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
