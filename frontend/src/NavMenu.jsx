import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import logo from './assets/PCX.png';
import { canAccessPanel } from './roleAccess';
import { getFlatNavItems, getAdminNavSections } from './navConfig';

const MAX_DESKTOP_VISIBLE = 7;

function NavMenu({ displayName, handleLogout, currentCommission, isTopSeller, access }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktopOpenMenuKey, setDesktopOpenMenuKey] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  const isAdminUser = canAccessPanel(access, 'admin');
  const allNavItems = getFlatNavItems(access);
  const adminMenuSections = isAdminUser ? getAdminNavSections(access) : [];
  const desktopPrimaryItems = allNavItems.slice(0, MAX_DESKTOP_VISIBLE);
  const desktopOverflowItems = allNavItems.slice(MAX_DESKTOP_VISIBLE);

  useEffect(() => {
    setMenuOpen(false);
    setDesktopOpenMenuKey('');
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuOpen && !event.target.closest('.nav-links.mobile') && !event.target.closest('.hamburger')) {
        setMenuOpen(false);
      }
      if (desktopOpenMenuKey && !event.target.closest('.desktop-menu')) {
        setDesktopOpenMenuKey('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen, desktopOpenMenuKey]);

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
            {isAdminUser ? (
              <div className="nav-links desktop">
                {adminMenuSections.map((section) => {
                  const sectionIsActive = section.items.some((item) => isNavItemActive(item));
                  return (
                    <div key={section.key} className="more-menu desktop-menu">
                      <button
                        type="button"
                        className={`more-menu-button ${sectionIsActive ? 'active' : ''}`}
                        onClick={() => setDesktopOpenMenuKey((prev) => (prev === section.key ? '' : section.key))}
                        aria-haspopup="menu"
                        aria-expanded={desktopOpenMenuKey === section.key}
                      >
                        {section.label} ▾
                      </button>
                      {desktopOpenMenuKey === section.key && (
                        <div className="more-menu-list" role="menu">
                          {section.items.map((item) => (
                            <Link
                              key={`${section.key}-${item.to}`}
                              to={item.to}
                              className={`more-menu-item ${isNavItemActive(item) ? 'active' : ''}`}
                              onClick={() => setDesktopOpenMenuKey('')}
                              role="menuitem"
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="nav-links desktop">
                  {desktopPrimaryItems.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`nav-link ${isNavItemActive(item) ? 'active' : ''}`}
                      onClick={() => setDesktopOpenMenuKey('')}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>

                {desktopOverflowItems.length > 0 && (
                  <div className="more-menu desktop-menu">
                    <button
                      type="button"
                      className={`more-menu-button ${desktopOverflowItems.some((item) => isNavItemActive(item)) ? 'active' : ''}`}
                      onClick={() => setDesktopOpenMenuKey((prev) => (prev === 'more' ? '' : 'more'))}
                      aria-haspopup="menu"
                      aria-expanded={desktopOpenMenuKey === 'more'}
                    >
                      Más ▾
                    </button>
                    {desktopOpenMenuKey === 'more' && (
                      <div className="more-menu-list" role="menu">
                        {desktopOverflowItems.map((item) => (
                          <Link
                            key={item.to}
                            to={item.to}
                            className={`more-menu-item ${isNavItemActive(item) ? 'active' : ''}`}
                            onClick={() => setDesktopOpenMenuKey('')}
                            role="menuitem"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
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
        {isAdminUser ? (
          <>
            {adminMenuSections.map((section) => (
              <div key={`mobile-${section.key}`} className="mobile-menu-group">
                <div className="mobile-menu-group-title">{section.label}</div>
                {section.items.map((item) => (
                  <Link
                    key={`mobile-${section.key}-${item.to}`}
                    to={item.to}
                    className={`nav-link ${isNavItemActive(item) ? 'active' : ''}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </>
        ) : (
          <>
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
          </>
        )}

        <div className="mobile-user-panel">
          <button onClick={handleLogout} className="mobile-logout-btn">
            Cerrar Sesión
          </button>
        </div>
      </div>
    </>
  );
}

export default NavMenu;
