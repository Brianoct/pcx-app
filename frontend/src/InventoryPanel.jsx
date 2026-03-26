import { useState, useEffect } from 'react';
import { buildAccessForUser, canAccessPanel } from './roleAccess';

function InventoryPanel({ token, role, access }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingMins, setSavingMins] = useState(false);
  const [originalStocks, setOriginalStocks] = useState({});
  const [originalMins, setOriginalMins] = useState({});
  const [saveMessage, setSaveMessage] = useState('');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  const effectiveAccess = buildAccessForUser(role, access);
  const canViewGlobalInventory = canAccessPanel(effectiveAccess, 'inventarioGlobal');
  const [userCity, setUserCity] = useState('');
  const cityToKey = {
    cochabamba: {
      location: 'Cochabamba',
      stockField: 'stock_cochabamba',
      minField: 'min_stock_cochabamba',
      minLabel: 'Min Cbba'
    },
    'santa cruz': {
      location: 'Santa Cruz',
      stockField: 'stock_santacruz',
      minField: 'min_stock_santacruz',
      minLabel: 'Min Scz'
    },
    santacruz: {
      location: 'Santa Cruz',
      stockField: 'stock_santacruz',
      minField: 'min_stock_santacruz',
      minLabel: 'Min Scz'
    },
    lima: {
      location: 'Lima',
      stockField: 'stock_lima',
      minField: 'min_stock_lima',
      minLabel: 'Min Lima'
    }
  };

  const normalizedCity = String(userCity || '').trim().toLowerCase();
  const individualStore = cityToKey[normalizedCity] || null;
  const visibleStores = canViewGlobalInventory
    ? [
        { field: 'stock_cochabamba', location: 'Cochabamba', minField: 'min_stock_cochabamba', minLabel: 'Min Cbba' },
        { field: 'stock_santacruz', location: 'Santa Cruz', minField: 'min_stock_santacruz', minLabel: 'Min Scz' },
        { field: 'stock_lima', location: 'Lima', minField: 'min_stock_lima', minLabel: 'Min Lima' }
      ]
    : (individualStore ? [{
      field: individualStore.stockField,
      location: individualStore.location,
      minField: individualStore.minField,
      minLabel: individualStore.minLabel
    }] : []);

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        const meRes = await fetch('http://localhost:4000/api/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!meRes.ok) {
          const meErr = await meRes.json().catch(() => ({}));
          throw new Error(meErr.error || 'No se pudo cargar sesión');
        }
        const me = await meRes.json();
        setUserCity(me.city || '');

        const res = await fetch('http://localhost:4000/api/products', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'No se pudo cargar inventario');
        }
        const data = await res.json();
        setProducts(data);
        const baseline = {};
        const minBaseline = {};
        for (const p of data) {
          baseline[p.sku] = {
            stock_cochabamba: Number(p.stock_cochabamba ?? 0),
            stock_santacruz: Number(p.stock_santacruz ?? 0),
            stock_lima: Number(p.stock_lima ?? 0)
          };
          minBaseline[p.sku] = {
            min_stock_cochabamba: Number(p.min_stock_cochabamba ?? 0),
            min_stock_santacruz: Number(p.min_stock_santacruz ?? 0),
            min_stock_lima: Number(p.min_stock_lima ?? 0)
          };
        }
        setOriginalStocks(baseline);
        setOriginalMins(minBaseline);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchInventory();
  }, [token]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleStockChange = (sku, field, value) => {
    const numValue = value === '' ? 0 : Math.max(0, Number(value));
    setSaveMessage('');
    setProducts(prev => prev.map(p => 
      p.sku === sku ? { ...p, [field]: numValue } : p
    ));
  };

  const handleMinChange = (sku, field, value) => {
    const numValue = value === '' ? 0 : Math.max(0, Number(value));
    setSaveMessage('');
    setProducts((prev) => prev.map((p) =>
      p.sku === sku ? { ...p, [field]: numValue } : p
    ));
  };

  const saveAllChanges = async () => {
    const changedProducts = products.filter((product) => {
      const base = originalStocks[product.sku];
      if (!base) return false;
      return visibleStores.some((store) => Number(product[store.field] ?? 0) !== Number(base[store.field] ?? 0));
    });

    if (changedProducts.length === 0) return;

    setSaving(true);
    setSaveMessage('');
    try {
      for (const product of changedProducts) {
        for (const store of visibleStores) {
          const new_stock = product[store.field] ?? 0;
          const base = originalStocks[product.sku];
          if (!base || Number(new_stock) === Number(base[store.field] ?? 0)) continue;

          const res = await fetch(`http://localhost:4000/api/products/${product.sku}/stock`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              store_location: store.location,
              new_stock
            })
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `No se pudo actualizar ${product.sku} en ${store.location}`);
          }
        }
      }

      const refreshedBaseline = {};
      for (const p of products) {
        refreshedBaseline[p.sku] = {
          stock_cochabamba: Number(p.stock_cochabamba ?? 0),
          stock_santacruz: Number(p.stock_santacruz ?? 0),
          stock_lima: Number(p.stock_lima ?? 0)
        };
      }
      setOriginalStocks(refreshedBaseline);
      setSaveMessage(`Se guardaron cambios de ${changedProducts.length} producto(s).`);
    } catch (err) {
      console.error(err);
      setSaveMessage(`Error al guardar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveMinimums = async () => {
    const minFields = visibleStores.map((store) => store.minField);

    const changedMinProducts = products.filter((product) => {
      const base = originalMins[product.sku];
      if (!base) return false;
      return minFields.some((field) => Number(product[field] ?? 0) !== Number(base[field] ?? 0));
    });

    if (changedMinProducts.length === 0) return;

    setSavingMins(true);
    setSaveMessage('');
    try {
      for (const product of changedMinProducts) {
        const payload = {};
        visibleStores.forEach((store) => {
          payload[store.minField] = Number(product[store.minField] ?? 0);
        });

        const res = await fetch(`http://localhost:4000/api/products/${product.sku}/min-stock`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `No se pudo actualizar mínimo de ${product.sku}`);
        }
      }

      const minBaseline = {};
      for (const p of products) {
        minBaseline[p.sku] = {
          min_stock_cochabamba: Number(p.min_stock_cochabamba ?? 0),
          min_stock_santacruz: Number(p.min_stock_santacruz ?? 0),
          min_stock_lima: Number(p.min_stock_lima ?? 0)
        };
      }
      setOriginalMins(minBaseline);
      setSaveMessage(`Se actualizaron mínimos de ${changedMinProducts.length} producto(s).`);
    } catch (err) {
      console.error(err);
      setSaveMessage(`Error al guardar mínimos: ${err.message}`);
    } finally {
      setSavingMins(false);
    }
  };

  const changedSkus = products.reduce((acc, product) => {
    const base = originalStocks[product.sku];
    if (!base) return acc;
    const changed = visibleStores.some((store) => Number(product[store.field] ?? 0) !== Number(base[store.field] ?? 0));
    if (changed) acc.push(product.sku);
    return acc;
  }, []);
  const changedSkuSet = new Set(changedSkus);

  const changedMinSkus = products.reduce((acc, product) => {
    const base = originalMins[product.sku];
    if (!base) return acc;
    const changed = visibleStores.map((store) => store.minField)
      .some((field) => Number(product[field] ?? 0) !== Number(base[field] ?? 0));
    if (changed) acc.push(product.sku);
    return acc;
  }, []);
  const changedMinSkuSet = new Set(changedMinSkus);

  const getStockLevel = (product, stockField, minField) => {
    const stock = Number(product[stockField] ?? 0);
    const min = Number(product[minField] ?? 0);
    if (stock <= 0) return 'critical';
    if (stock <= min) return 'low';
    return 'ok';
  };

  const lowOrCriticalCount = products.reduce((sum, product) => {
    const hasAlert = visibleStores
      .map((store) => [store.field, store.minField])
      .some(([stockField, minField]) => getStockLevel(product, stockField, minField) !== 'ok');
    return sum + (hasAlert ? 1 : 0);
  }, 0);

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>Cargando inventario...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;
  if (!canViewGlobalInventory && !individualStore) {
    return (
      <div className="container">
        <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
          Inventario
        </h2>
        <div className="card" style={{ textAlign: 'center', color: '#fca5a5' }}>
          Tu usuario no tiene una ciudad válida configurada para el panel de inventario individual.
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Inventario
      </h2>
      <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '14px' }}>
        Vista: {canViewGlobalInventory ? 'Global' : `Individual (${individualStore?.location || 'Ciudad no configurada'})`}
      </p>

      <div style={{
        position: 'sticky',
        top: '70px',
        zIndex: 20,
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '12px',
        marginBottom: '16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}>
        <div style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
          Cambios pendientes: <strong style={{ color: changedSkus.length > 0 ? '#f59e0b' : '#10b981' }}>{changedSkus.length}</strong>
        </div>
        <div style={{ color: '#fca5a5', fontSize: '0.9rem', fontWeight: 600 }}>
          Bajo mínimo: {lowOrCriticalCount}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={saveMinimums}
            disabled={savingMins || changedMinSkus.length === 0}
            className="btn"
            style={{
              padding: '10px 18px',
              background: savingMins || changedMinSkus.length === 0 ? '#475569' : '#f59e0b',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: savingMins || changedMinSkus.length === 0 ? 'not-allowed' : 'pointer',
              minWidth: '160px',
              fontWeight: '700'
            }}
          >
            {savingMins ? 'Guardando mínimos...' : 'Guardar mínimos'}
          </button>
          <button
            onClick={saveAllChanges}
            disabled={saving || changedSkus.length === 0}
            className="btn"
            style={{
              padding: '10px 18px',
              background: saving || changedSkus.length === 0 ? '#475569' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: saving || changedSkus.length === 0 ? 'not-allowed' : 'pointer',
              minWidth: '190px',
              fontWeight: '700'
            }}
          >
            {saving ? 'Guardando cambios...' : 'Guardar cambios de inventario'}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          color: saveMessage.startsWith('Error') ? '#fecaca' : '#bbf7d0',
          background: saveMessage.startsWith('Error') ? 'rgba(127, 29, 29, 0.35)' : 'rgba(6, 78, 59, 0.35)',
          border: saveMessage.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981'
        }}>
          {saveMessage}
        </div>
      )}

      {isMobile ? (
        <div className="mobile-cards-list">
          {products.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px 0' }}>
              No hay productos registrados.
            </p>
          ) : (
            products.map((product) => {
              const changed = changedSkuSet.has(product.sku);
              const minChanged = changedMinSkuSet.has(product.sku);
              const inputStyle = {
                width: '110px',
                padding: '8px',
                textAlign: 'center',
                borderRadius: '6px',
                border: changed ? '1px solid #f59e0b' : '1px solid #334155',
                background: '#0f172a',
                color: 'white'
              };
              const minInputStyle = {
                width: '110px',
                padding: '8px',
                textAlign: 'center',
                borderRadius: '6px',
                border: minChanged ? '1px solid #f59e0b' : '1px solid #334155',
                background: '#0f172a',
                color: '#fbbf24'
              };
              return (
                <div
                  key={product.sku}
                  className="mobile-card"
                  style={{ borderColor: changed ? '#f59e0b' : '#334155' }}
                >
                  <div className="mobile-card-header">
                    <span className="mobile-card-id">{product.sku}</span>
                    <span
                      className="mobile-card-total"
                      style={{ color: changed ? '#f59e0b' : '#10b981' }}
                    >
                      {changed ? 'Pendiente' : 'Guardado'}
                    </span>
                  </div>

                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Producto</span>
                      <span style={{ textAlign: 'right' }}>{product.name}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{visibleStores[0]?.location || '—'}</span>
                      <div style={{ display: 'grid', gap: '6px', justifyItems: 'end' }}>
                        <input
                          type="number"
                          min="0"
                          value={product[visibleStores[0]?.field] ?? 0}
                          onChange={(e) => handleStockChange(product.sku, visibleStores[0]?.field, e.target.value)}
                          style={{
                            ...inputStyle,
                            borderColor: getStockLevel(product, visibleStores[0]?.field, visibleStores[0]?.minField) === 'ok' ? inputStyle.border : '#ef4444',
                            color: getStockLevel(product, visibleStores[0]?.field, visibleStores[0]?.minField) === 'ok' ? 'white' : '#fecaca'
                          }}
                        />
                        <input
                          type="number"
                          min="0"
                          value={product[visibleStores[0]?.minField] ?? 0}
                          onChange={(e) => handleMinChange(product.sku, visibleStores[0]?.minField, e.target.value)}
                          style={minInputStyle}
                          placeholder="Mín"
                        />
                      </div>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Actualizado</span>
                      <span>
                        {product.last_updated
                          ? new Date(product.last_updated).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: '1400px',
            tableLayout: 'fixed'
          }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                <th style={{ padding: '14px 12px', width: '100px', textAlign: 'center' }}>SKU</th>
                <th style={{ padding: '14px 12px', width: '280px', textAlign: 'center' }}>Producto</th>
                {visibleStores.map((store) => (
                  <th key={`${store.location}-stock`} style={{ padding: '14px 12px', width: '130px', textAlign: 'center' }}>{store.location}</th>
                ))}
                {visibleStores.map((store) => (
                  <th key={`${store.location}-min`} style={{ padding: '14px 12px', width: '120px', textAlign: 'center' }}>{store.minLabel}</th>
                ))}
                <th style={{ padding: '14px 12px', width: '180px', textAlign: 'center' }}>Última actualización</th>
                <th style={{ padding: '14px 12px', width: '120px', textAlign: 'center' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={2 + (visibleStores.length * 2) + 2} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                    No hay productos registrados.
                  </td>
                </tr>
              ) : (
                products.map(product => (
                  <tr key={product.sku} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '14px 12px', textAlign: 'center' }}>{product.sku}</td>
                    <td style={{ padding: '14px 12px' }}>{product.name}</td>

                    {visibleStores.map((store) => (
                      <td key={`${product.sku}-${store.location}-stock`} style={{ padding: '14px 12px', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          value={product[store.field] ?? 0}
                          onChange={(e) => handleStockChange(product.sku, store.field, e.target.value)}
                          style={{
                            width: '90px',
                            padding: '8px',
                            textAlign: 'center',
                            borderRadius: '6px',
                            border: getStockLevel(product, store.field, store.minField) === 'ok'
                              ? (changedSkuSet.has(product.sku) ? '1px solid #f59e0b' : '1px solid #334155')
                              : '1px solid #ef4444',
                            background: '#0f172a',
                            color: getStockLevel(product, store.field, store.minField) === 'ok' ? 'white' : '#fecaca'
                          }}
                        />
                      </td>
                    ))}
                    {visibleStores.map((store) => (
                      <td key={`${product.sku}-${store.location}-min`} style={{ padding: '14px 12px', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          value={product[store.minField] ?? 0}
                          onChange={(e) => handleMinChange(product.sku, store.minField, e.target.value)}
                          style={{
                            width: '90px',
                            padding: '8px',
                            textAlign: 'center',
                            borderRadius: '6px',
                            border: changedMinSkuSet.has(product.sku) ? '1px solid #f59e0b' : '1px solid #334155',
                            background: '#0f172a',
                            color: '#fbbf24'
                          }}
                        />
                      </td>
                    ))}

                    <td style={{ padding: '14px 12px', textAlign: 'center', color: '#94a3b8' }}>
                      {product.last_updated 
                        ? new Date(product.last_updated).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
                        : '—'}
                    </td>

                    <td style={{ padding: '14px 12px', textAlign: 'center', color: changedSkuSet.has(product.sku) || changedMinSkuSet.has(product.sku) ? '#f59e0b' : '#10b981', fontWeight: '700' }}>
                      {changedSkuSet.has(product.sku) || changedMinSkuSet.has(product.sku) ? 'Pendiente' : 'Guardado'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default InventoryPanel;