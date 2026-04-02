import { useEffect, useState } from 'react';

const hasWindow = typeof window !== 'undefined';

const safeRead = (key, fallbackValue) => {
  if (!hasWindow) return fallbackValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
};

export function useDraftState(key, fallbackValue) {
  const [state, setState] = useState(() => safeRead(key, fallbackValue));

  useEffect(() => {
    if (!hasWindow) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Storage quota or privacy mode; ignore and keep in-memory state.
    }
  }, [key, state]);

  return [state, setState];
}

export function clearDraftState(key) {
  if (!hasWindow) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore clear failures.
  }
}
