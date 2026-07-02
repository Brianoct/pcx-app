import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../apiClient';

// Compact QC records viewer + correction tool for admins. Quality control is
// now recorded from the production board (embalado step); this panel exists only
// so a mistaken count can be fixed or removed without touching the database.
function QualityControlRecordsAdmin({ token }) {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');

  const loadRecords = async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      const data = await apiRequest(`/api/qc/checks?${params.toString()}`, { token });
      setRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month, year]);

  const updateQuantity = async (record, nextQuantity) => {
    const quantity = Number.parseInt(nextQuantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    setBusyId(record.id);
    setMessage('');
    try {
      await apiRequest(`/api/qc/checks/${record.id}`, {
        method: 'PATCH',
        token,
        body: { quantity }
      });
      setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, quantity } : r)));
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleResult = async (record) => {
    const result = record.result === 'passed' ? 'rejected' : 'passed';
    setBusyId(record.id);
    setMessage('');
    try {
      await apiRequest(`/api/qc/checks/${record.id}`, {
        method: 'PATCH',
        token,
        body: { result }
      });
      setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, result } : r)));
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteRecord = async (record) => {
    if (!window.confirm('¿Eliminar este registro de control de calidad? No se puede deshacer.')) return;
    setBusyId(record.id);
    setMessage('');
    try {
      await apiRequest(`/api/qc/checks/${record.id}`, { method: 'DELETE', token });
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: '6px' }}>Control de calidad — registros</h3>
      <p style={{ color: '#78716c', marginBottom: '14px' }}>
        Los registros se crean desde el tablero de Producción (etapa embalado). Aquí puedes corregir o eliminar un registro con error.
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="filter-select">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{new Date(0, m - 1).toLocaleString('es-BO', { month: 'long' })}</option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="filter-select">
          {[2024, 2025, 2026, 2027, 2028].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {message && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(254,226,226,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #047857',
          color: message.startsWith('Error') ? '#b91c1c' : '#047857'
        }}>
          {message}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#78716c' }}>Cargando registros...</p>
      ) : records.length === 0 ? (
        <p style={{ color: '#78716c' }}>Sin registros para el período seleccionado.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: '820px' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>SKU</th>
                <th>Producto</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th>Resultado</th>
                <th>Registrado por</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleDateString('es-BO')}</td>
                  <td>{row.sku}</td>
                  <td>{row.product_name}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      min="1"
                      defaultValue={Number(row.quantity || 0)}
                      disabled={busyId === row.id}
                      onBlur={(e) => {
                        const v = Number.parseInt(e.target.value, 10);
                        if (v !== Number(row.quantity)) updateQuantity(row, e.target.value);
                      }}
                      style={{
                        width: '84px',
                        padding: '6px 8px',
                        borderRadius: '8px',
                        border: '1px solid #e7e0d8',
                        background: '#ffffff',
                        color: '#292524',
                        textAlign: 'right'
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ minHeight: '34px', padding: '6px 12px', color: row.result === 'passed' ? '#047857' : '#b45309', fontWeight: 700 }}
                      disabled={busyId === row.id}
                      onClick={() => toggleResult(row)}
                      title="Clic para cambiar resultado"
                    >
                      {row.result === 'passed' ? 'Aprobado' : 'Rechazado'}
                    </button>
                  </td>
                  <td>{row.user_email || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ minHeight: '34px', padding: '6px 12px' }}
                      disabled={busyId === row.id}
                      onClick={() => deleteRecord(row)}
                    >
                      Eliminar
                    </button>
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

export default QualityControlRecordsAdmin;
