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

const processOutboxItem = async (item, token) => {
  if (!item?.id || !item?.request?.path || !token) return false;
  const isPending = item.status === 'pending';
  const isRetryableError = item.status === 'error' && item.retryable !== false;
  if (!isPending && !isRetryableError) return false;

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
    const details = classifyOutboxError(err);
    updateOutboxItem(item.id, {
      status: details.retryable ? 'pending' : 'error',
      retryable: details.retryable,
      attempts: Number(item.attempts || 0) + 1,
      last_error: err?.message || 'Error de sincronizacion',
      last_error_type: details.type,
      last_error_status: Number(err?.status || 0) || null,
      user_message: details.retryable ? '' : details.userMessage
    });
  }
  return true;
};

const classifyOutboxError = (err) => {
  const status = Number(err?.status || 0);
  if (!status) {
    if (err?.code === 'TIMEOUT') {
      return {
        retryable: true,
        type: 'timeout',
        userMessage: 'La sincronizacion tardo demasiado. Se reintentara automaticamente.'
      };
    }
    return {
      retryable: true,
      type: 'network',
      userMessage: 'Sin conexion temporal. Se reintentara automaticamente.'
    };
  }

  if (RETRYABLE_STATUS.has(status)) {
    return {
      retryable: true,
      type: 'server',
      userMessage: 'Error temporal del servidor. Se reintentara automaticamente.'
    };
  }

  if (status === 409) {
    return {
      retryable: false,
      type: 'conflict',
      userMessage: 'Conflicto detectado: este registro cambio en otro lugar. Revisa el dato y actualiza manualmente.'
    };
  }

  if (status === 401 || status === 403) {
    return {
      retryable: false,
      type: 'auth',
      userMessage: 'Tu sesion no tiene permisos para sincronizar esta accion. Vuelve a iniciar sesion.'
    };
  }

  if (status === 404) {
    return {
      retryable: false,
      type: 'not_found',
      userMessage: 'El registro ya no existe en el servidor. Esta accion se puede cancelar.'
    };
  }

  if (status === 400 || status === 422) {
    return {
      retryable: false,
      type: 'validation',
      userMessage: 'La accion tiene datos invalidos para el servidor. Corrige y vuelve a intentar.'
    };
  }

  return {
    retryable: false,
    type: 'request',
    userMessage: 'No se pudo sincronizar automaticamente esta accion. Revisa el detalle y gestiona manualmente.'
  };
};

export const getOutboxItems = () => readOutbox();

export const cancelOutboxItem = (itemId) => {
  const items = readOutbox();
  const exists = items.some((item) => item.id === itemId);
  if (!exists) return false;
  removeOutboxItem(itemId);
  return true;
};

export const retryOutboxItem = (itemId) => {
  const items = readOutbox();
  let found = false;
  const next = items.map((item) => {
    if (item.id !== itemId) return item;
    found = true;
    return {
      ...item,
      status: 'pending',
      retryable: true,
      updated_at: Date.now()
    };
  });
  if (found) {
    writeOutbox(next);
  }
  return found;
};

export const retryOutboxItemWithLatest = (itemId) => {
  const items = readOutbox();
  let found = false;
  const next = items.map((item) => {
    if (item.id !== itemId) return item;
    found = true;
    return {
      ...item,
      status: 'pending',
      retryable: true,
      last_error: '',
      last_error_type: '',
      last_error_status: null,
      user_message: '',
      request: {
        ...(item.request || {}),
        body: item?.meta?.latest_body ?? item?.request?.body ?? null,
        headers: item?.meta?.latest_headers ?? item?.request?.headers ?? {}
      },
      updated_at: Date.now()
    };
  });
  if (found) {
    writeOutbox(next);
  }
  return found;
};

export const processOutboxItemById = async (itemId, token) => {
  if (!itemId || !token) return false;
  const items = readOutbox();
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return false;
  return processOutboxItem(item, token);
};

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
    meta: {
      ...meta,
      latest_body: (meta && Object.prototype.hasOwnProperty.call(meta, 'latest_body'))
        ? meta.latest_body
        : (request.body ?? null),
      latest_headers: (meta && Object.prototype.hasOwnProperty.call(meta, 'latest_headers'))
        ? meta.latest_headers
        : (request.headers || {})
    }
  };
  writeOutbox([...items, item]);
  return item;
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
      await processOutboxItem(item, token);
    }
  } finally {
    isProcessingQueue = false;
  }
};
