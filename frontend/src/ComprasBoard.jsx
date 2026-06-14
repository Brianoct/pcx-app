import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';

const COLUMNS = [
  { key: 'pending', label: 'Por comprar', accent: '#dc2626' },
  { key: 'purchased', label: 'Comprado', accent: '#2563eb' },
  { key: 'received', label: 'Recibido', accent: '#16a34a' }
];

const PRIORITY_COLOR = { urgent: '#dc2626', normal: '#57534e', low: '#a8a29e' };

const formatQty = (qty, unit) => `${Number(qty || 0)}${unit ? ` ${unit}` : ''}`;
const formatWhen = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function ComprasBoard({ token }) {
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [addMaterialId, setAddMaterialId] = useState('');
  const [addQty, setAddQty] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [reqData, matData] = await Promise.all([
        apiRequest('/api/procurement/requests', { token }),
        apiRequest('/api/procurement/materials', { token }).catch(() => [])
      ]);
      setRequests(Array.isArray(reqData) ? reqData : []);
      setMaterials(Array.isArray(matData) ? matData : []);
    } catch (err) {
      setError(err.message || 'No se pudo cargar la lista de compras');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const byStatus = useMemo(() => {
    const grouped = { pending: [], purchased: [], received: [] };
    for (const req of requests) {
      if (grouped[req.status]) grouped[req.status].push(req);
    }
    return grouped;
  }, [requests]);

  const pendingTotal = byStatus.pending.length;

  const patchRequest = async (id, body, successMsg) => {
    setBusyId(id);
    try {
      const res = await apiRequest(`/api/procurement/requests/${id}`, { method: 'PATCH', token, body });
      const updated = res?.request;
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (successMsg) toast.success(successMsg);
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar');
    } finally {
      setBusyId(null);
    }
  };

  const removeRequest = async (id) => {
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar este material de la lista?')) return;
    setBusyId(id);
    try {
      await apiRequest(`/api/procurement/requests/${id}`, { method: 'DELETE', token });
      setRequests((prev) => prev.filter((r) => r.id !== id));
      toast.success('Eliminado de la lista');
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setBusyId(null);
    }
  };

  const editQty = async (req) => {
    const next = window.prompt(`Cantidad a comprar de ${req.material_name} (${req.unit_measure || 'u'}):`, String(req.quantity));
    if (next === null) return;
    const qty = Number(next);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Cantidad inválida');
      return;
    }
    await patchRequest(req.id, { quantity: qty }, 'Cantidad actualizada');
  };

  const addManual = async (e) => {
    e.preventDefault();
    if (!addMaterialId) {
      toast.error('Elige un material');
      return;
    }
    setAdding(true);
    try {
      const body = { material_id: Number(addMaterialId) };
      if (addQty && Number(addQty) > 0) body.quantity = Number(addQty);
      await apiRequest('/api/procurement/scan', { method: 'POST', token, body });
      setAddMaterialId('');
      setAddQty('');
      toast.success('Material agregado a la lista');
      await load();
    } catch (err) {
      toast.error(err.message || 'No se pudo agregar');
    } finally {
      setAdding(false);
    }
  };

  const nextActions = (req) => {
    const disabled = busyId === req.id;
    if (req.status === 'pending') {
      return (
        <>
          <button type="button" className="btn compras-btn-primary" disabled={disabled} onClick={() => patchRequest(req.id, { status: 'purchased' }, 'Marcado como comprado')}>Comprado</button>
          <button type="button" className="btn" disabled={disabled} onClick={() => editQty(req)}>Editar cant.</button>
          <button type="button" className="btn compras-btn-danger" disabled={disabled} onClick={() => removeRequest(req.id)}>Quitar</button>
        </>
      );
    }
    if (req.status === 'purchased') {
      return (
        <>
          <button type="button" className="btn compras-btn-success" disabled={disabled} onClick={() => patchRequest(req.id, { status: 'received' }, 'Marcado como recibido')}>Recibido</button>
          <button type="button" className="btn" disabled={disabled} onClick={() => patchRequest(req.id, { status: 'pending' }, 'Devuelto a por comprar')}>Deshacer</button>
        </>
      );
    }
    return (
      <button type="button" className="btn compras-btn-danger" disabled={disabled} onClick={() => removeRequest(req.id)}>Quitar</button>
    );
  };

  return (
    <div className="container compras-page">
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ marginBottom: 6, color: '#dc2626' }}>Compras (procurement)</h2>
            <p style={{ color: '#78716c', margin: 0 }}>
              Lista de reposición de materiales (sistema de dos contenedores). Escanea el QR de un insumo cuando se vacíe un contenedor para agregarlo aquí.
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>Actualizar</button>
        </div>
        <form onSubmit={addManual} className="compras-add-form">
          <select className="filter-select" value={addMaterialId} onChange={(e) => setAddMaterialId(e.target.value)}>
            <option value="">Agregar material manualmente…</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            className="filter-input"
            placeholder="Cantidad (opcional)"
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
            style={{ width: 160 }}
          />
          <button type="submit" className="btn compras-btn-primary" disabled={adding}>{adding ? 'Agregando…' : 'Agregar'}</button>
        </form>
      </div>

      {error && <div className="card" style={{ borderColor: '#ef4444', color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando…</div>
      ) : (
        <div className="compras-board">
          {COLUMNS.map((col) => (
            <div key={col.key} className="compras-column">
              <div className="compras-column-head" style={{ borderColor: col.accent }}>
                <span style={{ color: col.accent, fontWeight: 700 }}>{col.label}</span>
                <span className="compras-count">{byStatus[col.key].length}</span>
              </div>
              <div className="compras-column-body">
                {byStatus[col.key].length === 0 ? (
                  <div className="compras-empty">Sin materiales</div>
                ) : byStatus[col.key].map((req) => (
                  <article key={req.id} className={`compras-card ${req.priority === 'urgent' ? 'is-urgent' : ''}`}>
                    <div className="compras-card-top">
                      <div style={{ minWidth: 0 }}>
                        <div className="compras-card-name">{req.material_name}</div>
                        <div className="compras-card-code">{req.material_code}</div>
                      </div>
                      <span className="compras-qty">{formatQty(req.quantity, req.unit_measure)}</span>
                    </div>
                    <div className="compras-card-meta">
                      {req.priority === 'urgent' && <span className="compras-pill" style={{ color: PRIORITY_COLOR.urgent, borderColor: PRIORITY_COLOR.urgent }}>Urgente</span>}
                      {req.scan_count > 1 && <span className="compras-pill">{req.scan_count} escaneos</span>}
                      {req.supplier && <span className="compras-pill">{req.supplier}</span>}
                      {req.store_location && <span className="compras-pill">{req.store_location}</span>}
                    </div>
                    {req.note && <div className="compras-note">{req.note}</div>}
                    <div className="compras-card-foot">
                      {req.requested_by_email ? `Pedido por ${req.requested_by_email.split('@')[0]}` : 'Pedido'} · {formatWhen(req.created_at)}
                    </div>
                    <div className="compras-card-actions">{nextActions(req)}</div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ color: '#a8a29e', fontSize: '0.82rem', marginTop: 12 }}>
        Materiales por comprar: <strong style={{ color: pendingTotal > 0 ? '#dc2626' : '#16a34a' }}>{pendingTotal}</strong>
      </p>
    </div>
  );
}
