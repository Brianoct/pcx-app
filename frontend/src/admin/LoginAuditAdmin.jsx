import { useEffect, useState } from 'react';
import { apiRequest } from '../apiClient';

// Auditoría de accesos: quién entró, cuándo, desde qué dispositivo y desde qué
// IP. La alerta principal es "dispositivo compartido": un mismo teléfono que
// inicia sesión en 2+ cuentas — la señal típica de que alguien vende con la
// cuenta de un compañero.
const shortDeviceId = (deviceId) => (deviceId ? deviceId.slice(0, 8) : '—');

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-BO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
};

const flagChipStyle = (background, color) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 700,
  background,
  color,
  whiteSpace: 'nowrap'
});

function LoginAuditAdmin({ token }) {
  const [days, setDays] = useState(30);
  const [userFilter, setUserFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ days: String(days) });
        if (userFilter) params.set('user_id', userFilter);
        const res = await apiRequest(`/api/admin/login-history?${params.toString()}`, { token });
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadHistory();
    return () => { active = false; };
  }, [token, days, userFilter]);

  const sharedDevices = data?.shared_devices || [];
  const logins = data?.logins || [];

  return (
    <div className="card">
      <h3 style={{ marginBottom: '6px' }}>Accesos — historial de inicios de sesión</h3>
      <p style={{ color: '#78716c', fontSize: '13px', marginBottom: '14px' }}>
        Cada inicio de sesión registra el dispositivo, la IP y un identificador único por
        teléfono/navegador. Si un mismo dispositivo entra a varias cuentas, aparece la alerta
        «Compartido».
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="filter-select">
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="filter-select">
          <option value="">Todos los usuarios</option>
          {(data?.users || []).map((u) => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
        {data && (
          <span style={{ alignSelf: 'center', color: '#78716c', fontSize: '13px' }}>
            {logins.length} accesos · {data.failed_attempts} intentos fallidos
          </span>
        )}
      </div>

      {error && (
        <div style={{
          marginBottom: '12px', padding: '10px 12px', borderRadius: '8px',
          background: 'rgba(254,226,226,0.35)', border: '1px solid #ef4444', color: '#b91c1c'
        }}>
          Error: {error}
        </div>
      )}

      {sharedDevices.length > 0 && (
        <div style={{
          marginBottom: '16px', padding: '12px 14px', borderRadius: '10px',
          background: 'rgba(254,226,226,0.45)', border: '1px solid #ef4444'
        }}>
          <strong style={{ color: '#b91c1c', display: 'block', marginBottom: '6px' }}>
            Dispositivos usados por más de una cuenta
          </strong>
          {sharedDevices.map((device) => (
            <div key={device.device_id} style={{ fontSize: '13px', color: '#7f1d1d', marginBottom: '4px' }}>
              <strong>{device.device_label || 'Dispositivo'}</strong>
              {' '}(id {shortDeviceId(device.device_id)}) entró a:{' '}
              <strong>{device.emails.join(', ')}</strong>
              {' '}· {device.login_count} accesos · último {formatDateTime(device.last_seen)}
            </div>
          ))}
        </div>
      )}
      {!loading && sharedDevices.length === 0 && !error && (
        <div style={{
          marginBottom: '16px', padding: '10px 12px', borderRadius: '10px',
          background: 'rgba(220,252,231,0.5)', border: '1px solid #16a34a',
          color: '#166534', fontSize: '13px'
        }}>
          Sin alertas: ningún dispositivo entró a más de una cuenta en el período.
        </div>
      )}

      {loading ? (
        <p style={{ color: '#78716c' }}>Cargando accesos...</p>
      ) : logins.length === 0 ? (
        <p style={{ color: '#78716c' }}>
          Sin accesos registrados en el período. El historial empieza a llenarse con los
          próximos inicios de sesión.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: '760px' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Dispositivo</th>
                <th>ID disp.</th>
                <th>IP</th>
                <th>Estado</th>
                <th>Alertas</th>
              </tr>
            </thead>
            <tbody>
              {logins.map((login) => (
                <tr key={login.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(login.created_at)}</td>
                  <td>
                    <strong>{login.display_name}</strong>
                    {login.role && (
                      <span style={{ color: '#78716c', fontSize: '12px' }}> · {login.role}</span>
                    )}
                  </td>
                  <td>{login.device_label || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{shortDeviceId(login.device_id)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{login.ip || '—'}</td>
                  <td>
                    {login.success ? (
                      <span style={flagChipStyle('rgba(220,252,231,0.8)', '#166534')}>OK</span>
                    ) : (
                      <span style={flagChipStyle('rgba(254,226,226,0.8)', '#b91c1c')}>Fallido</span>
                    )}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
                      {login.is_shared_device && (
                        <span style={flagChipStyle('#fee2e2', '#b91c1c')}>Compartido</span>
                      )}
                      {login.is_new_device && (
                        <span style={flagChipStyle('#fef3c7', '#92400e')}>Nuevo disp.</span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default LoginAuditAdmin;
