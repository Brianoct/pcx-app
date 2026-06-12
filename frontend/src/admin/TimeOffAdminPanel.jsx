import { useState, useEffect } from 'react';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
import { useToast } from '../ui/toastContext';
function TimeOffAdminPanel({ token }) {
  const toast = useToast();
  const { enqueueWrite } = useOutbox();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [requestsRes, summaryRes] = await Promise.all([
        apiRequest(`/api/time-off/requests?year=${year}`, { token }),
        apiRequest(`/api/time-off/summary?year=${year}`, { token })
      ]);
      setRows(Array.isArray(requestsRes) ? requestsRes : []);
      setSummary(Array.isArray(summaryRes) ? summaryRes : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, year]);

  const updateStatus = async (id, status) => {
    setUpdatingId(id);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Permiso #${id} -> ${status}`,
          path: `/api/time-off/requests/${id}/status`,
          options: {
            method: 'PATCH',
            body: { status },
            retries: 0
          },
          meta: { requestId: id, status }
        });
        setRows((prev) => prev.map((row) => (
          row.id === id ? { ...row, status, status_label: status } : row
        )));
        toast.info('Sin conexión: cambio de estado en cola para sincronizar.');
      } else {
        await apiRequest(`/api/time-off/requests/${id}/status`, {
          method: 'PATCH',
          token,
          body: { status }
        });
        await loadData();
      }
    } catch (err) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Calendario global de permisos</h3>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ minHeight: '40px', minWidth: '120px', borderRadius: '8px', border: '1px solid #e7e0d8', background: '#ffffff', color: '#292524', padding: '8px 10px' }}
          >
            {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <p style={{ marginTop: '8px', color: '#78716c' }}>
          Política anual: 14 días de vacaciones pagadas y 5 días de enfermedad pagados por usuario.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h4 style={{ marginBottom: '10px' }}>Resumen por usuario ({year})</h4>
        {loading ? (
          <p style={{ color: '#78716c' }}>Cargando resumen...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '860px' }}>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Vacaciones aprobadas</th>
                  <th>Restante vacaciones</th>
                  <th>Enfermedad aprobada</th>
                  <th>Restante enfermedad</th>
                  <th>Otros aprobados</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#78716c' }}>Sin datos</td></tr>
                ) : summary.map((row) => (
                  <tr key={row.user_id}>
                    <td>{row.email}</td>
                    <td>{Number(row.vacation_used || 0)}</td>
                    <td>{Math.max(0, Number(row.vacation_remaining || 0))}</td>
                    <td>{Number(row.sick_used || 0)}</td>
                    <td>{Math.max(0, Number(row.sick_remaining || 0))}</td>
                    <td>{Number(row.other_used || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h4 style={{ marginBottom: '10px' }}>Solicitudes ({year})</h4>
        {error && <div style={{ color: '#dc2626', marginBottom: '10px' }}>{error}</div>}
        {loading ? (
          <p style={{ color: '#78716c' }}>Cargando solicitudes...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '980px' }}>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Días</th>
                  <th>Estado</th>
                  <th>Notas</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: '#78716c' }}>No hay solicitudes</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.user_email}</td>
                    <td>{row.leave_type_label || row.leave_type}</td>
                    <td>{row.start_date}</td>
                    <td>{row.end_date}</td>
                    <td>{row.total_days}</td>
                    <td>{row.status_label || row.status}</td>
                    <td style={{ maxWidth: '240px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.notes || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          className="btn"
                          disabled={updatingId === row.id || row.status === 'approved'}
                          onClick={() => updateStatus(row.id, 'approved')}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#047857', color: 'white' }}
                        >
                          Aprobar
                        </button>
                        <button
                          className="btn"
                          disabled={updatingId === row.id || row.status === 'rejected'}
                          onClick={() => updateStatus(row.id, 'rejected')}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#ef4444', color: 'white' }}
                        >
                          Rechazar
                        </button>
                        <button
                          className="btn"
                          disabled={updatingId === row.id || row.status === 'pending'}
                          onClick={() => updateStatus(row.id, 'pending')}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#e7e0d8', color: 'white' }}
                        >
                          Pendiente
                        </button>
                      </div>
                    </td>
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

export default TimeOffAdminPanel;
