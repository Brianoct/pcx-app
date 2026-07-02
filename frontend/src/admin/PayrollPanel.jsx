import { useEffect, useMemo, useState } from 'react';
import { API_BASE, apiRequest } from '../apiClient';

const assetUrl = (path) => {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http') || raw.startsWith('data:')) return raw;
  return `${String(API_BASE || '').replace(/\/+$/, '')}${raw}`;
};

// Admin month-end payment view: every active employee's payment QR + account
// details in one place, so the payroll run doesn't require chasing people.
function PayrollPanel({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest('/api/users', { token });
        if (active) setUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        if (active) setError(err.message || 'No se pudieron cargar los usuarios');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((u) => u.is_active !== false)
      .filter((u) => {
        if (!term) return true;
        return String(u.display_name || '').toLowerCase().includes(term)
          || String(u.email || '').toLowerCase().includes(term)
          || String(u.role || '').toLowerCase().includes(term);
      })
      .sort((a, b) => String(a.display_name || a.email || '').localeCompare(String(b.display_name || b.email || ''), 'es'));
  }, [users, search]);

  const withQr = rows.filter((u) => u.payment_qr_url).length;

  if (loading) return <div className="card" style={{ color: '#78716c' }}>Cargando datos de pago…</div>;
  if (error) return <div className="card" style={{ borderColor: '#ef4444', color: '#b91c1c' }}>{error}</div>;

  return (
    <div className="card">
      <div className="payroll-head">
        <div>
          <h3 style={{ margin: 0 }}>Pagos del mes</h3>
          <p style={{ color: '#78716c', margin: '4px 0 0', fontSize: '0.86rem' }}>
            QR y datos de cuenta de cada empleado. {withQr}/{rows.length} con QR cargado.
          </p>
        </div>
        <input
          className="filter-input"
          type="text"
          placeholder="Buscar empleado…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '260px' }}
        />
      </div>

      <div className="payroll-grid">
        {rows.map((u) => {
          const qr = assetUrl(u.payment_qr_url);
          return (
            <div key={u.id} className="payroll-card">
              <div className="payroll-card-head">
                <div className="payroll-avatar">
                  {u.avatar_url
                    ? <img src={assetUrl(u.avatar_url)} alt="" />
                    : <span>{String(u.display_name || u.email || '?').slice(0, 1).toUpperCase()}</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="payroll-name">{u.display_name || u.email}</div>
                  <div className="payroll-role">{u.role}</div>
                </div>
              </div>

              {qr ? (
                <button type="button" className="payroll-qr-btn" onClick={() => setZoom({ ...u, qr })} title="Ampliar QR">
                  <img src={qr} alt={`QR de ${u.display_name || u.email}`} />
                </button>
              ) : (
                <div className="payroll-qr-missing">Sin QR de pago</div>
              )}

              {u.payment_info && <div className="payroll-info">{u.payment_info}</div>}
              <div className="payroll-meta">
                {u.national_id && <span>CI: {u.national_id}</span>}
                {u.phone && <span>Cel: {u.phone}</span>}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div style={{ color: '#78716c' }}>Sin empleados que coincidan.</div>}
      </div>

      {zoom && (
        <div className="payroll-zoom-overlay" onClick={() => setZoom(null)}>
          <div className="payroll-zoom" onClick={(e) => e.stopPropagation()}>
            <div className="payroll-zoom-name">{zoom.display_name || zoom.email}</div>
            <img src={zoom.qr} alt="QR de pago" />
            {zoom.payment_info && <div className="payroll-zoom-info">{zoom.payment_info}</div>}
            <button type="button" className="btn btn-secondary" onClick={() => setZoom(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PayrollPanel;
