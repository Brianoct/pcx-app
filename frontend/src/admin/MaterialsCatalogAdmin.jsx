import { useState, useEffect } from 'react';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
function MaterialsCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newRow, setNewRow] = useState({
    code: '',
    name: '',
    unit_measure: '',
    unit_cost_bs: '',
    waste_pct: '',
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
    return payload;
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
                  <th>Notas</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: '#78716c' }}>Sin materiales</td></tr>
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
                    <td>
                      <input
                        value={row.notes || ''}
                        onChange={(e) => onRowField(row.id, 'notes', e.target.value)}
                        className="form-input" style={{ minWidth: 180 }}
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
    </div>
  );
}

export default MaterialsCatalogAdmin;
