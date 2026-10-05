import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

// Mismo modelo que el backend (lib/equipmentCost.js): el equipo cuesta
// Bs/hora = (reposición/vida útil + extra mensual) / horas disponibles por
// mes, y cada paso carga Bs/hora × sus minutos estándar por pieza.
const equipmentHourlyCost = (equipment) => {
  if (!equipment) return 0;
  const hours = Number(equipment.monthly_capacity_units || 0);
  if (hours <= 0) return 0;
  const life = Number(equipment.useful_life_months || 0);
  const depreciation = life > 0 ? Number(equipment.replacement_cost_bs || 0) / life : 0;
  return (depreciation + Number(equipment.monthly_extra_cost_bs || 0)) / hours;
};
const equipmentCostForMinutes = (equipment, minutes) => equipmentHourlyCost(equipment) * ((Number(minutes) || 0) / 60);
const equipmentHasHours = (equipment) => Boolean(equipment) && Number(equipment.monthly_capacity_units || 0) > 0;

// Tanda: std_minutes son minutos de máquina por corrida; pieces_per_run las
// piezas que salen de cada corrida; attended_minutes los minutos de operador
// por corrida (vacío = atiende toda la corrida). Por pieza:
//   máquina = std / piezas · operador = (attended ?? std) / piezas
const stepMinutes = (step) => {
  const std = Number(step.std_minutes) || 0;
  const pieces = Math.max(1, Number.parseInt(step.pieces_per_run, 10) || 1);
  const attended = step.attended_minutes === '' || step.attended_minutes === null || step.attended_minutes === undefined
    ? std
    : Number(step.attended_minutes) || 0;
  return { std, pieces, machine: std / pieces, labor: attended / pieces, batched: pieces > 1 || step.attended_minutes !== '' };
};

// Dónde se consume un material por defecto, según su nombre y la ruta:
// pintura/polvo → pintado; el resto → primer proceso que arranca la pieza
// (impresión, láser, punzonado) o el primer paso de la ruta.
const isPaintMaterial = (cat) => /pintura|polvo|powder|^PP\d/i.test(`${cat?.code || ''} ${cat?.name || ''}`);
const defaultConsumeProcess = (cat, routeProcesses) => {
  if (!routeProcesses.length) return '';
  if (isPaintMaterial(cat) && routeProcesses.includes('pintado')) return 'pintado';
  return ['impresion_3d', 'corte_laser', 'punzonado'].find((p) => routeProcesses.includes(p)) || routeProcesses[0];
};

