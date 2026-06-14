import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
import QrCode from '../ui/QrCode';

const buildScanUrl = (qrToken) => {
  if (!qrToken) return '';
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
  return `${origin}#/comprar/scan/${qrToken}`;
};

function MaterialsCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [qrMaterial, setQrMaterial] = useState(null);
  const [newRow, setNewRow] = useState({
    code: '',
    name: '',
    unit_measure: '',
    unit_cost_bs: '',
    waste_pct: '',
    reorder_qty: '',
    supplier: '',
    notes: ''
  });

  const loadRows = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/admin/materiales?include_inactive=1', { token });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onRowField = (id, field, value) => {
    setRows((prev) => prev.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
    setMessage('');
  };

  const buildPayload = (input = {}) => {
    const payload = {
      code: String(input.code || '').toUpperCase().trim(),
      name: String(input.name || '').trim(),
      unit_measure: String(input.unit_measure || '').trim(),
      unit_cost_bs: Number(input.unit_cost_bs || 0),
      waste_pct: Number(input.waste_pct || 0),
      reorder_qty: Number(input.reorder_qty || 0),
      supplier: String(input.supplier || '').trim() || null,
      notes: String(input.notes || '').trim() || null
    };
    if (!payload.code || !payload.name || !payload.unit_measure) {
      throw new Error('Código, nombre y unidad son requeridos');
    }
    if (!Number.isFinite(payload.unit_cost_bs) || payload.unit_cost_bs < 0) {
      throw new Error('Costo unitario inválido');
    }
    if (!Number.isFinite(payload.waste_pct) || payload.waste_pct < 0 || payload.waste_pct > 100) {
      throw new Error('Merma % inválida (0-100)');
    }
    if (!Number.isFinite(payload.reorder_qty) || payload.reorder_qty < 0) {
      throw new Error('Cantidad de reposición inválida');
    }
    return payload;
  };

  const printLabel = async (row) => {
    try {
      const url = buildScanUrl(row.qr_token);
      const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
      const win = window.open('', '_blank', 'width=420,height=560');
      if (!win) return;
      win.document.write(`<!doctype html><html><head><title>QR ${row.code}</title>
        <style>body{font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px;color:#292524}
        img{width:320px;height:320px}h2{margin:8px 0 2px}p{margin:2px 0;color:#57534e}</style></head>
        <body><img src="${dataUrl}" alt="QR ${row.code}"/><h2>${row.name}</h2><p>${row.code}${row.unit_measure ? ` · ${row.unit_measure}` : ''}</p>
        <p>Escanea para reponer (Compras)</p>
        <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
        </body></html>`);
      win.document.close();
    } catch {
      setMessage('Error: no se pudo generar el QR para imprimir');
    }
  };

  const createRow = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const payload = buildPayload(newRow);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Crear material ${payload.code}`,
          path: '/api/admin/materiales',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { code: payload.code, name: payload.name }
        });
        setRows((prev) => [...prev, { ...payload, id: Date.now(), is_active: true }]);
        setMessage('Sin conexión: material en cola para sincronizar.');
      } else {
        await apiRequest('/api/admin/materiales', {
          method: 'POST',
          token,
          body: payload
        });
        setMessage('Material agregado.');
        await loadRows();
      }
      setNewRow({
        code: '',
        name: '',
        unit_measure: '',
        unit_cost_bs: '',
        waste_pct: '',
        reorder_qty: '',
        supplier: '',
        notes: ''
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveRow = async (row) => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        ...buildPayload(row),
        is_active: Boolean(row.is_active)
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Editar material #${row.id}`,
          path: `/api/admin/materiales/${row.id}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { id: row.id, code: payload.code }
        });
        setMessage(`Sin conexión: cambios de ${payload.code} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/materiales/${row.id}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        setMessage(`Material ${payload.code} actualizado.`);
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deactivateRow = async (row) => {
    if (!window.confirm(`¿Desactivar material ${row.code}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar material ${row.code}`,
          path: `/api/admin/materiales/${row.id}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: { id: row.id, code: row.code }
        });
        setRows((prev) => prev.map((item) => (
          item.id === row.id ? { ...item, is_active: false } : item
        )));
        setMessage(`Sin conexión: desactivación de ${row.code} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/materiales/${row.id}`, {
          method: 'DELETE',
          token
        });
        setMessage(`Material ${row.code} desactivado.`);
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px' }}>
        <h3 style={{ marginBottom: '12px' }}>Materiales</h3>
        <form onSubmit={createRow} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <input
            placeholder="Código"
            value={newRow.code}
            onChange={(e) => setNewRow((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Nombre"
            value={newRow.name}
            onChange={(e) => setNewRow((prev) => ({ ...prev, name: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Unidad (kg, m2, unidad...)"
            value={newRow.unit_measure}
            onChange={(e) => setNewRow((prev) => ({ ...prev, unit_measure: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Costo unitario (Bs)"
            value={newRow.unit_cost_bs}
            onChange={(e) => setNewRow((prev) => ({ ...prev, unit_cost_bs: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Merma %"
            value={newRow.waste_pct}
            onChange={(e) => setNewRow((prev) => ({ ...prev, waste_pct: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Reposición (cant. a comprar)"
            value={newRow.reorder_qty}
            onChange={(e) => setNewRow((prev) => ({ ...prev, reorder_qty: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Proveedor (opcional)"
            value={newRow.supplier}
            onChange={(e) => setNewRow((prev) => ({ ...prev, supplier: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Notas (opcional)"
            value={newRow.notes}
            onChange={(e) => setNewRow((prev) => ({ ...prev, notes: e.target.value }))}
            className="form-input form-input--inline"
          />
          <button
            type="submit"
            disabled={saving}
            style={{ border: 'none', borderRadius: '8px', background: '#3b82f6', color: 'white', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Guardando...' : 'Agregar material'}
          </button>
        </form>
      </div>

      {message && (
        <div style={{
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(254,226,226,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #047857',
          color: message.startsWith('Error') ? '#b91c1c' : '#047857'
        }}>
          {message}
        </div>
      )}

      <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px' }}>
        <h3 style={{ marginBottom: '12px' }}>Catálogo de materiales</h3>
        {loading ? (
          <p style={{ color: '#78716c' }}>Cargando materiales...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '980px' }}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Unidad</th>
                  <th style={{ textAlign: 'right' }}>Costo unitario (Bs)</th>
                  <th style={{ textAlign: 'right' }}>Merma %</th>
                  <th style={{ textAlign: 'right' }}>Reposición</th>
                  <th>Proveedor</th>
                  <th>Notas</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign: 'center', color: '#78716c' }}>Sin materiales</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        value={row.code || ''}
                        onChange={(e) => onRowField(row.id, 'code', e.target.value.toUpperCase())}
                        className="form-input" style={{ width: 120 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.name || ''}
                        onChange={(e) => onRowField(row.id, 'name', e.target.value)}
                        className="form-input" style={{ minWidth: 180 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.unit_measure || ''}
                        onChange={(e) => onRowField(row.id, 'unit_measure', e.target.value)}
                        className="form-input" style={{ width: 130 }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.unit_cost_bs || 0)}
                        onChange={(e) => onRowField(row.id, 'unit_cost_bs', e.target.value)}
                        className="form-input" style={{ width: 120, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={Number(row.waste_pct || 0)}
                        onChange={(e) => onRowField(row.id, 'waste_pct', e.target.value)}
                        className="form-input" style={{ width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.reorder_qty || 0)}
                        onChange={(e) => onRowField(row.id, 'reorder_qty', e.target.value)}
                        className="form-input" style={{ width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.supplier || ''}
                        onChange={(e) => onRowField(row.id, 'supplier', e.target.value)}
                        className="form-input" style={{ minWidth: 140 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.notes || ''}
                        onChange={(e) => onRowField(row.id, 'notes', e.target.value)}
                        className="form-input" style={{ minWidth: 160 }}
                      />
                    </td>
                    <td>
                      <label className="form-check-inline">
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_active)}
                          onChange={(e) => onRowField(row.id, 'is_active', e.target.checked)}
                        />
                        {row.is_active ? 'Sí' : 'No'}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => saveRow(row)}
                          disabled={saving}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setQrMaterial(row)}
                          disabled={!row.qr_token}
                          title={row.qr_token ? 'Ver código QR' : 'Guarda el material para generar su QR'}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#0f766e', color: 'white', cursor: row.qr_token ? 'pointer' : 'not-allowed' }}
                        >
                          QR
                        </button>
                        <button
                          onClick={() => deactivateRow(row)}
                          disabled={saving || !row.is_active}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#ef4444', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Desactivar
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

      {qrMaterial && (
        <div className="compras-modal-overlay" onClick={() => setQrMaterial(null)}>
          <div className="compras-modal card" style={{ maxWidth: 380, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div className="compras-modal-header">
              <h3 style={{ margin: 0 }}>QR de reposición</h3>
              <button type="button" className="compras-modal-close" onClick={() => setQrMaterial(null)} aria-label="Cerrar">×</button>
            </div>
            <div style={{ fontWeight: 700 }}>{qrMaterial.name}</div>
            <div style={{ color: '#78716c', marginBottom: 12 }}>{qrMaterial.code}{qrMaterial.unit_measure ? ` · ${qrMaterial.unit_measure}` : ''}</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <QrCode value={buildScanUrl(qrMaterial.qr_token)} size={220} alt={`QR ${qrMaterial.code}`} />
            </div>
            <p style={{ color: '#a8a29e', fontSize: '0.78rem', wordBreak: 'break-all', marginBottom: 12 }}>
              {buildScanUrl(qrMaterial.qr_token)}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => printLabel(qrMaterial)}>Imprimir etiqueta</button>
              <button type="button" className="btn" onClick={() => setQrMaterial(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MaterialsCatalogAdmin;
