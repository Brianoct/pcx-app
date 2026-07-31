import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

function AppShell({ access, displayName, currentCommission, isTopSeller, onLogout, children }) {
  // The navigation is intentionally off-canvas at every viewport width. This
  // keeps operational screens wide while preserving the complete role-aware menu.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <div className={`app-shell focus-shell ${drawerOpen ? 'drawer-open' : ''}`}>
      {drawerOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Cerrar menú"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <Sidebar
        access={access}
        displayName={displayName}
        open={drawerOpen}
        onLogout={onLogout}
        onNavigate={() => setDrawerOpen(false)}
        onClose={() => setDrawerOpen(false)}
      />
      <div className="shell-main">
        <TopBar
          currentCommission={currentCommission}
          isTopSeller={isTopSeller}
          onToggleSidebar={() => setDrawerOpen((prev) => !prev)}
        />
        <main className="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppShell;
