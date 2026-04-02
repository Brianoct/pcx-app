import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const formatMoney = (value) => `${Number(value || 0).toFixed(2)} Bs`;

export default function MicrofabricaPanel({ token }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({
    qty_passed: 0,
    qty_rejected: 0,
    total_commission: 0,
    products_with_activity: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        month: String(month),
        year: String(year)
      });
      const data = await apiRequest(`/api/microfabrica/dashboard?${params.toString()}`, { token });
      const list = Array.isArray(data?.rows) ? data.rows : [];
      setRows(list);
      setTotals({
        qty_passed: Number(data?.totals?.qty_passed || 0),
        qty_rejected: Number(data?.totals?.qty_rejected || 0),
        total_commission: Number(data?.totals?.total_commission || 0),
        products_with_activity: Number(data?.totals?.products_with_activity || 0)
      });
    } catch (err) {
      setError(err.message || 'Error al cargar panel de microfábrica');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month, year]);

  const topProduct = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((best, row) => {
      const bestSubtotal = Number(best?.subtotal_commission || 0);
      const currentSubtotal = Number(row?.subtotal_commission || 0);
      return currentSubtotal > bestSubtotal ? row : best;
    }, rows[0]);
  }, [rows]);

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Panel de Microfábrica
      </h2>

      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', marginBottom: '6px' }}>Mes</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="filter-select">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(0, m - 1).toLocaleString('es-BO', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', marginBottom: '6px' }}>Año</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="filter-select">
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: '#ef4444', color: '#fecaca', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gap: '12px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          marginBottom: '16px'
        }}
      >
        <div className="card" style={{ marginBottom: 0, borderColor: 'rgba(16,185,129,0.45)' }}>
          <div style={{ color: '#94a3b8', marginBottom: '6px' }}>Comisión total del período</div>
          <div style={{ color: '#10b981', fontSize: '1.5rem', fontWeight: 800 }}>
            {formatMoney(totals.total_commission)}
          </div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ color: '#94a3b8', marginBottom: '6px' }}>Piezas aprobadas</div>
          <div style={{ color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700 }}>{totals.qty_passed}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ color: '#94a3b8', marginBottom: '6px' }}>Piezas rechazadas</div>
          <div style={{ color: '#f59e0b', fontSize: '1.4rem', fontWeight: 700 }}>{totals.qty_rejected}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ color: '#94a3b8', marginBottom: '6px' }}>Productos con actividad</div>
          <div style={{ color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700 }}>{totals.products_with_activity}</div>
        </div>
      </div>

      {topProduct && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ marginBottom: '8px' }}>Producto con mayor comisión</h3>
          <div style={{ color: '#cbd5e1' }}>
            <strong>{topProduct.product_name}</strong> ({topProduct.sku}) — Subtotal comisión: {' '}
            <strong style={{ color: '#10b981' }}>{formatMoney(topProduct.subtotal_commission)}</strong>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Comisión por producto ({month}/{year})</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando...</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>Sin productos para el período seleccionado.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '1080px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Aprobados</th>
                  <th>Rechazados</th>
                  <th>Base Bs</th>
                  <th>% comisión</th>
                  <th>Comisión por pieza</th>
                  <th>Subtotal comisión</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>{row.product_name}</td>
                    <td>{Number(row.qty_passed || 0)}</td>
                    <td>{Number(row.qty_rejected || 0)}</td>
                    <td>{formatMoney(row.base_price)}</td>
                    <td>{Number(row.commission_rate || 0).toFixed(2)}%</td>
                    <td>{formatMoney(row.commission_per_piece)}</td>
                    <td style={{ color: '#10b981', fontWeight: 700 }}>{formatMoney(row.subtotal_commission)}</td>
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
