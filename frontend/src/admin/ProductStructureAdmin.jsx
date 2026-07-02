import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../apiClient';
import { useToast } from '../ui/toastContext';

const PROCESS_OPTIONS = [
  { value: 'impresion_3d', label: 'Impresión 3D' },
  { value: 'corte_laser', label: 'Corte Láser' },
  { value: 'punzonado', label: 'Punzonado' },
  { value: 'plegado', label: 'Plegado' },
  { value: 'soldado', label: 'Soldado' },
  { value: 'lavado', label: 'Lavado' },
  { value: 'pintado', label: 'Pintado' },
  { value: 'embalado', label: 'Embalado' }
];
const PROCESS_LABEL = Object.fromEntries(PROCESS_OPTIONS.map((p) => [p.value, p.label]));

const money = (value) => `${Number(value || 0).toFixed(2)} Bs`;

// Mirrors backend equipmentCostPerUnit (lib/productStructure.js).
const equipmentCostPerUnit = (equipment) => {
  if (!equipment) return 0;
  const capacity = Number(equipment.monthly_capacity_units || 0);
  if (capacity <= 0) return 0;
  const life = Number(equipment.useful_life_months || 0);
  const depreciation = life > 0 ? Number(equipment.replacement_cost_bs || 0) / life : 0;
  return (depreciation + Number(equipment.monthly_extra_cost_bs || 0)) / capacity;
};

