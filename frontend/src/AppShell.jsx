import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const DESKTOP_QUERY = '(min-width: 1024px)';

function AppShell({ access, displayName, currentCommission, isTopSeller, onLogout, children }) {
  // Mobile: off-canvas drawer. Desktop: persistent, hideable for full-width work.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(
    () => localStorage.getItem('sidebar_hidden') === '1'
  );
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  const toggleSidebar = () => {
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      setSidebarHidden((prev) => {
        localStorage.setItem('sidebar_hidden', prev ? '0' : '1');
        return !prev;
      });
    } else {
      setDrawerOpen((prev) => !prev);
    }
  };

  return (
    <div className={`app-shell ${drawerOpen ? 'drawer-open' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        access={access}
        displayName={displayName}
        onLogout={onLogout}
        onNavigate={() => setDrawerOpen(false)}
      />
      <div className="shell-main">
        <TopBar
          displayName={displayName}
          currentCommission={currentCommission}
          isTopSeller={isTopSeller}
          onToggleSidebar={toggleSidebar}
        />
        <main className="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppShell;
