import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';

export default function ComprasScan({ token }) {
  const { token: scanToken } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [material, setMaterial] = useState(null);
  const [openRequest, setOpenRequest] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState('normal');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest(`/api/procurement/materials/${encodeURIComponent(scanToken)}`, { token });
        if (!active) return;
        setMaterial(data.material);
        setOpenRequest(data.open_request || null);
        const reorder = Number(data.material?.reorder_qty || 0);
        setQuantity(reorder > 0 ? String(reorder) : '1');
      } catch (err) {
        if (active) setError(err.message || 'No se pudo cargar el material');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [scanToken, token]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { token: scanToken, priority };
      if (quantity && Number(quantity) > 0) body.quantity = Number(quantity);
      if (note.trim()) body.note = note.trim();
      const res = await apiRequest('/api/procurement/scan', { method: 'POST', token, body });
      setDone(res?.request || null);
      toast.success(res?.message || 'Agregado a compras');
    } catch (err) {
      toast.error(err.message || 'No se pudo agregar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container compras-scan">
      <div className="card compras-scan-card">
        <h2 style={{ color: '#dc2626', marginBottom: 6 }}>Reponer material</h2>

        {loading ? (
          <p style={{ color: '#78716c' }}>Cargando material…</p>
        ) : error ? (
          <>
            <p style={{ color: '#b91c1c' }}>{error}</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Ir al inicio</button>
          </>
        ) : done ? (
          <div className="compras-scan-done">
            <div className="compras-scan-check">✓</div>
            <p><strong>{done.material_name}</strong> agregado a la lista de compras.</p>
            <p style={{ color: '#78716c' }}>Cantidad total a comprar: <strong>{done.quantity} {done.unit_measure || ''}</strong>{done.scan_count > 1 ? ` (${done.scan_count} escaneos)` : ''}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/comprar')}>Ver lista de compras</button>
              <button type="button" className="btn" onClick={() => navigate('/')}>Inicio</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
            <div className="compras-scan-material">
              <div className="compras-card-name" style={{ fontSize: '1.1rem' }}>{material.name}</div>
              <div className="compras-card-code">{material.code}{material.supplier ? ` · ${material.supplier}` : ''}</div>
            </div>
            {openRequest && (
              <div className="compras-scan-existing">
                Ya hay una solicitud abierta de {openRequest.quantity} {material.unit_measure || ''}. Esto se sumará a esa solicitud (dos contenedores).
              </div>
            )}
            <div>
              <label className="form-label">Cantidad a comprar ({material.unit_measure || 'u'})</label>
              <input type="number" min="0" step="0.01" className="filter-input" style={{ width: '100%' }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Prioridad</label>
              <select className="filter-select" style={{ width: '100%' }} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="urgent">Urgente</option>
                <option value="low">Baja</option>
              </select>
            </div>
            <div>
              <label className="form-label">Nota (opcional)</label>
              <input className="filter-input" style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Detalle para el comprador" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Agregando…' : 'Agregar a compras'}</button>
            <button type="button" className="btn" onClick={() => navigate('/')}>Cancelar</button>
          </form>
        )}
      </div>
    </div>
  );
}
