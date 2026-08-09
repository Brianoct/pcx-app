// Modo sandbox (frontend): un flag en localStorage por navegador. Cuando está
// activo, apiClient marca cada petición con X-PCX-Sandbox y el backend enruta
// todo al schema de práctica. Entrar/salir recarga la app para que ninguna
// pantalla mezcle datos de los dos mundos.
import { normalizeRole } from './roleAccess';

const SANDBOX_KEY = 'pcx_sandbox';

// Debe reflejar SANDBOX_ALLOWED_ROLES del backend (lib/sandbox.js).
const SANDBOX_ROLES = ['admin'];

export const canUseSandbox = (role) => SANDBOX_ROLES.includes(normalizeRole(role || ''));

export const isSandboxActive = () => {
  try {
    return localStorage.getItem(SANDBOX_KEY) === '1';
  } catch {
    return false;
  }
};

export const setSandboxActive = (on) => {
  try {
    if (on) {
      localStorage.setItem(SANDBOX_KEY, '1');
    } else {
      localStorage.removeItem(SANDBOX_KEY);
    }
  } catch {
    return;
  }
  window.location.reload();
};
