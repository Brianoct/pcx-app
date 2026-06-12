import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../apiClient';

const COST_COMPONENTS = [
  { key: 'acero_carbono_09mm', label: 'Acero al Carbono 0,9mm' },
  { key: 'pintura_electrostatica', label: 'Pintura Electrostatica' },
  { key: 'laser_punzonado', label: 'Laser/Punzonado' },
  { key: 'equipo_plegado', label: 'Equipo de plegado' },
  { key: 'equipos_pintura', label: 'Equipos de pintura' },
  { key: 'equipos_soldadura', label: 'Equipos de soldadura' },
  { key: 'equipos_corte', label: 'Equipos de Corte' },
  { key: 'carton_corrugado', label: 'Carton corrugado' },
  { key: 'cinta_embalaje', label: 'Cinta de embalaje' },
  { key: 'utilidad', label: 'Utilidad (asignacion de ganancia)' }
];

const PROCESS_OPTIONS = [
  { value: 'laser', label: 'Laser' },
  { value: 'punzonadora', label: 'Punzonadora' }
];

const toInputAmount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return String(parsed);
};

const parseAmount = (value) => {
  const normalized = String(value ?? '').replace(',', '.').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const toEditableRow = (row = {}) => {
  const components = row.components || {};
  return {
    ...row,
    draft_mode: String(row.laser_punzonado_mode || 'laser'),
    draft_components: Object.fromEntries(
      COST_COMPONENTS.map((item) => [item.key, toInputAmount(components[item.key])])
    )
  };
};

const computeRowPreview = (row) => {
  const parsed = Object.fromEntries(
    COST_COMPONENTS.map((item) => [item.key, parseAmount(row?.draft_components?.[item.key])])
  );
  const total = COST_COMPONENTS.reduce((sum, item) => sum + Number(parsed[item.key] || 0), 0);
  const percentages = Object.fromEntries(
    COST_COMPONENTS.map((item) => {
      const pct = total > 0 ? ((Number(parsed[item.key] || 0) / total) * 100) : 0;
      return [item.key, Number(pct.toFixed(2))];
    })
  );
  const totalWithoutProfit = total - Number(parsed.utilidad || 0);
  return {
    parsed,
    percentages,
    total: Number(total.toFixed(2)),
    total_without_profit: Number(Math.max(0, totalWithoutProfit).toFixed(2))
  };
};

export default function ProductCostingAdmin({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSku, setSavingSku] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const loadRows = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/product-costing', { token });
      setRows(Array.isArray(data) ? data.map(toEditableRow) : []);
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

  const filteredRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => (
      String(row?.sku || '').toLowerCase().includes(term)
      || String(row?.name || '').toLowerCase().includes(term)
    ));
  }, [rows, search]);

  const updateDraftAmount = (sku, field, value) => {
    setRows((prev) => prev.map((row) => (
      row.sku === sku
        ? {
            ...row,
            draft_components: {
              ...row.draft_components,
              [field]: value
            }
          }
        : row
    )));
  };

  const updateDraftMode = (sku, value) => {
    setRows((prev) => prev.map((row) => (
      row.sku === sku
        ? { ...row, draft_mode: value }
        : row
    )));
  };

  const saveRow = async (row) => {
    if (!row?.sku) return;
    const preview = computeRowPreview(row);
    const payload = {
      laser_punzonado_mode: row.draft_mode || 'laser',
      ...preview.parsed
    };

    setSavingSku(row.sku);
    setMessage('');
    try {
      const response = await apiRequest(`/api/product-costing/${encodeURIComponent(row.sku)}`, {
        method: 'PATCH',
        token,
        body: payload
      });
      const savedRow = toEditableRow(response || {});
      setRows((prev) => prev.map((item) => (item.sku === row.sku ? savedRow : item)));
      setMessage(`Costeo guardado para ${row.sku}. Precio actualizado: ${Number(savedRow.computed_price || 0).toFixed(2)} Bs`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSavingSku('');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '36px' }}>Cargando costeo de productos...</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: 8 }}>Costeo por producto</h3>
        <p style={{ color: '#78716c', marginBottom: 12 }}>
          Define componentes de costo y utilidad por producto. El precio final calculado se guarda como precio del producto en catálogo.
        </p>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por SKU o nombre..."
          style={{
            width: '100%',
            maxWidth: 360,
            minHeight: 40,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #e7e0d8',
            background: '#ffffff',
            color: '#292524'
          }}
        />
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

      {filteredRows.length === 0 ? (
        <div className="card" style={{ marginBottom: 0, color: '#78716c' }}>
          No hay productos para el filtro seleccionado.
        </div>
      ) : filteredRows.map((row) => {
        const preview = computeRowPreview(row);
        const isSaving = savingSku === row.sku;
        return (
          <div key={row.sku} className="card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ color: '#292524', fontWeight: 700 }}>{row.name}</div>
                <div style={{ color: '#78716c', fontSize: '0.85rem' }}>{row.sku}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#78716c', fontSize: '0.8rem' }}>Precio actual</div>
                <div style={{ color: '#292524', fontWeight: 700 }}>{Number(row.current_sf || 0).toFixed(2)} Bs</div>
                <div style={{ color: '#047857', fontWeight: 700, fontSize: '0.9rem' }}>
                  Precio calculado: {preview.total.toFixed(2)} Bs
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'grid', gap: 6, maxWidth: 280, color: '#57534e', fontSize: '0.86rem' }}>
                Proceso para Laser/Punzonado
                <select
                  value={row.draft_mode}
                  onChange={(e) => updateDraftMode(row.sku, e.target.value)}
                  style={{
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #e7e0d8',
                    background: '#ffffff',
                    color: '#292524',
                    padding: '6px 8px'
                  }}
                >
                  {PROCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {COST_COMPONENTS.map((component) => (
                <label
                  key={`${row.sku}-${component.key}`}
                  style={{
                    display: 'grid',
                    gap: 6,
                    border: '1px solid #e7e0d8',
                    borderRadius: 10,
                    padding: '10px',
                    background: '#f5f1ec'
                  }}
                >
                  <span style={{ color: '#292524', fontSize: '0.82rem' }}>{component.label}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.draft_components?.[component.key] ?? ''}
                    onChange={(e) => updateDraftAmount(row.sku, component.key, e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 36,
                      borderRadius: 8,
                      border: '1px solid #e7e0d8',
                      background: '#ffffff',
                      color: '#292524',
                      padding: '6px 8px',
                      textAlign: 'right'
                    }}
                  />
                  <span style={{ color: '#78716c', fontSize: '0.74rem' }}>
                    {preview.percentages[component.key].toFixed(2)}% del precio final
                  </span>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ color: '#78716c', fontSize: '0.85rem' }}>
                Costo sin utilidad: <strong style={{ color: '#292524' }}>{preview.total_without_profit.toFixed(2)} Bs</strong>
                {' · '}
                Utilidad: <strong style={{ color: '#b45309' }}>{Number(preview.parsed.utilidad || 0).toFixed(2)} Bs</strong>
              </div>
              <button
                type="button"
                onClick={() => saveRow(row)}
                disabled={isSaving}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#3b82f6',
                  color: 'white',
                  fontWeight: 700,
                  cursor: isSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {isSaving ? 'Guardando...' : 'Guardar costeo y precio'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
