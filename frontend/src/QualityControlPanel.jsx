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
  const [records, setRecords] = useState([]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [totalCommission, setTotalCommission] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
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
  const isEditing = Number.isInteger(editingId) && editingId > 0;

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      const [productsRes, summaryRes, checksRes] = await Promise.all([
        fetch(`${API_BASE}/api/qc/products`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/qc/summary?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/qc/checks?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (!productsRes.ok) {
        const err = await productsRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron cargar productos para control de calidad');
      }
      if (!summaryRes.ok) {
        const err = await summaryRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo cargar resumen mensual de control de calidad');
      }
      if (!checksRes.ok) {
        const err = await checksRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo cargar registros de control de calidad');
      }

      const productsData = await productsRes.json();
      const summaryData = await summaryRes.json();
      const checksData = await checksRes.json();

      const sortedProducts = [...(Array.isArray(productsData) ? productsData : [])]
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'es', { sensitivity: 'base' }));
      setProducts(sortedProducts);
      setSummaryRows(Array.isArray(summaryData?.rows) ? summaryData.rows : []);
      setTotalCommission(Number(summaryData?.total_commission || 0));
      setRecords(Array.isArray(checksData) ? checksData : []);

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
      const res = await fetch(
        isEditing ? `${API_BASE}/api/qc/checks/${editingId}` : `${API_BASE}/api/qc/checks`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            sku: form.sku,
            quantity: Number.parseInt(form.quantity, 10),
            result: form.result
          })
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (isEditing
          ? 'No se pudo actualizar control de calidad'
          : 'No se pudo registrar control de calidad'));
      }
      setForm((prev) => ({
        ...prev,
        quantity: '',
        result: 'passed'
      }));
      setEditingId(null);
      await loadData();
    } catch (err) {
      setError(err.message || (isEditing
        ? 'Error al actualizar control de calidad'
        : 'Error al registrar control de calidad'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (record) => {
    setEditingId(Number(record?.id || 0));
    setForm({
      sku: String(record?.sku || ''),
      quantity: String(record?.quantity || ''),
      result: String(record?.result || 'passed') === 'rejected' ? 'rejected' : 'passed'
    });
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm((prev) => ({
      ...prev,
      quantity: '',
      result: 'passed'
    }));
  };

  const deleteRecord = async (recordId) => {
    if (!Number.isInteger(recordId) || recordId <= 0) return;
    const confirmed = window.confirm('¿Eliminar este registro de control de calidad? Esta acción no se puede deshacer.');
    if (!confirmed) return;
    setDeletingId(recordId);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/qc/checks/${recordId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo eliminar el registro de control de calidad');
      }
      if (recordId === editingId) {
        cancelEdit();
      }
      await loadData();
    } catch (err) {
      setError(err.message || 'Error al eliminar registro de control de calidad');
    } finally {
      setDeletingId(null);
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
        <h3 style={{ marginBottom: '10px' }}>
          {isEditing ? `Editar revisión #${editingId}` : 'Registrar revisión'}
        </h3>
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

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="submit" disabled={!canSubmit || saving}>
              {saving ? 'Guardando...' : (isEditing ? 'Guardar cambios' : 'Registrar control')}
            </button>
            {isEditing && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancelar edición
              </button>
            )}
          </div>
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

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Registros del período ({month}/{year})</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando...</p>
        ) : records.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>Sin registros para el período seleccionado.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '960px' }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Resultado</th>
                  <th>Registrado por</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString('es-BO')}</td>
                    <td>{row.sku}</td>
                    <td>{row.product_name}</td>
                    <td>{Number(row.quantity || 0)}</td>
                    <td style={{ color: row.result === 'passed' ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
                      {row.result === 'passed' ? 'Aprobado' : 'Rechazado'}
                    </td>
                    <td>{row.user_email || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ minHeight: '34px', padding: '7px 12px' }}
                          onClick={() => startEdit(row)}
                          disabled={saving || deletingId === row.id}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ minHeight: '34px', padding: '7px 12px' }}
                          onClick={() => deleteRecord(Number(row.id))}
                          disabled={saving || deletingId === row.id}
                        >
                          {deletingId === row.id ? 'Eliminando...' : 'Eliminar'}
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
