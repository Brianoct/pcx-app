import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const REQUEST_TYPE_LABELS = {
  vacation: 'Vacaciones',
  sick_leave: 'Baja médica',
  early_leave: 'Salida anticipada',
  other: 'Otro permiso'
};

const STATUS_COLORS = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444'
};

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-BO');
};

export default function TimeOffCalendar({ token }) {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState({ year: new Date().getFullYear(), vacation_used: 0, sick_used: 0, vacation_remaining: 14, sick_remaining: 5 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    request_type: 'vacation',
    start_date: '',
    end_date: '',
    notes: ''
  });

  const canSubmit = useMemo(() => {
    return Boolean(form.request_type && form.start_date && form.end_date && form.start_date <= form.end_date);
  }, [form]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [entriesRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/time-off/mine`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/time-off/mine/summary`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (!entriesRes.ok) {
        const err = await entriesRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron cargar tus permisos');
      }
      if (!summaryRes.ok) {
        const err = await summaryRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo cargar el resumen de cupos');
      }
      const [entriesData, summaryData] = await Promise.all([entriesRes.json(), summaryRes.json()]);
      setEntries(Array.isArray(entriesData) ? entriesData : []);
      setSummary(summaryData || summary);
    } catch (err) {
      setError(err.message || 'Error al cargar permisos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/time-off`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(form)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo registrar el permiso');
      }
      setForm({
        request_type: 'vacation',
        start_date: '',
        end_date: '',
        notes: ''
      });
      await loadData();
    } catch (err) {
      setError(err.message || 'Error al registrar permiso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>Calendario de permisos</h2>

      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ marginBottom: '10px' }}>Cupos anuales ({summary.year})</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '10px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Vacaciones usadas</div>
            <div style={{ fontWeight: 700, color: '#f1f5f9' }}>{summary.vacation_used} / 14 días</div>
          </div>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '10px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Vacaciones disponibles</div>
            <div style={{ fontWeight: 700, color: '#10b981' }}>{summary.vacation_remaining} días</div>
          </div>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '10px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Baja médica usada</div>
            <div style={{ fontWeight: 700, color: '#f1f5f9' }}>{summary.sick_used} / 5 días</div>
          </div>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '10px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Baja médica disponible</div>
            <div style={{ fontWeight: 700, color: '#10b981' }}>{summary.sick_remaining} días</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ marginBottom: '10px' }}>Registrar permiso</h3>
        <form onSubmit={submitRequest} style={{ display: 'grid', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            <select
              value={form.request_type}
              onChange={(e) => setForm((prev) => ({ ...prev, request_type: e.target.value }))}
              className="filter-select"
            >
              <option value="vacation">Vacaciones</option>
              <option value="sick_leave">Baja médica</option>
              <option value="early_leave">Salida anticipada</option>
              <option value="other">Otro permiso</option>
            </select>
            <input
              type="date"
              className="filter-input"
              value={form.start_date}
              onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
            />
            <input
              type="date"
              className="filter-input"
              value={form.end_date}
              onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
            />
          </div>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Detalle o motivo (opcional)"
            rows={3}
            style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          />
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || saving}>
            {saving ? 'Guardando...' : 'Registrar permiso'}
          </button>
        </form>
      </div>

      {error && (
        <div className="card" style={{ color: '#fecaca', borderColor: '#ef4444' }}>
          {error}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Mis solicitudes</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>Aún no registraste permisos.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '760px' }}>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                  <th>Días</th>
                  <th>Estado</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id}>
                    <td>{REQUEST_TYPE_LABELS[row.request_type] || row.request_type}</td>
                    <td>{formatDate(row.start_date)}</td>
                    <td>{formatDate(row.end_date)}</td>
                    <td>{row.days_count}</td>
                    <td style={{ color: STATUS_COLORS[row.status] || '#cbd5e1', fontWeight: 700 }}>
                      {row.status === 'pending' ? 'Pendiente' : row.status === 'approved' ? 'Aprobado' : 'Rechazado'}
                    </td>
                    <td>{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
