import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getNavLabel } from './navConfig';
import { SandboxToggle } from './SandboxControls';
import { useOutbox } from './OutboxProvider';
import { useOnlineStatus } from './useOnlineStatus';
import OutboxPanel from './OutboxPanel';

function SyncStatus() {
  const isOnline = useOnlineStatus();
  const { items, pendingCount, errorCount, authPaused } = useOutbox();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (errorCount > 0) {
      setOpen(true);
    }
  }, [errorCount]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (open && !event.target.closest('.sync-status')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const queuedCount = Array.isArray(items) ? items.length : 0;

  let chip = null;
  if (!isOnline) {
    chip = { className: 'offline', label: 'Sin conexión' };
  } else if (authPaused) {
    chip = { className: 'warning', label: 'Sesión expirada' };
  } else if (errorCount > 0) {
    chip = { className: 'error', label: `${errorCount} ${errorCount === 1 ? 'error' : 'errores'}` };
  } else if (pendingCount > 0) {
    chip = { className: 'pending', label: `Sincronizando ${pendingCount}` };
  } else if (queuedCount > 0) {
    chip = { className: 'pending', label: `${queuedCount} en cola` };
  }

  if (!chip) return null;

  return (
    <div className="sync-status">
      <button
        type="button"
        className={`sync-chip ${chip.className}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {chip.label}
      </button>
      {open && <OutboxPanel isOnline={isOnline} authPaused={authPaused} />}
    </div>
  );
}

function TopBar({ displayName, currentCommission, isTopSeller, onToggleSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();

  // En Inicio la barra saluda (como un escritorio); en el resto muestra la
  // sección activa para no perder el "¿dónde estoy?".
  const isHome = location.pathname === '/';
  const todayLabel = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-menu-btn"
        onClick={onToggleSidebar}
        aria-label="Mostrar u ocultar menú"
      >
        ☰
      </button>
      {isHome ? (
        <div className="topbar-greet">
          <h1 className="topbar-title">Hola, {displayName}</h1>
          <span className="topbar-greet-sub">{todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}</span>
        </div>
      ) : (
        <h1 className="topbar-title">{getNavLabel(location.pathname)}</h1>
      )}
      <div className="topbar-right">
        <SandboxToggle />
        <SyncStatus />
        <button
          type="button"
          className={`commission-chip ${isTopSeller ? 'is-top' : ''}`}
          onClick={() => navigate('/')}
          title={isTopSeller ? 'Vendedor top del mes — ver rendimiento' : 'Tu comisión del mes — ver rendimiento'}
        >
          {isTopSeller && <span className="commission-chip-star" aria-hidden="true">★</span>}
          {isTopSeller && <span className="commission-chip-label">Top vendedor</span>}
          +{(currentCommission || 0).toFixed(2)} Bs
        </button>
      </div>
    </header>
  );
}

export default TopBar;
