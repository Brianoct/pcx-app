import { useState, useEffect } from 'react';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
function ProductCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newProduct, setNewProduct] = useState({
    sku: '',
    name: '',
    sf: '',
    cf: '',
    equipment_ids: [],
    material_ids: [],
    processes: []
  });
  const [productionOptions, setProductionOptions] = useState({
    equipment_options: [],
    material_options: [],
    process_options: []
  });
  const [configModal, setConfigModal] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const visibleProducts = products.filter((row) => Boolean(row.is_active));
  const inactiveProducts = products.filter((row) => !row.is_active);

  const loadProducts = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/product-catalog?include_inactive=1', { token });
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadProductionOptions = async () => {
    try {
      const data = await apiRequest('/api/admin/product-production/options', { token });
      setProductionOptions({
        equipment_options: Array.isArray(data?.equipment_options) ? data.equipment_options : [],
        material_options: Array.isArray(data?.material_options) ? data.material_options : [],
        process_options: Array.isArray(data?.process_options) ? data.process_options : []
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  useEffect(() => {
    loadProducts();
    loadProductionOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onRowField = (sku, field, value) => {
    setProducts((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, [field]: value } : row
    )));
    setMessage('');
  };

  const toggleInArray = (items = [], value) => {
    const set = new Set(Array.isArray(items) ? items : []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set];
  };

  const toggleNewProductEquipment = (equipmentId) => {
    setNewProduct((prev) => ({
      ...prev,
      equipment_ids: toggleInArray(prev.equipment_ids, equipmentId)
    }));
  };

  const toggleNewProductMaterial = (materialId) => {
    setNewProduct((prev) => ({
      ...prev,
      material_ids: toggleInArray(prev.material_ids, materialId)
    }));
  };

  const toggleNewProductProcess = (processKey) => {
    setNewProduct((prev) => ({
      ...prev,
      processes: toggleInArray(prev.processes, processKey)
    }));
  };

  const createProduct = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        sku: String(newProduct.sku || '').toUpperCase().trim(),
        name: String(newProduct.name || '').trim(),
        sf: Number(newProduct.sf || 0),
        cf: Number(newProduct.cf || 0),
        equipment_ids: Array.isArray(newProduct.equipment_ids) ? newProduct.equipment_ids : [],
        material_ids: Array.isArray(newProduct.material_ids) ? newProduct.material_ids : [],
        processes: Array.isArray(newProduct.processes) ? newProduct.processes : []
      };
      if (!payload.sku || !payload.name) {
        throw new Error('SKU y nombre son requeridos');
      }
      if (!Number.isFinite(payload.sf) || payload.sf < 0 || !Number.isFinite(payload.cf) || payload.cf < 0) {
        throw new Error('Precios SF/CF inválidos');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Crear producto ${payload.sku}`,
          path: '/api/product-catalog',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { sku: payload.sku, name: payload.name }
        });
        setProducts((prev) => [...prev, {
          sku: payload.sku,
          name: payload.name,
          sf: payload.sf,
          cf: payload.cf,
          is_active: true
        }]);
        setMessage('Sin conexión: producto en cola para sincronizar.');
      } else {
        await apiRequest('/api/product-catalog', {
          method: 'POST',
          token,
          body: payload
        });
        setMessage('Producto agregado.');
      }
      setNewProduct({
        sku: '',
        name: '',
        sf: '',
        cf: '',
        equipment_ids: [],
        material_ids: [],
        processes: []
      });
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (row) => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name: String(row.name || '').trim(),
        sf: Number(row.sf ?? row.sf_price ?? 0),
        cf: Number(row.cf ?? row.cf_price ?? 0),
        is_active: Boolean(row.is_active)
      };
      if (!payload.name) throw new Error('Nombre requerido');
      if (!Number.isFinite(payload.sf) || payload.sf < 0 || !Number.isFinite(payload.cf) || payload.cf < 0) {
        throw new Error('Precios SF/CF inválidos');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Editar producto ${row.sku}`,
          path: `/api/product-catalog/${encodeURIComponent(row.sku)}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { sku: row.sku }
        });
        setProducts((prev) => prev.map((item) => (
          item.sku === row.sku ? { ...item, ...payload } : item
        )));
        setMessage(`Sin conexión: cambios de ${row.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        setMessage(`Producto ${row.sku} actualizado.`);
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (row) => {
    if (!window.confirm(`¿Desactivar producto ${row.sku}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar producto ${row.sku}`,
          path: `/api/product-catalog/${encodeURIComponent(row.sku)}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: { sku: row.sku }
        });
        setProducts((prev) => prev.map((item) => (
          item.sku === row.sku ? { ...item, is_active: false } : item
        )));
        setMessage(`Sin conexión: desactivación de ${row.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
          method: 'DELETE',
          token
        });
        setMessage(`Producto ${row.sku} desactivado.`);
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const openProductionConfig = async (row) => {
    if (!row?.sku) return;
    setConfigLoading(true);
    setMessage('');
    setConfigModal({
      sku: row.sku,
      equipment_ids: [],
      material_ids: [],
      processes: []
    });
    try {
      const payload = await apiRequest(`/api/admin/product-production/${encodeURIComponent(row.sku)}`, { token });
      setConfigModal({
        sku: row.sku,
        equipment_ids: Array.isArray(payload?.equipment_ids) ? payload.equipment_ids : [],
        material_ids: Array.isArray(payload?.material_ids) ? payload.material_ids : [],
        processes: Array.isArray(payload?.processes) ? payload.processes : []
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
      setConfigModal(null);
    } finally {
      setConfigLoading(false);
    }
  };

  const updateConfigSelection = (field, value) => {
    setConfigModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: toggleInArray(prev[field] || [], value)
      };
    });
  };

  const saveProductionConfig = async () => {
    if (!configModal?.sku) return;
    setConfigSaving(true);
    setMessage('');
    try {
      const payload = {
        equipment_ids: Array.isArray(configModal.equipment_ids) ? configModal.equipment_ids : [],
        material_ids: Array.isArray(configModal.material_ids) ? configModal.material_ids : [],
        processes: Array.isArray(configModal.processes) ? configModal.processes : []
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Configuración producción ${configModal.sku}`,
          path: `/api/admin/product-production/${encodeURIComponent(configModal.sku)}`,
          options: {
            method: 'PUT',
            body: payload,
            retries: 0
          },
          meta: { sku: configModal.sku }
        });
        setMessage(`Sin conexión: configuración de ${configModal.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/product-production/${encodeURIComponent(configModal.sku)}`, {
          method: 'PUT',
          token,
          body: payload
        });
        setMessage(`Configuración de producción guardada para ${configModal.sku}.`);
      }
      setConfigModal(null);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ background: '#1e293b', padding: '20px', borderRadius: '12px' }}>
        <h3 style={{ marginBottom: '12px' }}>Agregar producto al cotizador</h3>
        <form onSubmit={createProduct} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
          <input
            placeholder="SKU"
            value={newProduct.sku}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Nombre"
            value={newProduct.name}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio SF"
            value={newProduct.sf}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, sf: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio CF"
            value={newProduct.cf}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, cf: e.target.value }))}
            className="form-input form-input--inline"
          />
          <button
            type="submit"
            disabled={saving}
            style={{ border: 'none', borderRadius: '8px', background: '#3b82f6', color: 'white', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Guardando...' : 'Agregar'}
          </button>

          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10 }}>
            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Procesos</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {productionOptions.process_options.map((option) => (
                  <label key={`new-process-${option.value}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(newProduct.processes) && newProduct.processes.includes(option.value)}
                      onChange={() => toggleNewProductProcess(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                {productionOptions.process_options.length === 0 && (
                  <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>No hay procesos disponibles</span>
                )}
              </div>
            </div>

            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Equipos utilizados</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.equipment_options.map((equipment) => (
                  <label key={`new-eq-${equipment.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(newProduct.equipment_ids) && newProduct.equipment_ids.includes(equipment.id)}
                      onChange={() => toggleNewProductEquipment(equipment.id)}
                    />
                    {equipment.code} · {equipment.name}
                  </label>
                ))}
                {productionOptions.equipment_options.length === 0 && (
                  <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>No hay equipos activos. Agrégalos en la pestaña Equipos.</span>
                )}
              </div>
            </div>

            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Materiales utilizados</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.material_options.map((material) => (
                  <label key={`new-mt-${material.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(newProduct.material_ids) && newProduct.material_ids.includes(material.id)}
                      onChange={() => toggleNewProductMaterial(material.id)}
                    />
                    {material.code} · {material.name}{material.unit_measure ? ` (${material.unit_measure})` : ''}
                  </label>
                ))}
                {productionOptions.material_options.length === 0 && (
                  <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>No hay materiales activos. Agrégalos en la pestaña Materiales.</span>
                )}
              </div>
            </div>
          </div>
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
        <h3 style={{ marginBottom: '12px' }}>Productos del cotizador</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando productos...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '1040px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th style={{ textAlign: 'right' }}>SF</th>
                  <th style={{ textAlign: 'right' }}>CF</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Sin productos</td></tr>
                ) : products.map((row) => (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>
                      <input
                        value={row.name || ''}
                        onChange={(e) => onRowField(row.sku, 'name', e.target.value)}
                        className="form-input"
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.sf ?? row.sf_price ?? 0)}
                        onChange={(e) => onRowField(row.sku, 'sf', e.target.value)}
                        className="form-input" style={{ width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.cf ?? row.cf_price ?? 0)}
                        onChange={(e) => onRowField(row.sku, 'cf', e.target.value)}
                        className="form-input" style={{ width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <label className="form-check-inline">
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_active)}
                          onChange={(e) => onRowField(row.sku, 'is_active', e.target.checked)}
                        />
                        {row.is_active ? 'Sí' : 'No'}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => openProductionConfig(row)}
                          disabled={saving || configLoading}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#0ea5e9', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Producción
                        </button>
                        <button
                          onClick={() => saveProduct(row)}
                          disabled={saving}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => deleteProduct(row)}
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

      {inactiveProducts.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
          <h4 style={{ marginBottom: '8px' }}>Productos inactivos</h4>
          <p style={{ marginBottom: '10px', color: '#94a3b8' }}>
            Reactiva un producto marcando <strong>Activo</strong> y guardando.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '860px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th style={{ textAlign: 'right' }}>SF</th>
                  <th style={{ textAlign: 'right' }}>CF</th>
                  <th>Activo</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {inactiveProducts.map((row) => (
                  <tr key={`inactive-${row.sku}`}>
                    <td>{row.sku}</td>
                    <td>{row.name}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row.sf ?? row.sf_price ?? 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row.cf ?? row.cf_price ?? 0).toFixed(2)}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(row.is_active)}
                        onChange={(e) => onRowField(row.sku, 'is_active', e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => saveProduct({ ...row, is_active: true })}
                        disabled={saving}
                        style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#10b981', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                      >
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {configModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(2,6,23,0.72)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          zIndex: 1000
        }}>
          <div style={{
            width: 'min(880px, 100%)',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: '#111827',
            border: '1px solid #334155',
            borderRadius: 12,
            padding: 16,
            display: 'grid',
            gap: 12
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Configurar producción · {configModal.sku}</h3>
              {configLoading && <span style={{ color: '#93c5fd', fontSize: '0.82rem' }}>Cargando...</span>}
            </div>

            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Procesos</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {productionOptions.process_options.map((option) => (
                  <label key={`cfg-process-${option.value}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(configModal.processes) && configModal.processes.includes(option.value)}
                      onChange={() => updateConfigSelection('processes', option.value)}
                      disabled={configLoading || configSaving}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Equipos</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.equipment_options.map((equipment) => (
                  <label key={`cfg-eq-${equipment.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(configModal.equipment_ids) && configModal.equipment_ids.includes(equipment.id)}
                      onChange={() => updateConfigSelection('equipment_ids', equipment.id)}
                      disabled={configLoading || configSaving}
                    />
                    {equipment.code} · {equipment.name}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Materiales</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.material_options.map((material) => (
                  <label key={`cfg-mt-${material.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(configModal.material_ids) && configModal.material_ids.includes(material.id)}
                      onChange={() => updateConfigSelection('material_ids', material.id)}
                      disabled={configLoading || configSaving}
                    />
                    {material.code} · {material.name}{material.unit_measure ? ` (${material.unit_measure})` : ''}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setConfigModal(null)}
                disabled={configSaving}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveProductionConfig}
                disabled={configSaving || configLoading}
                style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#2563eb', color: 'white', fontWeight: 700, cursor: 'pointer' }}
              >
                {configSaving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductCatalogAdmin;
