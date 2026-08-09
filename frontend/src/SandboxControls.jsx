import { useState } from 'react';
import { useAuth } from './authContext';
import { apiRequest } from './apiClient';
import { canUseSandbox, isSandboxActive, setSandboxActive } from './sandbox';

// Chip en la barra superior para entrar al modo sandbox (solo roles habilitados).
export function SandboxToggle() {
  const { role } = useAuth();
  if (!canUseSandbox(role) || isSandboxActive()) return null;
  return (
    <button
      type="button"
      className="sandbox-toggle"
      onClick={() => setSandboxActive(true)}
      title="Entrar al modo sandbox: practica con datos ficticios sin tocar el negocio real"
    >
      🧪 Sandbox
    </button>
  );
}

// Franja naranja permanente mientras el sandbox está activo, con reinicio y salida.
export function SandboxBanner() {
  const { token } = useAuth();
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  if (!isSandboxActive()) return null;

  const handleReset = async () => {
    if (!window.confirm('¿Reiniciar el sandbox? Se borra toda la práctica y vuelve al punto de partida.')) return;
    setResetting(true);
    setError('');
    try {
      // El reinicio reconstruye el schema completo; darle tiempo de sobra.
      await apiRequest('/api/sandbox/reset', { method: 'POST', token, timeoutMs: 180000 });
      window.location.reload();
    } catch (err) {
      setError(err?.message || 'No se pudo reiniciar el sandbox');
      setResetting(false);
    }
  };

  return (
    <div className="sandbox-banner" role="status">
      <span className="sandbox-banner-text">
        🧪 <strong>MODO SANDBOX</strong> — datos de práctica, nada de esto es real
      </span>
      {error && <span className="sandbox-banner-error">{error}</span>}
      <div className="sandbox-banner-actions">
        <button type="button" onClick={handleReset} disabled={resetting}>
          {resetting ? 'Reiniciando…' : 'Reiniciar sandbox'}
        </button>
        <button type="button" onClick={() => setSandboxActive(false)} disabled={resetting}>
          Salir del sandbox
        </button>
      </div>
    </div>
  );
}
