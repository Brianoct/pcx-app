// Identificador estable por navegador/teléfono, generado una sola vez y
// guardado en localStorage. Viaja en el header X-PCX-Device del login para que
// el admin pueda detectar cuando un mismo dispositivo usa varias cuentas.
const STORAGE_KEY = 'pcx_device_id';

const randomId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // continúa con el fallback
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const getDeviceId = () => {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // localStorage bloqueado (modo incógnito estricto): el login sigue sin id.
    return null;
  }
};
