import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import NavMenu from './NavMenu';
import OutboxPanel from './OutboxPanel';
import PublicCustomerMenu from './PublicCustomerMenu';
import { NAV_ITEMS, allowsAny, getDefaultPath } from './navConfig';
import { useAuth } from './authContext';
import { useCommission } from './useCommission';
import { useOnlineStatus } from './useOnlineStatus';
import { useOutbox } from './OutboxProvider';
import './index.css';

function Protected({ access, anyOf, defaultPath, children }) {
  return allowsAny(access, anyOf) ? children : <Navigate to={defaultPath} replace />;
}

function App() {
  const isOnline = useOnlineStatus();
  const { pendingCount, authPaused } = useOutbox();
  const {
    token,
    user,
    role,
    effectiveAccess,
    displayName,
    login,
    logout,
    updateUser
  } = useAuth();
  const {
    commission,
    isTopSeller,
    refresh: refreshCommission,
    reset: resetCommission
  } = useCommission(token, user, role);

  const handleLogout = () => {
    resetCommission();
    logout();
  };

  if (!token) {
    return (
      <Router>
        <Routes>
          <Route path="/catalogo/:shareToken" element={<PublicCustomerMenu />} />
          <Route path="/menu/:shareToken" element={<PublicCustomerMenu />} />
          <Route path="*" element={<Login onLogin={login} />} />
        </Routes>
      </Router>
    );
  }

  const defaultPath = getDefaultPath(effectiveAccess);
  const renderCtx = {
    token,
    user,
    role,
    access: effectiveAccess,
    onQuoteStatusChanged: refreshCommission,
    onUserUpdated: updateUser
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
      {authPaused && (
        <div className="outbox-banner outbox-banner-warning" role="status" aria-live="polite">
          La sincronizacion esta en pausa por sesion expirada. Cierra sesion y vuelve a iniciar para continuar.
        </div>
      )}
      <OutboxPanel />
      <NavMenu
        displayName={displayName}
        handleLogout={handleLogout}
        currentCommission={commission}
        isTopSeller={isTopSeller}
        access={effectiveAccess}
      />

      <Routes>
        {NAV_ITEMS.map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={
              <Protected access={effectiveAccess} anyOf={item.routeAccess} defaultPath={defaultPath}>
                {item.render(renderCtx)}
              </Protected>
            }
          />
        ))}
        <Route path="/menu-clientes" element={<Navigate to="/catalogo-clientes" replace />} />
        <Route path="/catalogo/:shareToken" element={<PublicCustomerMenu />} />
        <Route path="/menu/:shareToken" element={<PublicCustomerMenu />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Router>
  );
}

export default App;