function ProductStructureAdmin({ token }) {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [materialsCatalog, setMaterialsCatalog] = useState([]);
  const [laborRate, setLaborRate] = useState('0');
  const [samplingRate, setSamplingRate] = useState('25');
  const [savingRate, setSavingRate] = useState(false);
  const [variance, setVariance] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [structure, setStructure] = useState(null); // { steps, materials, costing, name }
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [costingRows, equipos, materiales, settings, varianceData] = await Promise.all([
          apiRequest('/api/product-costing', { token }),
          apiRequest('/api/admin/equipos', { token }),
          apiRequest('/api/admin/materiales', { token }),
          apiRequest('/api/production/settings', { token }),
          apiRequest('/api/production/variance', { token }).catch(() => null)
        ]);
        if (!active) return;
        setProducts((Array.isArray(costingRows) ? costingRows : []).map((r) => ({ sku: r.sku, name: r.name })));
        setEquipment(Array.isArray(equipos) ? equipos : []);
        setMaterialsCatalog(Array.isArray(materiales) ? materiales : []);
        setLaborRate(String(settings?.labor_rate_bs_hour ?? 0));
        setSamplingRate(String(settings?.sampling_rate_pct ?? 25));
        setVariance(varianceData);
      } catch (err) {
        if (active) setError(err.message || 'No se pudieron cargar catálogos');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const equipmentById = useMemo(
    () => new Map(equipment.map((e) => [Number(e.id), e])),
    [equipment]
  );
  const materialById = useMemo(
    () => new Map(materialsCatalog.map((m) => [Number(m.id), m])),
    [materialsCatalog]
  );

  const loadStructure = async (sku) => {
    setSelectedSku(sku);
    setLoadingStructure(true);
    try {
      const data = await apiRequest(`/api/products/${encodeURIComponent(sku)}/structure`, { token });
      setStructure({
        name: data?.name || sku,
        steps: (data?.steps || []).map((s) => ({
          process: s.process,
          std_minutes: s.std_minutes ?? '',
          equipment_id: s.equipment_id ?? ''
        })),
        materials: (data?.materials || []).map((m) => ({
          material_id: m.material_id,
          qty_per_unit: m.qty_per_unit,
          process: m.process ?? ''
        })),
        utility: Number(data?.costing?.utility || 0),
        manualTotal: Number(data?.costing?.manual_total || 0),
        currentPrice: Number(data?.costing?.current_price || 0)
      });
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo cargar estructura'));
      setStructure(null);
    } finally {
      setLoadingStructure(false);
    }
  };

  const saveRate = async () => {
    setSavingRate(true);
    try {
      const data = await apiRequest('/api/production/settings', {
        method: 'PATCH',
        token,
        body: {
          labor_rate_bs_hour: Number(laborRate) || 0,
          sampling_rate_pct: Number.parseInt(samplingRate, 10) || 0
        }
      });
      setLaborRate(String(data?.labor_rate_bs_hour ?? laborRate));
      setSamplingRate(String(data?.sampling_rate_pct ?? samplingRate));
      toast.success('Configuración de producción guardada');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo guardar la configuración'));
    } finally {
      setSavingRate(false);
    }
  };

  const updateStep = (index, patch) => {
    setStructure((prev) => prev && ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    }));
  };
  const moveStep = (index, delta) => {
    setStructure((prev) => {
      if (!prev) return prev;
      const next = [...prev.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, steps: next };
    });
  };
  const removeStep = (index) => {
    setStructure((prev) => prev && ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };
  const addStep = () => {
    setStructure((prev) => {
      if (!prev) return prev;
      const used = new Set(prev.steps.map((s) => s.process));
      const nextProcess = PROCESS_OPTIONS.find((p) => !used.has(p.value));
      if (!nextProcess) return prev;
      return { ...prev, steps: [...prev.steps, { process: nextProcess.value, std_minutes: '', equipment_id: '' }] };
    });
  };

  const updateMaterial = (index, patch) => {
    setStructure((prev) => prev && ({
      ...prev,
      materials: prev.materials.map((m, i) => (i === index ? { ...m, ...patch } : m))
    }));
  };
  const removeMaterial = (index) => {
    setStructure((prev) => prev && ({ ...prev, materials: prev.materials.filter((_, i) => i !== index) }));
  };
  const addMaterial = () => {
    setStructure((prev) => {
      if (!prev) return prev;
      const used = new Set(prev.materials.map((m) => Number(m.material_id)));
      const nextMaterial = materialsCatalog.find((m) => !used.has(Number(m.id)));
      if (!nextMaterial) return prev;
      return { ...prev, materials: [...prev.materials, { material_id: Number(nextMaterial.id), qty_per_unit: 0, process: '' }] };
    });
  };

  // Live costing preview (mirrors the backend rollup).
  const preview = useMemo(() => {
    if (!structure) return null;
    const rate = Number(laborRate) || 0;
    const materialsCost = structure.materials.reduce((sum, m) => {
      const cat = materialById.get(Number(m.material_id));
      if (!cat) return sum;
      return sum + Number(m.qty_per_unit || 0) * Number(cat.unit_cost_bs || 0) * (1 + Number(cat.waste_pct || 0) / 100);
    }, 0);
    const equipmentCost = structure.steps.reduce((sum, s) => (
      sum + equipmentCostPerUnit(equipmentById.get(Number(s.equipment_id)))
    ), 0);
    const totalMinutes = structure.steps.reduce((sum, s) => sum + (Number(s.std_minutes) || 0), 0);
    const laborCost = (totalMinutes / 60) * rate;
    const computedCost = materialsCost + equipmentCost + laborCost;
    return {
      materialsCost,
      equipmentCost,
      laborCost,
      totalMinutes,
      computedCost,
      computedPrice: computedCost + structure.utility
    };
  }, [structure, materialById, equipmentById, laborRate]);

  const saveStructure = async () => {
    if (!structure || !selectedSku) return;
    if (structure.steps.length === 0) {
      toast.error('La ruta necesita al menos un paso.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        steps: structure.steps.map((s) => ({
          process: s.process,
          std_minutes: s.std_minutes === '' ? null : Number(s.std_minutes),
          equipment_id: s.equipment_id === '' ? null : Number(s.equipment_id)
        })),
        materials: structure.materials.map((m) => ({
          material_id: Number(m.material_id),
          qty_per_unit: Number(m.qty_per_unit) || 0,
          process: m.process || null
        }))
      };
      await apiRequest(`/api/products/${encodeURIComponent(selectedSku)}/structure`, {
        method: 'PUT',
        token,
        body
      });
      toast.success('Estructura guardada');
      await loadStructure(selectedSku);
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo guardar la estructura'));
    } finally {
      setSaving(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) => `${p.sku} ${p.name || ''}`.toLowerCase().includes(term));
  }, [products, search]);

  const routeProcesses = structure ? structure.steps.map((s) => s.process) : [];

  if (loading) return <div className="card" style={{ color: '#78716c' }}>Cargando estructura de productos…</div>;
  if (error) return <div className="card" style={{ borderColor: '#ef4444', color: '#b91c1c' }}>{error}</div>;

  return (
    <div className="est-shell">
      {/* Labor rate */}
      <div className="card est-rate-card">
        <div>
          <h3 style={{ margin: 0 }}>Estructura de productos</h3>
          <p style={{ color: '#78716c', margin: '4px 0 0', fontSize: '0.86rem' }}>
            Ruta de procesos, materiales (BOM) y costo derivado por producto. La comparación con el costeo manual aparece al seleccionar un producto.
          </p>
        </div>
        <div className="est-rate-controls">
          <label className="est-rate-label">
            Mano de obra (Bs/hora)
            <input
              type="number"
              min="0"
              step="0.5"
              value={laborRate}
              onChange={(e) => setLaborRate(e.target.value)}
            />
          </label>
          <label className="est-rate-label" title="Probabilidad de pedir una medición real al entrar a una etapa que consume material">
            Muestreo (%)
            <input
              type="number"
              min="0"
              max="100"
              value={samplingRate}
              onChange={(e) => setSamplingRate(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-secondary" onClick={saveRate} disabled={savingRate}>
            {savingRate ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="est-grid">
        {/* Product picker */}
        <div className="card est-picker">
          <input
            type="text"
            className="est-search"
            placeholder="Buscar producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="est-product-list">
            {filteredProducts.map((p) => (
              <button
                key={p.sku}
                type="button"
                className={`est-product-item ${selectedSku === p.sku ? 'is-active' : ''}`}
                onClick={() => loadStructure(p.sku)}
              >
                <span className="est-product-sku">{p.sku}</span>
                <span className="est-product-name">{p.name}</span>
              </button>
            ))}
            {filteredProducts.length === 0 && <div style={{ color: '#78716c', padding: '10px' }}>Sin coincidencias.</div>}
          </div>
        </div>

        {/* Editor */}
        <div className="est-editor">
          {!selectedSku ? (
            <div className="card" style={{ color: '#78716c' }}>Selecciona un producto para editar su ruta y materiales.</div>
          ) : loadingStructure || !structure ? (
            <div className="card" style={{ color: '#78716c' }}>Cargando {selectedSku}…</div>
          ) : (
            <>
              <div className="card">
                <div className="est-section-head">
                  <h4 className="est-section-title">Ruta de procesos — {structure.name}</h4>
                  <button type="button" className="btn btn-secondary est-add-btn" onClick={addStep}>+ Paso</button>
                </div>
                <div className="est-steps">
                  {structure.steps.map((step, index) => (
                    <div key={`${step.process}-${index}`} className="est-step-row">
                      <span className="est-step-order">{index + 1}</span>
                      <select
                        value={step.process}
                        onChange={(e) => updateStep(index, { process: e.target.value })}
                        aria-label="Proceso"
                      >
                        {PROCESS_OPTIONS.map((p) => (
                          <option
                            key={p.value}
                            value={p.value}
                            disabled={p.value !== step.process && routeProcesses.includes(p.value)}
                          >
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="min"
                        title="Minutos estándar por pieza"
                        value={step.std_minutes}
                        onChange={(e) => updateStep(index, { std_minutes: e.target.value })}
                        className="est-minutes"
                      />
                      <select
                        value={step.equipment_id}
                        onChange={(e) => updateStep(index, { equipment_id: e.target.value })}
                        aria-label="Equipo"
                        className="est-equip"
                      >
                        <option value="">Sin equipo</option>
                        {equipment.map((eq) => (
                          <option key={eq.id} value={eq.id}>{eq.name}</option>
                        ))}
                      </select>
                      <div className="est-row-actions">
                        <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="Subir">↑</button>
                        <button type="button" onClick={() => moveStep(index, 1)} disabled={index === structure.steps.length - 1} aria-label="Bajar">↓</button>
                        <button type="button" className="is-danger" onClick={() => removeStep(index)} aria-label="Quitar">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="est-section-head">
                  <h4 className="est-section-title">Materiales (BOM)</h4>
                  <button type="button" className="btn btn-secondary est-add-btn" onClick={addMaterial}>+ Material</button>
                </div>
                {structure.materials.length === 0 ? (
                  <p style={{ color: '#78716c', margin: 0 }}>Sin materiales asignados. Agrega los insumos que consume una pieza.</p>
                ) : (
                  <div className="est-materials">
                    {structure.materials.map((material, index) => {
                      const cat = materialById.get(Number(material.material_id));
                      const lineCost = cat
                        ? Number(material.qty_per_unit || 0) * Number(cat.unit_cost_bs || 0) * (1 + Number(cat.waste_pct || 0) / 100)
                        : 0;
                      return (
                        <div key={`${material.material_id}-${index}`} className="est-material-row">
                          <select
                            value={material.material_id}
                            onChange={(e) => updateMaterial(index, { material_id: Number(e.target.value) })}
                            aria-label="Material"
                            className="est-material-select"
                          >
                            {materialsCatalog.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={material.qty_per_unit}
                            onChange={(e) => updateMaterial(index, { qty_per_unit: e.target.value })}
                            title={`Cantidad por pieza${cat ? ` (${cat.unit_measure})` : ''}`}
                            className="est-qty"
                          />
                          <span className="est-unit">{cat?.unit_measure || ''}</span>
                          <select
                            value={material.process}
                            onChange={(e) => updateMaterial(index, { process: e.target.value })}
                            aria-label="Proceso donde se consume"
                            className="est-material-process"
                          >
                            <option value="">Proceso…</option>
                            {routeProcesses.map((p) => (
                              <option key={p} value={p}>{PROCESS_LABEL[p] || p}</option>
                            ))}
                          </select>
                          <span className="est-line-cost">{money(lineCost)}</span>
                          <div className="est-row-actions">
                            <button type="button" className="is-danger" onClick={() => removeMaterial(index)} aria-label="Quitar">✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {preview && (
                <div className="card est-costing">
                  <h4 className="est-section-title" style={{ marginBottom: '10px' }}>Costo derivado</h4>
                  <div className="est-cost-grid">
                    <div><span>Materiales</span><strong>{money(preview.materialsCost)}</strong></div>
                    <div><span>Equipos</span><strong>{money(preview.equipmentCost)}</strong></div>
                    <div>
                      <span>Mano de obra ({preview.totalMinutes.toFixed(0)} min)</span>
                      <strong>{money(preview.laborCost)}</strong>
                    </div>
                    <div className="est-cost-total"><span>Costo total</span><strong>{money(preview.computedCost)}</strong></div>
                    <div><span>Utilidad (costeo)</span><strong>{money(structure.utility)}</strong></div>
                    <div className="est-cost-total is-price"><span>Precio derivado</span><strong>{money(preview.computedPrice)}</strong></div>
                  </div>
                  <div className="est-compare">
                    Costeo manual: <strong>{money(structure.manualTotal)}</strong>
                    {' · '}Precio actual: <strong>{money(structure.currentPrice)}</strong>
                    {structure.manualTotal > 0 && (
                      <span className={`est-delta ${Math.abs(preview.computedPrice - structure.manualTotal) < 0.5 ? 'is-ok' : ''}`}>
                        Δ {money(preview.computedPrice - structure.manualTotal)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary est-save"
                onClick={saveStructure}
                disabled={saving || structure.steps.length === 0}
              >
                {saving ? 'Guardando…' : `Guardar estructura de ${selectedSku}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Real vs standard, from operator samples and the movement log */}
      {variance && (variance.materials?.length > 0 || variance.times?.length > 0) && (
        <div className="card">
          <h4 className="est-section-title" style={{ marginBottom: '4px' }}>Mediciones reales vs estándar</h4>
          <p style={{ color: '#78716c', fontSize: '0.82rem', margin: '0 0 12px' }}>
            Consumo registrado por operadores (muestreo aleatorio) y tiempos observados en el tablero, comparados con los valores estándar.
          </p>

          {variance.materials?.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: variance.times?.length > 0 ? '16px' : 0 }}>
              <table className="table est-variance-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Material</th>
                    <th style={{ textAlign: 'right' }}>Estándar/pza</th>
                    <th style={{ textAlign: 'right' }}>Real/pza</th>
                    <th style={{ textAlign: 'right' }}>Muestras</th>
                    <th style={{ textAlign: 'right' }}>Δ%</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.materials.map((row) => (
                    <tr key={`${row.sku}-${row.material_id}`}>
                      <td>{row.sku}</td>
                      <td>{row.name}</td>
                      <td style={{ textAlign: 'right' }}>{row.std_qty_per_piece !== null ? `${row.std_qty_per_piece} ${row.unit_measure}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{row.avg_qty_per_piece !== null ? `${row.avg_qty_per_piece} ${row.unit_measure}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{row.samples}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: row.delta_pct === null ? '#78716c' : Math.abs(row.delta_pct) <= 10 ? '#047857' : '#b45309' }}>
                        {row.delta_pct !== null ? `${row.delta_pct > 0 ? '+' : ''}${row.delta_pct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {variance.times?.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table est-variance-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Proceso</th>
                    <th style={{ textAlign: 'right' }}>Estándar (min)</th>
                    <th style={{ textAlign: 'right' }}>Real prom. (min)</th>
                    <th style={{ textAlign: 'right' }}>Observaciones</th>
                    <th style={{ textAlign: 'right' }}>Δ%</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.times.map((row) => (
                    <tr key={`${row.sku}-${row.process}`}>
                      <td>{row.sku}</td>
                      <td>{PROCESS_LABEL[row.process] || row.process}</td>
                      <td style={{ textAlign: 'right' }}>{row.std_minutes !== null ? row.std_minutes : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{row.avg_minutes !== null ? row.avg_minutes : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{row.observed}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: row.delta_pct === null ? '#78716c' : Math.abs(row.delta_pct) <= 15 ? '#047857' : '#b45309' }}>
                        {row.delta_pct !== null ? `${row.delta_pct > 0 ? '+' : ''}${row.delta_pct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProductStructureAdmin;
