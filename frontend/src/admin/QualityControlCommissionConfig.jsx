import { useState, useEffect } from 'react';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
function QualityControlCommissionConfig({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadRows = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/qc/commissions', { token });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [token]);

  const updateRate = (sku, value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
    setRows((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, commission_rate: safe } : row
    )));
  };

  const updateBasePrice = (sku, value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setRows((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, base_price: safe } : row
    )));
  };

  const saveRows = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: 'Guardar comisiones QC',
          path: '/api/qc/commissions',
          options: {
            method: 'PATCH',
            body: { rows },
            retries: 0
          },
          meta: { rowCount: rows.length }
        });
        setMessage('Sin conexión: comisiones QC en cola para sincronizar.');
      } else {
        await apiRequest('/api/qc/commissions', {
          method: 'PATCH',
          token,
          body: { rows }
        });
        setMessage('Comisiones por producto guardadas.');
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '30px' }}>Cargando comisiones por producto...</div>;

  return (
    <div className="card">
      <h3 style={{ marginBottom: '10px' }}>Control de calidad — comisión por producto</h3>
      <p style={{ color: '#78716c', marginBottom: '14px' }}>
        Define el % por producto para comisión de piezas aprobadas. Aplica a Admin, Almacén Lider, Microfabrica Lider y Microfabrica.
      </p>
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
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: '940px' }}>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th style={{ textAlign: 'right' }}>Base Bs</th>
              <th style={{ textAlign: 'right' }}>% comisión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.name || row.product_name}</td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={Number(row.base_price || 0)}
                    onChange={(e) => updateBasePrice(row.sku, e.target.value)}
                    style={{
                      width: '110px',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      border: '1px solid #e7e0d8',
                      background: '#ffffff',
                      color: '#292524',
                      textAlign: 'right'
                    }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={Number(row.commission_rate || 0)}
                    onChange={(e) => updateRate(row.sku, e.target.value)}
                    style={{
                      width: '110px',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      border: '1px solid #e7e0d8',
                      background: '#ffffff',
                      color: '#292524',
                      textAlign: 'right'
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '14px' }}>
        <button
          onClick={saveRows}
          disabled={saving}
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            background: '#3b82f6',
            color: 'white',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontWeight: 600
          }}
        >
          {saving ? 'Guardando...' : 'Guardar comisión por producto'}
        </button>
      </div>
    </div>
  );
}

export default QualityControlCommissionConfig;
