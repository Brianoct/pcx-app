import { useCallback, useMemo, useRef, useState } from 'react';
import { ToastContext } from './toastContext';

const MAX_VISIBLE = 5;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, options = {}) => {
    const id = ++idRef.current;
    const duration = options.duration ?? (type === 'error' ? 6500 : 4200);
    setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, type, message }]);
    window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const toast = useMemo(() => ({
    success: (message, options) => push('success', message, options),
    error: (message, options) => push('error', message, options),
    info: (message, options) => push('info', message, options)
  }), [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            <span className="toast-message">{t.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
