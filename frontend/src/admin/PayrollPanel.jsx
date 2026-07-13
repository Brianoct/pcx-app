import { useEffect, useMemo, useState } from 'react';
import { API_BASE, apiRequest } from '../apiClient';

const assetUrl = (path) => {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http') || raw.startsWith('data:')) return raw;
  return `${String(API_BASE || '').replace(/\/+$/, '')}${raw}`;
};

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const money = (value) => `${Number(value || 0).toFixed(2)} Bs`;

// Admin month-end payment view: every active employee's payment QR + account
// details + their commission for the selected month, side by side — the
// payroll run becomes "look at the amount, scan the QR".
function PayrollPanel({ token }) {
  const [users, setUsers] = useState([]);
  const [commissions, setCommissions] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(null);
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [usersData, commissionsData] = await Promise.all([
          apiRequest('/api/users', { token }),
          apiRequest(`/api/admin/team-commissions?month=${period.month}&year=${period.year}`, { token }).catch(() => null)
        ]);
        if (!active) return;
        setUsers(Array.isArray(usersData) ? usersData : []);
        setCommissions(new Map(
          (commissionsData?.users || []).map((row) => [Number(row.user_id), row])
        ));
      } catch (err) {
        if (active) setError(err.message || 'No se pudieron cargar los usuarios');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, period.month, period.year]);

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
  const totalCommissions = rows.reduce((sum, u) => sum + Number(commissions.get(Number(u.id))?.commission || 0), 0);
  const monthLabel = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  const shiftPeriod = (delta) => {
    setPeriod((prev) => {
      const d = new Date(prev.year, prev.month - 1 + delta, 1);
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    });
  };

  if (loading) return <div className="card" style={{ color: '#78716c' }}>Cargando datos de pago…</div>;
  if (error) return <div className="card" style={{ borderColor: '#ef4444', color: '#b91c1c' }}>{error}</div>;

  return (
    <div className="card">
      <div className="payroll-head">
        <div>
          <h3 style={{ margin: 0 }}>Pagos del mes</h3>
          <p style={{ color: '#78716c', margin: '4px 0 0', fontSize: '0.86rem' }}>
            QR, datos de cuenta y comisión de cada empleado. {withQr}/{rows.length} con QR cargado.
          </p>
        </div>
        <div className="payroll-controls">
          <div className="payroll-period">
            <button type="button" className="payroll-period-btn" onClick={() => shiftPeriod(-1)} aria-label="Mes anterior">‹</button>
            <span className="payroll-period-label">{monthLabel}</span>
            <button type="button" className="payroll-period-btn" onClick={() => shiftPeriod(1)} aria-label="Mes siguiente">›</button>
          </div>
          <input
            className="filter-input"
            type="text"
            placeholder="Buscar empleado…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: '220px' }}
          />
        </div>
      </div>

      <div className="payroll-total">
        Comisiones de {monthLabel}: <strong>{money(totalCommissions)}</strong>
      </div>

      <div className="payroll-grid">
        {rows.map((u) => {
          const qr = assetUrl(u.payment_qr_url);
          const comm = commissions.get(Number(u.id));
          return (
            <div key={u.id} className="payroll-card">
              <div className="payroll-card-head">
                <div className="payroll-avatar">
                  {u.avatar_url
                    ? <img src={assetUrl(u.avatar_url)} alt="" />
                    : <span>{String(u.display_name || u.email || '?').slice(0, 1).toUpperCase()}</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="payroll-name">
                    {u.display_name || u.email}
                    {comm?.is_top_seller && <span className="payroll-top-badge" title="Mejor en ventas del mes">★</span>}
                  </div>
                  <div className="payroll-role">{u.role}</div>
                </div>
              </div>

              <div className="payroll-commission" title={comm?.source || ''}>
                <span className="payroll-commission-label">Comisión {MONTH_NAMES[period.month - 1]}</span>
                <span className="payroll-commission-amount">{money(comm?.commission)}</span>
                {comm?.source && <span className="payroll-commission-source">{comm.source}</span>}
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
            <div className="payroll-zoom-amount">
              Comisión {monthLabel}: <strong>{money(commissions.get(Number(zoom.id))?.commission)}</strong>
            </div>
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
