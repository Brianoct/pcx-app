import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  enqueueOutboxAction,
  getOutboxItems,
  processOutboxQueue,
  shouldQueueOutboxFromError,
  subscribeOutbox
} from './outbox';

const OutboxContext = createContext(null);

export function OutboxProvider({ children }) {
  const [items, setItems] = useState(() => getOutboxItems());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  const refresh = useCallback(() => {
    setItems(getOutboxItems());
  }, []);

  const enqueue = useCallback((action = {}) => {
    const path = action.path || action.endpoint;
    if (!path) return null;
    const method = action.method || 'POST';
    const body = action.body ?? action.payload ?? null;
    const headers = action.headers || {};
    const meta = {
      type: action.type || action.meta?.type || 'custom',
      label: action.label || action.meta?.label || action.type || 'Acción pendiente',
      ...(action.meta || {})
    };
    const item = enqueueOutboxAction({
      request: { path, method, body, headers, timeoutMs: action.timeoutMs || 12000 },
      meta
    });
    refresh();
    return item.id;
  }, [refresh]);

  const enqueueWrite = useCallback(({ label, path, options = {}, meta = {} }) => (
    enqueue({
      type: 'write',
      label: label || 'Acción pendiente',
      path,
      method: options.method || 'POST',
      body: options.body,
      headers: options.headers || {},
      timeoutMs: options.timeoutMs || 12000,
      meta
    })
  ), [enqueue]);

  const enqueueAction = useCallback((action = {}) => {
    if (action.type === 'quote_status_update') {
      const quoteId = Number(action?.payload?.quoteId || action?.meta?.quoteId || 0);
      const newStatus = String(action?.payload?.newStatus || action?.meta?.newStatus || '');
      if (!quoteId || !newStatus) return null;
      return enqueue({
        type: 'quote_status_update',
        label: `Estado cotización #${quoteId} → ${newStatus}`,
        path: `/api/quotes/${quoteId}/status`,
        method: 'PATCH',
        body: { status: newStatus },
        meta: { quoteId, newStatus }
      });
    }
    return enqueue(action);
  }, [enqueue]);

  const processOutbox = useCallback(async () => {
    if (processingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const pending = getOutboxItems().filter((item) =>
      item.status === 'pending' || (item.status === 'error' && item.retryable !== false)
    );
    if (pending.length === 0) return;

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;
    if (!token) return;

    processingRef.current = true;
    setProcessing(true);
    try {
      await processOutboxQueue(token);
      refresh();
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [processing, refresh]);

  useEffect(() => {
    const unsubscribe = subscribeOutbox((nextItems) => {
      setItems(Array.isArray(nextItems) ? nextItems : []);
    });

    const onOnline = () => {
      setIsOnline(true);
      processOutbox();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [processOutbox]);

  useEffect(() => {
    const onOnline = () => {
      processOutbox();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [processOutbox]);

  useEffect(() => {
    processOutbox();
    const interval = window.setInterval(processOutbox, 12000);
    return () => window.clearInterval(interval);
  }, [processOutbox]);

  const value = useMemo(() => ({
    items,
    isOnline,
    pendingCount: items.filter((item) => item.status === 'pending' || item.status === 'syncing').length,
    errorCount: items.filter((item) => item.status === 'error').length,
    processing,
    enqueue,
    enqueueAction,
    enqueueWrite,
    refresh,
    processOutbox,
    isWriteIntentError: shouldQueueOutboxFromError
  }), [items, isOnline, processing, enqueue, enqueueAction, enqueueWrite, refresh, processOutbox]);

  return (
    <OutboxContext.Provider value={value}>
      {children}
    </OutboxContext.Provider>
  );
}

export function useOutbox() {
  const ctx = useContext(OutboxContext);
  if (!ctx) {
    throw new Error('useOutbox must be used within OutboxProvider');
  }
  return ctx;
}