function ProductStructureAdmin({ token }) {
  const toast = useToast();
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [materialsCatalog, setMaterialsCatalog] = useState([]);
  const [laborRate, setLaborRate] = useState('0');
  const [samplingRate, setSamplingRate] = useState('25');
  const [leaderPct, setLeaderPct] = useState('15');
  const [sellerPct, setSellerPct] = useState('10');
  const [savingRate, setSavingRate] = useState(false);
  // Encargado y Bs/hora por proceso (sin tarifa propia → usa la general).
  const [processRates, setProcessRates] = useState([]);
  const [rateUsers, setRateUsers] = useState([]);
  const [savingProcessRates, setSavingProcessRates] = useState(false);
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
        const [costingRows, equipos, materiales, settings, varianceData, ratesData] = await Promise.all([
          apiRequest('/api/product-costing', { token }),
          apiRequest('/api/admin/equipos', { token }),
          apiRequest('/api/admin/materiales', { token }),
          apiRequest('/api/production/settings', { token }),
          apiRequest('/api/production/variance', { token }).catch(() => null),
          apiRequest('/api/production/process-rates', { token }).catch(() => null)
        ]);
        if (!active) return;
        setProcessRates(Array.isArray(ratesData?.rates) ? ratesData.rates.map((r) => ({
          process: r.process,
          owner_user_id: r.owner_user_id ?? '',
          rate_bs_hour: r.rate_bs_hour ?? ''
        })) : []);
        setRateUsers(Array.isArray(ratesData?.users) ? ratesData.users : []);
        setProducts((Array.isArray(costingRows) ? costingRows : []).map((r) => ({ sku: r.sku, name: r.name })));
        setEquipment(Array.isArray(equipos) ? equipos : []);
        setMaterialsCatalog(Array.isArray(materiales) ? materiales : []);
        setLaborRate(String(settings?.labor_rate_bs_hour ?? 0));
        setSamplingRate(String(settings?.sampling_rate_pct ?? 25));
        setLeaderPct(String(settings?.commission_leader_pct ?? 15));
        setSellerPct(String(settings?.commission_seller_pct ?? 10));
        setVariance(varianceData);
      } catch (err) {
        if (active) setError(err.message || 'No se pudieron cargar catálogos');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  // Deep link desde Productos: /admin?tab=estructura&sku=XXX abre ese producto.
  useEffect(() => {
    if (loading) return;
    const sku = String(new URLSearchParams(location.search).get('sku') || '').trim().toUpperCase();
    if (sku && sku !== selectedSku && products.some((p) => p.sku === sku)) loadStructure(sku);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, location.search, products]);

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
          equipment_id: s.equipment_id ?? '',
          pieces_per_run: s.pieces_per_run ?? 1,
          attended_minutes: s.attended_minutes ?? '',
          batch_open: (Number(s.pieces_per_run) || 1) > 1 || (s.attended_minutes !== null && s.attended_minutes !== undefined)
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
          sampling_rate_pct: Number.parseInt(samplingRate, 10) || 0,
          commission_leader_pct: Number(leaderPct) || 0,
          commission_seller_pct: Number(sellerPct) || 0
        }
      });
      setLaborRate(String(data?.labor_rate_bs_hour ?? laborRate));
      setSamplingRate(String(data?.sampling_rate_pct ?? samplingRate));
      setLeaderPct(String(data?.commission_leader_pct ?? leaderPct));
      setSellerPct(String(data?.commission_seller_pct ?? sellerPct));
      toast.success('Configuración de producción guardada');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo guardar la configuración'));
    } finally {
      setSavingRate(false);
    }
  };

  const updateProcessRate = (process, patch) => {
    setProcessRates((prev) => prev.map((r) => (r.process === process ? { ...r, ...patch } : r)));
  };

  const saveProcessRatesNow = async () => {
    setSavingProcessRates(true);
    try {
      const data = await apiRequest('/api/production/process-rates', {
        method: 'PUT',
        token,
        body: {
          rates: processRates.map((r) => ({
            process: r.process,
            owner_user_id: r.owner_user_id === '' ? null : Number(r.owner_user_id),
            rate_bs_hour: r.rate_bs_hour === '' ? null : Number(r.rate_bs_hour)
          }))
        }
      });
      setProcessRates((Array.isArray(data?.rates) ? data.rates : []).map((r) => ({
        process: r.process,
        owner_user_id: r.owner_user_id ?? '',
        rate_bs_hour: r.rate_bs_hour ?? ''
      })));
      toast.success('Tarifas por proceso guardadas');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudieron guardar las tarifas'));
    } finally {
      setSavingProcessRates(false);
    }
  };

  // Tarifa efectiva de un proceso: la propia o la general.
  const rateFor = (process) => {
    const own = processRates.find((r) => r.process === process)?.rate_bs_hour;
    return own !== '' && own !== null && own !== undefined ? Number(own) : (Number(laborRate) || 0);
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
      return { ...prev, steps: [...prev.steps, { process: nextProcess.value, std_minutes: '', equipment_id: '', pieces_per_run: 1, attended_minutes: '', batch_open: false }] };
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
      const route = prev.steps.map((st) => st.process);
      return { ...prev, materials: [...prev.materials, { material_id: Number(nextMaterial.id), qty_per_unit: 0, process: defaultConsumeProcess(nextMaterial, route), powder_open: false }] };
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
    const equipmentByStep = structure.steps.map((s) => {
      const eq = equipmentById.get(Number(s.equipment_id)) || null;
      const mins = stepMinutes(s);
      return {
        process: s.process,
        minutes: Number(mins.machine.toFixed(2)),
        equipment: eq,
        rate: equipmentHourlyCost(eq),
        missingHours: Boolean(eq) && !equipmentHasHours(eq),
        cost: equipmentCostForMinutes(eq, mins.machine)
      };
    });
    const equipmentCost = equipmentByStep.reduce((sum, s) => sum + s.cost, 0);
    const totalMinutes = structure.steps.reduce((sum, s) => sum + stepMinutes(s).machine, 0);
    // Mano de obra = Σ minutos de OPERADOR por pieza × tarifa de su proceso (o la general).
    const laborByStep = structure.steps.map((s) => ({
      process: s.process,
      minutes: Number(stepMinutes(s).labor.toFixed(2)),
      rate: rateFor(s.process),
      cost: (stepMinutes(s).labor / 60) * rateFor(s.process)
    }));
    const laborCost = laborByStep.reduce((sum, s) => sum + s.cost, 0);
    const computedCost = materialsCost + equipmentCost + laborCost;
    return {
      materialsCost,
      equipmentCost,
      equipmentByStep,
      equipmentMissingHours: [...new Set(equipmentByStep.filter((s) => s.missingHours).map((s) => s.equipment.name))],
      laborCost,
      laborByStep,
      usesGlobalRate: laborByStep.some((s) => s.minutes > 0 && s.rate === rate && !processRates.find((r) => r.process === s.process && r.rate_bs_hour !== '')),
      totalMinutes,
      computedCost,
      computedPrice: computedCost + structure.utility
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, materialById, equipmentById, laborRate, processRates]);

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
          equipment_id: s.equipment_id === '' ? null : Number(s.equipment_id),
          pieces_per_run: Math.max(1, Number.parseInt(s.pieces_per_run, 10) || 1),
          attended_minutes: s.attended_minutes === '' ? null : Number(s.attended_minutes)
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
          <label className="est-rate-label" title="Suma de los roles a % del ingreso total (Marketing, Ventas líder, Admin, Producción 1 y 2)">
            Comisión liderazgo (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={leaderPct}
              onChange={(e) => setLeaderPct(e.target.value)}
            />
          </label>
          <label className="est-rate-label" title="Comisión del vendedor sobre sus propias ventas (10% top seller, 8% resto — usa el caso conservador)">
            Comisión vendedor (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={sellerPct}
              onChange={(e) => setSellerPct(e.target.value)}
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

      {/* Tiempos y tarifas por proceso */}
      {processRates.length > 0 && (
        <div className="card est-rates-card">
          <div className="est-section-head">
            <div>
              <h4 className="est-section-title">Encargado y tarifa por proceso</h4>
              <p className="est-rates-hint">
                Cada estación tiene una persona a cargo y su costo por hora. El costeo suma los minutos por pieza de cada
                paso × la tarifa de su proceso; si un proceso no tiene tarifa usa la general ({money(Number(laborRate) || 0)}/h).
                Los minutos por pieza se definen en la ruta de cada producto; el tablero los usa para estimar el trabajo de cada lote.
              </p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={saveProcessRatesNow} disabled={savingProcessRates}>
              {savingProcessRates ? 'Guardando…' : 'Guardar tarifas'}
            </button>
          </div>
          <div className="est-rates-grid">
            {processRates.map((row) => (
              <div key={row.process} className="est-rate-row">
                <span className="est-rate-process">{PROCESS_LABEL[row.process] || row.process}</span>
                <select
                  value={row.owner_user_id}
                  onChange={(e) => updateProcessRate(row.process, { owner_user_id: e.target.value })}
                  aria-label={`Encargado de ${PROCESS_LABEL[row.process] || row.process}`}
                >
                  <option value="">— Sin encargado —</option>
                  {rateUsers.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ''}</option>)}
                </select>
                <label className="est-rate-input">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder={String(Number(laborRate) || 0)}
                    value={row.rate_bs_hour}
                    onChange={(e) => updateProcessRate(row.process, { rate_bs_hour: e.target.value })}
                    aria-label={`Bs por hora de ${PROCESS_LABEL[row.process] || row.process}`}
                  />
                  <span>Bs/h</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <div>
                    <h4 className="est-section-title">Ruta de procesos — {structure.name}</h4>
                    <p className="est-rates-hint" style={{ margin: '2px 0 0' }}>
                      Minutos = tiempo estándar por <strong>una pieza</strong> en esa estación. Mano de obra = min × tarifa del proceso; equipo = min × Bs/hora del equipo.
                    </p>
                  </div>
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
                      <label className="est-minutes-wrap" title={step.batch_open
                        ? 'Minutos de máquina por TANDA (una plancha de impresión, una plancha de láser). Se divide entre las piezas por tanda.'
                        : 'Minutos estándar que UNA pieza ocupa en esta estación (no el lote completo ni el reloj de pared). Con ellos se calcula mano de obra y equipo, y el tablero estima el trabajo de cada lote.'}>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="0"
                          value={step.std_minutes}
                          onChange={(e) => updateStep(index, { std_minutes: e.target.value })}
                          className="est-minutes"
                        />
                        <span>{step.batch_open ? 'min/tanda' : 'min/pza'}</span>
                      </label>
                      <button
                        type="button"
                        className={`est-batch-toggle ${step.batch_open ? 'is-on' : ''}`}
                        title="Por tanda: la máquina saca varias piezas de una corrida (plancha de impresión 3D, plancha de láser) y el operador no la atiende todo el tiempo"
                        onClick={() => updateStep(index, step.batch_open
                          ? { batch_open: false, pieces_per_run: 1, attended_minutes: '' }
                          : { batch_open: true })}
                      >
                        {step.batch_open ? '▾ tanda' : '▸ tanda'}
                      </button>
                      <select
                        value={step.equipment_id}
                        onChange={(e) => updateStep(index, { equipment_id: e.target.value })}
                        aria-label="Equipo"
                        className="est-equip"
                      >
                        <option value="">Sin equipo</option>
                        {equipment.map((eq) => (
                          <option key={eq.id} value={eq.id}>{eq.name}{equipmentHasHours(eq) ? ` · ${equipmentHourlyCost(eq).toFixed(2)} Bs/h` : ' · ⚠ sin horas'}</option>
                        ))}
                      </select>
                      <div className="est-row-actions">
                        <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="Subir">↑</button>
                        <button type="button" onClick={() => moveStep(index, 1)} disabled={index === structure.steps.length - 1} aria-label="Bajar">↓</button>
                        <button type="button" className="is-danger" onClick={() => removeStep(index)} aria-label="Quitar">✕</button>
                      </div>
                      {step.batch_open && (() => {
                        const mins = stepMinutes(step);
                        return (
                          <div className="est-batch-row">
                            <label title="Piezas que salen de cada tanda (p. ej. 6 bandejas por plancha de impresión, 12 piezas por plancha de láser)">
                              <input
                                type="number" min="1" step="1"
                                value={step.pieces_per_run}
                                onChange={(e) => updateStep(index, { pieces_per_run: e.target.value })}
                              />
                              <span>pzas/tanda</span>
                            </label>
                            <label title="Minutos que el operador dedica a cada tanda (cargar, descargar, revisar). Vacío = atiende toda la tanda.">
                              <input
                                type="number" min="0" step="0.5"
                                placeholder={String(mins.std)}
                                value={step.attended_minutes}
                                onChange={(e) => updateStep(index, { attended_minutes: e.target.value })}
                              />
                              <span>min operador/tanda</span>
                            </label>
                            <em>= máquina {mins.machine.toFixed(2)} min/pza · operador {mins.labor.toFixed(2)} min/pza</em>
                          </div>
                        );
                      })()}
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
                      const rawCost = cat ? Number(material.qty_per_unit || 0) * Number(cat.unit_cost_bs || 0) : 0;
                      const wasteCost = cat ? rawCost * (Number(cat.waste_pct || 0) / 100) : 0;
                      const lineCost = rawCost + wasteCost;
                      const powderable = cat && isPaintMaterial(cat) && /kg/i.test(cat.unit_measure || '');
                      const applyPowder = () => {
                        const area = Number(material.powder_area) || 0;
                        const sides = Number(material.powder_sides) || 1;
                        const coverage = Number(material.powder_coverage) || 0.24;
                        updateMaterial(index, { qty_per_unit: Number((area * sides * coverage).toFixed(4)), powder_open: false });
                      };
                      return (
                        <div key={`${material.material_id}-${index}`} className="est-material-row">
                          <select
                            value={material.material_id}
                            onChange={(e) => {
                              const next = materialById.get(Number(e.target.value));
                              updateMaterial(index, { material_id: Number(e.target.value), process: material.process || defaultConsumeProcess(next, routeProcesses) });
                            }}
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
                            className={`est-material-process ${material.process ? '' : 'is-missing'}`}
                            title={material.process ? 'Proceso donde se consume este material' : 'Falta el proceso donde se consume: el muestreo de consumo real no sabrá cuándo pedir la medición'}
                          >
                            <option value="">⚠ Proceso…</option>
                            {routeProcesses.map((p) => (
                              <option key={p} value={p}>{PROCESS_LABEL[p] || p}</option>
                            ))}
                          </select>
                          <span className="est-line-cost" title={cat ? `${Number(material.qty_per_unit || 0)} ${cat.unit_measure} × ${Number(cat.unit_cost_bs || 0).toFixed(2)} Bs = ${money(rawCost)} + merma ${Number(cat.waste_pct || 0)}% = ${money(wasteCost)}` : ''}>
                            {money(lineCost)}
                            {wasteCost > 0 && <small>{money(rawCost)} + {money(wasteCost)} merma</small>}
                          </span>
                          <div className="est-row-actions">
                            {powderable && (
                              <button type="button" title="Calcular kg de pintura en polvo: área × caras × kg/m²" onClick={() => updateMaterial(index, { powder_open: !material.powder_open, powder_area: material.powder_area ?? '', powder_sides: material.powder_sides ?? 1, powder_coverage: material.powder_coverage ?? 0.24 })}>⚖</button>
                            )}
                            <button type="button" className="is-danger" onClick={() => removeMaterial(index)} aria-label="Quitar">✕</button>
                          </div>
                          {powderable && material.powder_open && (
                            <div className="est-batch-row est-powder">
                              <label title="Área de la pieza por cara, en m² (descontando agujeros si quieres afinar)"><input type="number" min="0" step="0.001" value={material.powder_area} onChange={(e) => updateMaterial(index, { powder_area: e.target.value })} /><span>m² por cara</span></label>
                              <label title="Caras pintadas (1 o 2)"><input type="number" min="1" max="2" step="1" value={material.powder_sides} onChange={(e) => updateMaterial(index, { powder_sides: e.target.value })} /><span>caras</span></label>
                              <label title="Consumo de polvo por m² (0.24 kg/m² es la estimación actual; reemplázalo cuando peses una tanda)"><input type="number" min="0" step="0.01" value={material.powder_coverage} onChange={(e) => updateMaterial(index, { powder_coverage: e.target.value })} /><span>kg/m²</span></label>
                              <em>= {((Number(material.powder_area) || 0) * (Number(material.powder_sides) || 1) * (Number(material.powder_coverage) || 0)).toFixed(4)} kg</em>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={applyPowder}>Usar</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {preview && (
                <div className="card est-costing">
                  <h4 className="est-section-title" style={{ marginBottom: '10px' }}>Costo derivado</h4>
                  {preview.equipmentMissingHours.length > 0 && (
                    <div className="est-warn">
                      ⚠ Equipos sin horas por mes (aportan 0 al costo): <strong>{preview.equipmentMissingHours.join(', ')}</strong>. Cárgalas en Admin → Equipos.
                    </div>
                  )}
                  {structure.currentPrice > 0 && preview.computedCost > structure.currentPrice && (
                    <div className="est-warn is-danger">
                      ⚠ El costo derivado ({money(preview.computedCost)}) supera el precio sin factura ({money(structure.currentPrice)}). Revisa minutos por pieza, cantidades del BOM o el precio.
                    </div>
                  )}
                  <div className="est-cost-grid">
                    <div><span>Materiales</span><strong>{money(preview.materialsCost)}</strong></div>
                    <div title={preview.equipmentByStep.filter((s) => s.equipment).map((s) => `${PROCESS_LABEL[s.process] || s.process}: ${s.equipment.name} ${s.missingHours ? 'sin horas/mes → 0' : `${s.rate.toFixed(2)} Bs/h × ${s.minutes} min = ${money(s.cost)}`}`).join('\n') || 'Sin equipos en la ruta'}>
                      <span>Equipos (Bs/h × {preview.totalMinutes.toFixed(1)} min máquina)</span>
                      <strong>{money(preview.equipmentCost)}</strong>
                    </div>
                    <div title={preview.laborByStep.filter((s) => s.minutes > 0).map((s) => `${PROCESS_LABEL[s.process] || s.process}: ${s.minutes} min × ${s.rate} Bs/h = ${money(s.cost)}`).join('\n')}>
                      <span>Mano de obra (operador · por proceso)</span>
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
            Tiempo real = minutos que el lote estuvo en la estación ÷ piezas del lote (mediana de 90 días; estancias de más de 7 días se descartan). Es reloj de pared: incluye esperas, así que suele superar al estándar.
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
                    <th style={{ textAlign: 'right' }}>Estándar (min/pza)</th>
                    <th style={{ textAlign: 'right' }}>Real mediana (min/pza)</th>
                    <th style={{ textAlign: 'right' }}>Lotes</th>
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
