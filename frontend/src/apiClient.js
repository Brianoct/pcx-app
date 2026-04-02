export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_GET_RETRIES = 2;
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseResponseBody = async (res) => {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await res.text();
    return text || null;
  } catch {
    return null;
  }
};

const toErrorMessage = (payload, fallback) => {
  if (payload && typeof payload === 'object') {
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  }
  if (typeof payload === 'string' && payload.trim()) return payload;
  return fallback;
};

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    token,
    body,
    headers = {},
    retries,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  const methodUpper = String(method || 'GET').toUpperCase();
  const url = String(path || '').startsWith('http') ? path : `${API_BASE}${path}`;
  const maxRetries = Number.isInteger(retries)
    ? Math.max(0, retries)
    : (RETRYABLE_METHODS.has(methodUpper) ? DEFAULT_GET_RETRIES : 0);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const requestHeaders = { ...headers };
      const init = {
        method: methodUpper,
        headers: requestHeaders,
        signal: controller.signal
      };

      if (token) {
        init.headers.Authorization = `Bearer ${token}`;
      }

      if (body !== undefined) {
        const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
        if (isFormData) {
          init.body = body;
        } else if (typeof body === 'string') {
          init.body = body;
          if (!init.headers['Content-Type'] && !init.headers['content-type']) {
            init.headers['Content-Type'] = 'application/json';
          }
        } else {
          init.body = JSON.stringify(body);
          if (!init.headers['Content-Type'] && !init.headers['content-type']) {
            init.headers['Content-Type'] = 'application/json';
          }
        }
      }

      const res = await fetch(url, init);
      const payload = await parseResponseBody(res);

      if (!res.ok) {
        const err = new Error(toErrorMessage(payload, `Error HTTP ${res.status}`));
        err.status = res.status;
        err.payload = payload;
        const canRetryStatus = (
          attempt < maxRetries
          && RETRYABLE_METHODS.has(methodUpper)
          && RETRYABLE_STATUS.has(res.status)
        );
        if (canRetryStatus) {
          await sleep(400 * (2 ** attempt));
          continue;
        }
        throw err;
      }

      return payload;
    } catch (err) {
      const isAbortError = err?.name === 'AbortError';
      if (isAbortError && timedOut) {
        const timeoutErr = new Error('La solicitud tardó demasiado. Revisa tu conexión.');
        timeoutErr.code = 'TIMEOUT';
        err = timeoutErr;
      }

      const hasHttpStatus = typeof err?.status === 'number';
      const canRetryNetwork = (
        attempt < maxRetries
        && RETRYABLE_METHODS.has(methodUpper)
        && !hasHttpStatus
      );

      if (canRetryNetwork) {
        await sleep(400 * (2 ** attempt));
        continue;
      }

      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('No se pudo completar la solicitud');
}
