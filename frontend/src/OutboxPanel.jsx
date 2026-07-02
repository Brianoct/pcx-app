import { useNavigate } from 'react-router-dom';
import { useOutbox } from './OutboxProvider';

// Where "Abrir registro" should land, by record type or API path fragment.
const TYPE_ROUTES = {
  inventory: '/inventory',
  timeoff: '/calendario'
};

const PATH_ROUTES = [
  ['/api/products/', '/inventory'],
  ['/api/time-off', '/calendario'],
  ['/api/qc/', '/admin'],
  ['/api/combos', '/combos'],
  ['/api/cupones', '/cupones'],
  ['/api/me', '/perfil'],
  ['/api/expenses', '/gastos'],
  ['/api/projects', '/proyectos'],
  ['/api/production/kanban', '/produccion-kanban']
];

function resolveOutboxRoute(item) {
  const type = String(item?.meta?.recordType || item?.last_error_type || '').toLowerCase();
  if (TYPE_ROUTES[type]) return TYPE_ROUTES[type];
  const path = String(item?.request?.path || '');
  const match = PATH_ROUTES.find(([fragment]) => path.includes(fragment));
  return match ? match[1] : '/history';
}

const statusLabel = (item) => {
  if (item.status === 'syncing') return 'Sincronizando';
  if (item.status === 'pending') return 'Pendiente';
  if (item.status === 'error' && item.retryable === false) return 'Error manual';
  if (item.status === 'error') return 'Error reintento';
  return 'Pendiente';
};

const formatDate = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
};

function OutboxPanel({ isOnline, authPaused }) {
  const {
    items,
    pendingCount,
    errorCount,
    processing,
    retryItem,
    retryItemWithLatest,
    cancelItem
  } = useOutbox();
  const navigate = useNavigate();

  const sortedItems = [...(Array.isArray(items) ? items : [])]
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .slice(0, 8);

  return (
    <aside className="outbox-panel" aria-live="polite">
      <div className="outbox-panel-header">
        <div>
          <h4 className="outbox-panel-title">Sincronización</h4>
          <div className="outbox-panel-meta">
            {pendingCount} pendientes · {errorCount} errores
          </div>
        </div>
      </div>
      {!isOnline && (
        <div className="outbox-panel-note offline">
          Sin conexión. Los cambios se guardan localmente cuando es posible.
        </div>
      )}
      {authPaused && (
        <div className="outbox-panel-note warning">
          La sincronización está en pausa por sesión expirada. Cierra sesión y vuelve a iniciar para continuar.
        </div>
      )}
      <div className="outbox-panel-list">
        {sortedItems.length === 0 && (
          <div className="outbox-item-detail">Sin acciones en cola.</div>
        )}
        {sortedItems.map((item) => (
          <div key={item.id} className="outbox-item">
            <div className="outbox-item-head">
              <div className="outbox-item-label">
                {item.meta?.label || `${item.request?.method || 'POST'} ${item.request?.path || ''}`}
              </div>
              <span className={`outbox-item-status ${item.status === 'syncing' ? 'syncing' : item.status === 'error' ? 'error' : 'pending'}`}>
                {statusLabel(item)}
              </span>
            </div>
            <div className="outbox-item-detail">
              Creado: {formatDate(item.created_at)} · Intentos: {Number(item.attempts || 0)}
            </div>
            {item.status === 'error' && item.retryable === false && (
              <div className="outbox-item-conflict">
                {item.user_message || 'Accion requiere revision manual.'}
              </div>
            )}
            {item.status === 'error' && item.last_error && (
              <div className="outbox-item-error">Detalle: {item.last_error}</div>
            )}
            {item.status === 'error' && item.retryable === false && (
              <div className="outbox-item-guidance">
                Sugerencia: {item.recommended_action || 'Revisa el registro y vuelve a intentar con datos actuales.'}
              </div>
            )}
            <div className="outbox-item-actions">
              <button
                type="button"
                className="outbox-item-btn retry"
                onClick={() => retryItem(item.id)}
                disabled={processing || item.status === 'syncing'}
              >
                Reintentar
              </button>
              {item.status === 'error' && item.retryable === false && (
                <>
                  <button
                    type="button"
                    className="outbox-item-btn open"
                    onClick={() => navigate(resolveOutboxRoute(item))}
                    disabled={processing || item.status === 'syncing'}
                  >
                    Abrir registro
                  </button>
                  <button
                    type="button"
                    className="outbox-item-btn latest"
                    onClick={() => retryItemWithLatest(item.id)}
                    disabled={processing || item.status === 'syncing'}
                  >
                    Reintentar con datos actuales
                  </button>
                </>
              )}
              <button
                type="button"
                className="outbox-item-btn cancel"
                onClick={() => cancelItem(item.id)}
                disabled={processing || item.status === 'syncing'}
              >
                Cancelar
              </button>
            </div>
          </div>
        ))}
        {items.length > sortedItems.length && (
          <div className="outbox-item-detail">
            +{items.length - sortedItems.length} acciones mas en cola
          </div>
        )}
      </div>
    </aside>
  );
}

export default OutboxPanel;
