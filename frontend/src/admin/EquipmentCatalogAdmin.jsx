import { useState, useEffect } from 'react';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
function EquipmentCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newRow, setNewRow] = useState({
    code: '',
    name: '',
    replacement_cost_bs: '',
    useful_life_months: '',
    monthly_extra_cost_bs: '',
    monthly_capacity_units: '',
    usage_unit: '',
    notes: ''
  });

  const loadRows = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/admin/equipos?include_inactive=1', { token });
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
      replacement_cost_bs: Number(input.replacement_cost_bs || 0),
      useful_life_months: input.useful_life_months === '' || input.useful_life_months === null || input.useful_life_months === undefined
        ? null
        : Number.parseInt(input.useful_life_months, 10),
      monthly_extra_cost_bs: Number(input.monthly_extra_cost_bs || 0),
      monthly_capacity_units: input.monthly_capacity_units === '' || input.monthly_capacity_units === null || input.monthly_capacity_units === undefined
        ? null
        : Number(input.monthly_capacity_units),
      usage_unit: String(input.usage_unit || '').trim() || null,
      notes: String(input.notes || '').trim() || null
    };
    if (!payload.code || !payload.name) {
      throw new Error('Código y nombre son requeridos');
    }
    if (!Number.isFinite(payload.replacement_cost_bs) || payload.replacement_cost_bs < 0) {
      throw new Error('Costo de reposición inválido');
    }
    if (!Number.isFinite(payload.monthly_extra_cost_bs) || payload.monthly_extra_cost_bs < 0) {
      throw new Error('Costo mensual extra inválido');
    }
    if (payload.useful_life_months !== null && (!Number.isInteger(payload.useful_life_months) || payload.useful_life_months <= 0)) {
      throw new Error('Vida útil (meses) inválida');
    }
    if (payload.monthly_capacity_units !== null && (!Number.isFinite(payload.monthly_capacity_units) || payload.monthly_capacity_units <= 0)) {
      throw new Error('Capacidad mensual inválida');
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
          label: `Crear equipo ${payload.code}`,
          path: '/api/admin/equipos',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { code: payload.code, name: payload.name }
        });
        setRows((prev) => [...prev, { ...payload, id: Date.now(), is_active: true }]);
        setMessage('Sin conexión: equipo en cola para sincronizar.');
      } else {
        await apiRequest('/api/admin/equipos', {
          method: 'POST',
          token,
          body: payload
        });
        setMessage('Equipo agregado.');
        await loadRows();
      }
      setNewRow({
        code: '',
        name: '',
        replacement_cost_bs: '',
        useful_life_months: '',
        monthly_extra_cost_bs: '',
        monthly_capacity_units: '',
        usage_unit: '',
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
          label: `Editar equipo #${row.id}`,
          path: `/api/admin/equipos/${row.id}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { id: row.id, code: payload.code }
        });
        setMessage(`Sin conexión: cambios de ${payload.code} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/equipos/${row.id}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        setMessage(`Equipo ${payload.code} actualizado.`);
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deactivateRow = async (row) => {
    if (!window.confirm(`¿Desactivar equipo ${row.code}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar equipo ${row.code}`,
          path: `/api/admin/equipos/${row.id}`,
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
        await apiRequest(`/api/admin/equipos/${row.id}`, {
          method: 'DELETE',
          token
        });
        setMessage(`Equipo ${row.code} desactivado.`);
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
      <div style={{ background: '#1e293b', padding: '20px', borderRadius: '12px' }}>
        <h3 style={{ marginBottom: '12px' }}>Equipos</h3>
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
            type="number"
            min="0"
            step="0.01"
            placeholder="Costo reposición (Bs)"
            value={newRow.replacement_cost_bs}
            onChange={(e) => setNewRow((prev) => ({ ...prev, replacement_cost_bs: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="1"
            step="1"
            placeholder="Vida útil (meses)"
            value={newRow.useful_life_months}
            onChange={(e) => setNewRow((prev) => ({ ...prev, useful_life_months: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Costo mensual extra (Bs)"
            value={newRow.monthly_extra_cost_bs}
            onChange={(e) => setNewRow((prev) => ({ ...prev, monthly_extra_cost_bs: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Capacidad mensual"
            value={newRow.monthly_capacity_units}
            onChange={(e) => setNewRow((prev) => ({ ...prev, monthly_capacity_units: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Unidad de uso (horas, ciclos)"
            value={newRow.usage_unit}
            onChange={(e) => setNewRow((prev) => ({ ...prev, usage_unit: e.target.value }))}
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
            {saving ? 'Guardando...' : 'Agregar equipo'}
          </button>
        </form>
      </div>

      {message && (
        <div style={{
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
          color: message.startsWith('Error') ? '#fecaca' : '#bbf7d0'
        }}>
          {message}
        </div>
      )}

      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
        <h3 style={{ marginBottom: '12px' }}>Catálogo de equipos</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando equipos...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '1220px' }}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th style={{ textAlign: 'right' }}>Reposición (Bs)</th>
                  <th style={{ textAlign: 'right' }}>Vida útil (meses)</th>
                  <th style={{ textAlign: 'right' }}>Mensual extra (Bs)</th>
                  <th style={{ textAlign: 'right' }}>Capacidad mensual</th>
                  <th>Unidad uso</th>
                  <th>Notas</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign: 'center', color: '#94a3b8' }}>Sin equipos</td></tr>
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
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.replacement_cost_bs || 0)}
                        onChange={(e) => onRowField(row.id, 'replacement_cost_bs', e.target.value)}
                        className="form-input" style={{ width: 120, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={row.useful_life_months ?? ''}
                        onChange={(e) => onRowField(row.id, 'useful_life_months', e.target.value)}
                        className="form-input" style={{ width: 110, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.monthly_extra_cost_bs || 0)}
                        onChange={(e) => onRowField(row.id, 'monthly_extra_cost_bs', e.target.value)}
                        className="form-input" style={{ width: 120, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.monthly_capacity_units ?? ''}
                        onChange={(e) => onRowField(row.id, 'monthly_capacity_units', e.target.value)}
                        className="form-input" style={{ width: 120, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.usage_unit || ''}
                        onChange={(e) => onRowField(row.id, 'usage_unit', e.target.value)}
                        className="form-input" style={{ width: 120 }}
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

export default EquipmentCatalogAdmin;
