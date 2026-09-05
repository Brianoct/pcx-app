import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { getDeviceId } from './deviceId';
import logo from './assets/logo.png';

// Arte del login (opcional): si existe frontend/src/assets/login-art.jpg
// (o .png/.webp), aparece como panel lateral; si no, el panel muestra un
// fondo cálido con el logo. Así el diseño no depende de que el archivo esté.
const loginArtModules = import.meta.glob('./assets/login-art.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default'
});
const loginArtUrl = Object.values(loginArtModules)[0] || null;

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const deviceId = getDeviceId();
      const data = await apiRequest('/api/login', {
        method: 'POST',
        body: { email, password },
        headers: deviceId ? { 'X-PCX-Device': deviceId } : {},
        retries: 0
      });
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-split">
        <div
          className={`login-art ${loginArtUrl ? '' : 'no-art'}`}
          style={loginArtUrl ? { backgroundImage: `url(${loginArtUrl})` } : undefined}
          aria-hidden="true"
        >
          {!loginArtUrl && <img src={logo} alt="" className="login-art-fallback-logo" />}
          <p className="login-art-caption">Hecho a mano. Hecho para durar.</p>
        </div>
        <div className="login-pane">
          <div className="login-card">
        <div className="login-brand">
          <img src={logo} alt="PCX" className="login-logo" />
          <p className="login-brand-sub">Panel del equipo</p>
        </div>
        {error && <p className="login-error">{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ejemplo@pcxind.com"
              required
              className="login-input"
            />
          </div>
          <div className="login-field">
            <label className="login-label">Contraseña</label>
            <div className="password-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="login-input"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>
          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? 'Ingresando…' : 'Iniciar Sesión'}
          </button>
        </form>
          </div>
        </div>
      </div>
      <Link to="/" className="login-back">← Volver a la página principal</Link>
    </div>
  );
}

export default Login;
