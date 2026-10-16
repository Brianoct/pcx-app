import { Suspense, lazy, useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import Login from './Login';
import AppShell from './AppShell';
import { RouteErrorBoundary } from './ui/ErrorBoundary';
import { NAV_ITEMS, allowsAny, getDefaultPath } from './navConfig';
import { useAuth } from './authContext';
import { useCommission } from './useCommission';
import { useToast } from './ui/toastContext';
import './index.css';
import PublicPixels from './publicPixels';

const PublicCustomerMenu = lazy(() => import('./PublicCustomerMenu'));
const ComprasScan = lazy(() => import('./ComprasScan'));
const LandingPage = lazy(() => import('./LandingPage'));
const ContactPage = lazy(() => import('./ContactPage'));
const CareersPage = lazy(() => import('./CareersPage'));
const CatalogosPage = lazy(() => import('./CatalogosPage'));

const routeFallback = <div className="route-loading" aria-label="Cargando">Cargando…</div>;

// Una ruta sin permiso vuelve al Inicio, pero avisa: antes el salto era
// silencioso y parecía que el enlace no funcionaba.
let lastDeniedToastAt = 0;
function Protected({ access, anyOf, defaultPath, children }) {
  const allowed = allowsAny(access, anyOf);
  const toast = useToast();
  useEffect(() => {
    if (allowed) return;
    // Un solo aviso aunque el efecto corra dos veces (StrictMode) o la ruta
    // se reintente enseguida.
    const now = Date.now();
    if (now - lastDeniedToastAt < 1500) return;
    lastDeniedToastAt = now;
    toast.info('No tienes acceso a esa sección');
  }, [allowed, toast]);
  return allowed ? children : <Navigate to={defaultPath} replace />;
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

  // Paneles por área activados desde Admin: definen qué Inicio ve cada área
  // y qué entradas extra aparecen en el menú (ej: Clientes/CRM).
  const [features, setFeatures] = useState({});

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    apiRequest('/api/features', { token })
      .then((data) => { if (active) setFeatures(data?.features || {}); })
      .catch(() => { if (active) setFeatures({}); });
    return () => { active = false; };
  }, [token]);

  const handleLogout = () => {
    resetCommission();
    logout();
  };

  if (!token) {
    return (
      <Router>
        {/* Píxeles de TikTok y Meta: solo aquí, en las páginas públicas. */}
        <PublicPixels />
        <Suspense fallback={routeFallback}>
          <Routes>
            <Route path="/catalogo/:shareToken" element={<PublicCustomerMenu />} />
            <Route path="/menu/:shareToken" element={<PublicCustomerMenu />} />
            <Route path="/contacto" element={<ContactPage />} />
            <Route path="/carreras" element={<CareersPage />} />
            <Route path="/catalogos" element={<CatalogosPage />} />
            {/* Visitors land on the splash page; the team enters via the
                discreet "Ingresar" link (or any deep link, which still shows
                the login directly). */}
            <Route path="/" element={<LandingPage />} />
            <Route path="*" element={<Login onLogin={login} />} />
          </Routes>
        </Suspense>
      </Router>
    );
  }

  const defaultPath = getDefaultPath(effectiveAccess);
  const renderCtx = {
    token,
    user,
    role,
    access: effectiveAccess,
    features,
    onQuoteStatusChanged: refreshCommission,
    onUserUpdated: updateUser
  };

  return (
    <Router>
      <AppShell
        access={effectiveAccess}
        displayName={displayName}
        roleName={role}
        features={features}
        currentCommission={commission}
        isTopSeller={isTopSeller}
        onLogout={handleLogout}
      >
        <RouteErrorBoundary>
          <Suspense fallback={routeFallback}>
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
              <Route path="/comprar/scan/:token" element={<ComprasScan token={token} />} />
              <Route path="/catalogo/:shareToken" element={<PublicCustomerMenu />} />
              <Route path="/menu/:shareToken" element={<PublicCustomerMenu />} />
              <Route path="/contacto" element={<ContactPage />} />
              <Route path="/carreras" element={<CareersPage />} />
              <Route path="/catalogos" element={<CatalogosPage />} />
              <Route path="*" element={<Navigate to={defaultPath} replace />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </AppShell>
    </Router>
  );
}

export default App;
