import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import AppShell from './AppShell';
import PublicCustomerMenu from './PublicCustomerMenu';
import { NAV_ITEMS, allowsAny, getDefaultPath } from './navConfig';
import { useAuth } from './authContext';
import { useCommission } from './useCommission';
import './index.css';

function Protected({ access, anyOf, defaultPath, children }) {
  return allowsAny(access, anyOf) ? children : <Navigate to={defaultPath} replace />;
}

function App() {
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
      <AppShell
        access={effectiveAccess}
        displayName={displayName}
        currentCommission={commission}
        isTopSeller={isTopSeller}
        onLogout={handleLogout}
      >
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
      </AppShell>
    </Router>
  );
}

export default App;
