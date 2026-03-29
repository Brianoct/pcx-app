import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const RESULT_OPTIONS = [
  { value: 'passed', label: 'Aprobado' },
  { value: 'rejected', label: 'Rechazado' }
];

const formatMoney = (value) => `${Number(value || 0).toFixed(2)} Bs`;

export default function QualityControlPanel({ token }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [products, setProducts] = useState([]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [totalCommission, setTotalCommission] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    sku: '',
    quantity: '',
    result: 'passed'
  });

  const selectedProduct = useMemo(
    () => products.find((p) => p.sku === form.sku) || null,
    [products, form.sku]
  );

  const canSubmit = Boolean(form.sku && Number.parseInt(form.quantity, 10) > 0 && form.result);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      const [productsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/qc/products`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/qc/summary?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (!productsRes.ok) {
        const err = await productsRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron cargar productos para control de calidad');
      }
      if (!summaryRes.ok) {
        const err = await summaryRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo cargar resumen mensual de control de calidad');
      }

      const productsData = await productsRes.json();
      const summaryData = await summaryRes.json();

      const sortedProducts = [...(Array.isArray(productsData) ? productsData : [])]
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'es', { sensitivity: 'base' }));
      setProducts(sortedProducts);
      setSummaryRows(Array.isArray(summaryData?.rows) ? summaryData.rows : []);
      setTotalCommission(Number(summaryData?.total_commission || 0));

      if (!form.sku && sortedProducts.length > 0) {
        setForm((prev) => ({ ...prev, sku: sortedProducts[0].sku }));
      } else if (form.sku && !sortedProducts.some((p) => p.sku === form.sku)) {
        setForm((prev) => ({ ...prev, sku: sortedProducts[0]?.sku || '' }));
      }
    } catch (err) {
      setError(err.message || 'Error al cargar control de calidad');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month, year]);

  const submitCheck = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/qc/checks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          sku: form.sku,
          quantity: Number.parseInt(form.quantity, 10),
          result: form.result
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo registrar control de calidad');
      }
      setForm((prev) => ({
        ...prev,
        quantity: '',
        result: 'passed'
      }));
      await loadData();
    } catch (err) {
      setError(err.message || 'Error al registrar control de calidad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Control de calidad
      </h2>

      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}>
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
          <div style={{ alignSelf: 'center', color: '#94a3b8' }}>
            Comisión mensual total: <strong style={{ color: '#10b981' }}>{formatMoney(totalCommission)}</strong>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ marginBottom: '10px' }}>Registrar revisión</h3>
        <form onSubmit={submitCheck} style={{ display: 'grid', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', marginBottom: '6px' }}>Producto</label>
              <select
                value={form.sku}
                onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                className="filter-select"
              >
                <option value="">Selecciona producto</option>
                {products.map((product) => (
                  <option key={product.sku} value={product.sku}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', marginBottom: '6px' }}>Cantidad</label>
              <input
                type="number"
                min="1"
                className="filter-input"
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                placeholder="Ej: 10"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', marginBottom: '6px' }}>Resultado</label>
              <select
                value={form.result}
                onChange={(e) => setForm((prev) => ({ ...prev, result: e.target.value }))}
                className="filter-select"
              >
                {RESULT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedProduct && (
            <div style={{ color: '#94a3b8' }}>
              Comisión por pieza aprobada: {(Number(selectedProduct.base_price || 0) * Number(selectedProduct.commission_rate || 0) / 100).toFixed(2)} Bs
              {' '}({Number(selectedProduct.commission_rate || 0).toFixed(2)}% de {Number(selectedProduct.base_price || 0).toFixed(2)} Bs)
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={!canSubmit || saving}>
            {saving ? 'Guardando...' : 'Registrar control'}
          </button>
        </form>
      </div>

      {error && (
        <div className="card" style={{ borderColor: '#ef4444', color: '#fecaca', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Resumen de productos aprobados/rechazados ({month}/{year})</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando...</p>
        ) : summaryRows.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>Sin registros para el período seleccionado.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '900px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Aprobados</th>
                  <th>Rechazados</th>
                  <th>% comisión</th>
                  <th>Comisión por pieza</th>
                  <th>Comisión total</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>{row.product_name}</td>
                    <td>{Number(row.qty_passed || 0)}</td>
                    <td>{Number(row.qty_rejected || 0)}</td>
                    <td>{Number(row.commission_rate || 0).toFixed(2)}%</td>
                    <td>{formatMoney(Number(row.base_price || 0) * Number(row.commission_rate || 0) / 100)}</td>
                    <td style={{ color: '#10b981', fontWeight: 700 }}>{formatMoney(row.commission_total)}</td>
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
