import { apiRequest } from './apiClient';

const OUTBOX_STORAGE_KEY = 'pcx.outbox.v1';
const OUTBOX_EVENT = 'pcx-outbox-updated';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

let isProcessingQueue = false;

const hasWindow = typeof window !== 'undefined';

const readOutbox = () => {
  if (!hasWindow) return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeOutbox = (items) => {
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore localStorage write errors in private mode.
  }
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { items } }));
  } catch {
    // Ignore event dispatch errors.
  }
};

const updateOutboxItem = (itemId, patch) => {
  const items = readOutbox();
  const next = items.map((item) => (
    item.id === itemId
      ? {
          ...item,
          ...patch,
          updated_at: Date.now()
        }
      : item
  ));
  writeOutbox(next);
};

const removeOutboxItem = (itemId) => {
  const items = readOutbox();
  const next = items.filter((item) => item.id !== itemId);
  writeOutbox(next);
};

export const getOutboxItems = () => readOutbox();

export const subscribeOutbox = (callback) => {
  if (!hasWindow || typeof callback !== 'function') return () => {};
  const handler = () => callback(readOutbox());
  window.addEventListener(OUTBOX_EVENT, handler);
  return () => window.removeEventListener(OUTBOX_EVENT, handler);
};

export const enqueueOutboxAction = ({ request, meta = {} }) => {
  const items = readOutbox();
  const id = (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const now = Date.now();
  const item = {
    id,
    created_at: now,
    updated_at: now,
    status: 'pending',
    attempts: 0,
    retryable: true,
    last_error: '',
    request: {
      path: request.path,
      method: request.method || 'POST',
      body: request.body ?? null,
      headers: request.headers || {},
      timeoutMs: Number(request.timeoutMs || 12000)
    },
    meta
  };
  writeOutbox([...items, item]);
  return item;
};

const canRetryOutboxError = (err) => {
  const status = Number(err?.status);
  if (!status) return true;
  return RETRYABLE_STATUS.has(status);
};

export const shouldQueueOutboxFromError = (err) => {
  const status = Number(err?.status);
  if (!status) return true;
  if (RETRYABLE_STATUS.has(status)) return true;
  if (err?.code === 'TIMEOUT') return true;
  return false;
};

export const processOutboxQueue = async (token) => {
  if (!token || isProcessingQueue) return;
  isProcessingQueue = true;
  try {
    const queue = readOutbox()
      .filter((item) => item?.request?.path)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));

    for (const item of queue) {
      const isPending = item.status === 'pending';
      const isRetryableError = item.status === 'error' && item.retryable !== false;
      if (!isPending && !isRetryableError) continue;

      updateOutboxItem(item.id, { status: 'syncing' });
      try {
        await apiRequest(item.request.path, {
          method: item.request.method,
          token,
          body: item.request.body,
          headers: item.request.headers || {},
          timeoutMs: item.request.timeoutMs || 12000,
          retries: 0
        });
        removeOutboxItem(item.id);
      } catch (err) {
        const retryable = canRetryOutboxError(err);
        updateOutboxItem(item.id, {
          status: retryable ? 'pending' : 'error',
          retryable,
          attempts: Number(item.attempts || 0) + 1,
          last_error: err?.message || 'Error de sincronización'
        });
      }
    }
  } finally {
    isProcessingQueue = false;
  }
};
