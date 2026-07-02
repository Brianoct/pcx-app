import { useState, useEffect } from 'react';
import { buildAccessForUser, canAccessPanel } from './roleAccess';
import { sortProductsByCatalogOrder } from './productCatalog';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';

function InventoryPanel({ token, role, access }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingMins, setSavingMins] = useState(false);
  const [originalStocks, setOriginalStocks] = useState({});
  const [originalMins, setOriginalMins] = useState({});
  const [saveMessage, setSaveMessage] = useState('');
  const [globalStoreView, setGlobalStoreView] = useState('all');
  const [search, setSearch] = useState('');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const { isOnline, enqueueWrite } = useOutbox();

  const effectiveAccess = buildAccessForUser(role, access);
  const canViewGlobalInventory = canAccessPanel(effectiveAccess, 'inventarioGlobal');
  const [userCity, setUserCity] = useState('');
  const globalStores = [
    { key: 'cochabamba', field: 'stock_cochabamba', location: 'Cochabamba', minField: 'min_stock_cochabamba', maxField: 'max_stock_cochabamba', minLabel: 'Min/Max Cbba' },
    { key: 'santacruz', field: 'stock_santacruz', location: 'Santa Cruz', minField: 'min_stock_santacruz', maxField: 'max_stock_santacruz', minLabel: 'Min/Max Scz' },
    { key: 'lima', field: 'stock_lima', location: 'Lima', minField: 'min_stock_lima', maxField: 'max_stock_lima', minLabel: 'Min/Max Lima' }
  ];
  const cityToKey = {
    cochabamba: {
      key: 'cochabamba',
      location: 'Cochabamba',
      stockField: 'stock_cochabamba',
      minField: 'min_stock_cochabamba',
      maxField: 'max_stock_cochabamba',
      minLabel: 'Min/Max Cbba'
    },
    'santa cruz': {
      key: 'santacruz',
      location: 'Santa Cruz',
      stockField: 'stock_santacruz',
      minField: 'min_stock_santacruz',
      maxField: 'max_stock_santacruz',
      minLabel: 'Min/Max Scz'
    },
    santacruz: {
      key: 'santacruz',
      location: 'Santa Cruz',
      stockField: 'stock_santacruz',
      minField: 'min_stock_santacruz',
      maxField: 'max_stock_santacruz',
      minLabel: 'Min/Max Scz'
    },
    lima: {
      key: 'lima',
      location: 'Lima',
      stockField: 'stock_lima',
      minField: 'min_stock_lima',
      maxField: 'max_stock_lima',
      minLabel: 'Min/Max Lima'
    }
  };

  const normalizedCity = String(userCity || '').trim().toLowerCase();
  const individualStore = cityToKey[normalizedCity] || null;
  const storesForView = canViewGlobalInventory
    ? (
      globalStoreView === 'all'
        ? globalStores
        : globalStores.filter((store) => store.key === globalStoreView)
    )
    : [];
  const visibleStores = canViewGlobalInventory
    ? storesForView
    : (individualStore ? [{
      key: individualStore.key,
      field: individualStore.stockField,
      location: individualStore.location,
      minField: individualStore.minField,
      maxField: individualStore.maxField,
      minLabel: individualStore.minLabel
    }] : []);
  const editableStores = canViewGlobalInventory ? globalStores : visibleStores;

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        const me = await apiRequest('/api/me', { token });
        setUserCity(me.city || '');

        const data = await apiRequest('/api/products', { token });
        const orderedData = sortProductsByCatalogOrder(data);
        setProducts(orderedData);
        const baseline = {};
        const minBaseline = {};
        for (const p of orderedData) {
          baseline[p.sku] = {
            stock_cochabamba: Number(p.stock_cochabamba ?? 0),
            stock_santacruz: Number(p.stock_santacruz ?? 0),
            stock_lima: Number(p.stock_lima ?? 0)
          };
          minBaseline[p.sku] = {
            min_stock_cochabamba: Number(p.min_stock_cochabamba ?? 0),
            min_stock_santacruz: Number(p.min_stock_santacruz ?? 0),
            min_stock_lima: Number(p.min_stock_lima ?? 0),
            max_stock_cochabamba: Number(p.max_stock_cochabamba ?? 0),
            max_stock_santacruz: Number(p.max_stock_santacruz ?? 0),
            max_stock_lima: Number(p.max_stock_lima ?? 0)
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
      return editableStores.some((store) => Number(product[store.field] ?? 0) !== Number(base[store.field] ?? 0));
    });

    if (changedProducts.length === 0) return;

    setSaving(true);
    setSaveMessage('');
    try {
      for (const product of changedProducts) {
        for (const store of editableStores) {
          const new_stock = product[store.field] ?? 0;
          const base = originalStocks[product.sku];
          if (!base || Number(new_stock) === Number(base[store.field] ?? 0)) continue;

          if (!isOnline) {
            enqueueWrite({
              label: `Stock ${product.sku} (${store.location})`,
              path: `/api/products/${product.sku}/stock`,
              options: {
                method: 'PATCH',
                token,
                body: {
                  store_location: store.location,
                  new_stock
                },
                retries: 0
              },
              meta: {
                sku: product.sku,
                storeLocation: store.location,
                newStock: Number(new_stock)
              }
            });
            continue;
          }

          await apiRequest(`/api/products/${product.sku}/stock`, {
            method: 'PATCH',
            token,
            body: {
              store_location: store.location,
              new_stock
            }
          });
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
      if (!isOnline) {
        setSaveMessage(`Sin conexión: se encolaron cambios de inventario para ${changedProducts.length} producto(s).`);
      } else {
        setSaveMessage(`Se guardaron cambios de ${changedProducts.length} producto(s).`);
      }
    } catch (err) {
      console.error(err);
      setSaveMessage(`Error al guardar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveMinimums = async () => {
    const levelFields = editableStores.flatMap((store) => [store.minField, store.maxField]);

    const changedMinProducts = products.filter((product) => {
      const base = originalMins[product.sku];
      if (!base) return false;
      return levelFields.some((field) => Number(product[field] ?? 0) !== Number(base[field] ?? 0));
    });

    if (changedMinProducts.length === 0) return;

    setSavingMins(true);
    setSaveMessage('');
    try {
      for (const product of changedMinProducts) {
        const payload = {};
        editableStores.forEach((store) => {
          payload[store.minField] = Number(product[store.minField] ?? 0);
          payload[store.maxField] = Number(product[store.maxField] ?? 0);
        });

        if (!isOnline) {
          enqueueWrite({
            label: `Niveles min/max ${product.sku}`,
            path: `/api/products/${product.sku}/min-stock`,
            options: {
              method: 'PATCH',
              token,
              body: payload,
              retries: 0
            },
            meta: {
              sku: product.sku,
              minFields: payload
            }
          });
          continue;
        }

        await apiRequest(`/api/products/${product.sku}/min-stock`, {
          method: 'PATCH',
          token,
          body: payload
        });
      }

      const minBaseline = {};
      for (const p of products) {
        minBaseline[p.sku] = {
          min_stock_cochabamba: Number(p.min_stock_cochabamba ?? 0),
          min_stock_santacruz: Number(p.min_stock_santacruz ?? 0),
          min_stock_lima: Number(p.min_stock_lima ?? 0),
          max_stock_cochabamba: Number(p.max_stock_cochabamba ?? 0),
          max_stock_santacruz: Number(p.max_stock_santacruz ?? 0),
          max_stock_lima: Number(p.max_stock_lima ?? 0)
        };
      }
      setOriginalMins(minBaseline);
      if (!isOnline) {
        setSaveMessage(`Sin conexión: se encolaron niveles de ${changedMinProducts.length} producto(s).`);
      } else {
        setSaveMessage(`Se actualizaron niveles min/max de ${changedMinProducts.length} producto(s).`);
      }
    } catch (err) {
      console.error(err);
      setSaveMessage(`Error al guardar niveles: ${err.message}`);
    } finally {
      setSavingMins(false);
    }
  };

  const changedSkus = products.reduce((acc, product) => {
    const base = originalStocks[product.sku];
    if (!base) return acc;
    const changed = editableStores.some((store) => Number(product[store.field] ?? 0) !== Number(base[store.field] ?? 0));
    if (changed) acc.push(product.sku);
    return acc;
  }, []);
  const changedSkuSet = new Set(changedSkus);

  const changedMinSkus = products.reduce((acc, product) => {
    const base = originalMins[product.sku];
    if (!base) return acc;
    const changed = editableStores.flatMap((store) => [store.minField, store.maxField])
      .some((field) => Number(product[field] ?? 0) !== Number(base[field] ?? 0));
    if (changed) acc.push(product.sku);
    return acc;
  }, []);
  const changedMinSkuSet = new Set(changedMinSkus);

  const getStockLevel = (product, stockField, minField, maxField) => {
    const stock = Number(product[stockField] ?? 0);
    const min = Number(product[minField] ?? 0);
    const max = Number(product[maxField] ?? 0);
    if (stock <= 0) return 'critical';
    if (stock <= min) return 'low';
    if (max > 0 && stock > max) return 'over';
    return 'ok';
  };

  const lowOrCriticalCount = products.reduce((sum, product) => {
    const hasAlert = visibleStores
      .some((store) => ['critical', 'low'].includes(getStockLevel(product, store.field, store.minField, store.maxField)));
    return sum + (hasAlert ? 1 : 0);
  }, 0);

  // Stock above max = capital sitting on the shelf; worth surfacing.
  const overstockCount = products.reduce((sum, product) => {
    const isOver = visibleStores
      .some((store) => getStockLevel(product, store.field, store.minField, store.maxField) === 'over');
    return sum + (isOver ? 1 : 0);
  }, 0);

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#78716c' }}>Cargando inventario...</div>;
  if (error) return <div style={{ color: '#dc2626', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;
  if (!canViewGlobalInventory && !individualStore) {
    return (
      <div className="container">
        <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#dc2626' }}>
          Inventario
        </h2>
        <div className="card" style={{ textAlign: 'center', color: '#dc2626' }}>
          Tu usuario no tiene una ciudad válida configurada para el panel de inventario individual.
        </div>
      </div>
    );
  }

  const productHasAlert = (product) => visibleStores
    .some((store) => getStockLevel(product, store.field, store.minField, store.maxField) !== 'ok');

  const searchTerm = search.trim().toLowerCase();
  const visibleProducts = products.filter((product) => {
    if (searchTerm && !`${product.sku} ${product.name || ''}`.toLowerCase().includes(searchTerm)) return false;
    if (alertsOnly && !productHasAlert(product)) return false;
    return true;
  });

  const levelChip = (level) => {
    if (level === 'critical') return <span className="inv-chip is-critical">Sin stock</span>;
    if (level === 'low') return <span className="inv-chip is-low">Bajo mín</span>;
    if (level === 'over') return <span className="inv-chip is-over">Sobre máx</span>;
    return <span className="inv-chip is-ok">OK</span>;
  };

  const worstLevel = (levels) => (
    levels.includes('critical') ? 'critical'
      : levels.includes('low') ? 'low'
        : levels.includes('over') ? 'over'
          : 'ok'
  );

  const renderTriplet = (product, store, level) => (
    <>
      <input
        type="number"
        min="0"
        className={`inv-input inv-input-stock is-${level}`}
        value={product[store.field] ?? 0}
        onChange={(e) => handleStockChange(product.sku, store.field, e.target.value)}
        aria-label={`Stock ${store.location}`}
      />
      <input
        type="number"
        min="0"
        className="inv-input inv-input-min"
        value={product[store.minField] ?? 0}
        onChange={(e) => handleMinChange(product.sku, store.minField, e.target.value)}
        aria-label={`Mínimo ${store.location}`}
        title="Mínimo: dispara producción"
      />
      <input
        type="number"
        min="0"
        className="inv-input inv-input-max"
        value={product[store.maxField] ?? 0}
        onChange={(e) => handleMinChange(product.sku, store.maxField, e.target.value)}
        aria-label={`Máximo ${store.location}`}
        title="Máximo: nivel de reposición"
      />
    </>
  );

  return (
    <div className="container inv-page">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#dc2626' }}>
        Inventario
      </h2>
      <p className="inv-view-note">
        Vista: {canViewGlobalInventory ? 'Global' : `Individual (${individualStore?.location || 'Ciudad no configurada'})`}
      </p>

      {canViewGlobalInventory && (
        <div className="inv-city-pills">
          <button
            type="button"
            className={`inv-city-pill ${globalStoreView === 'all' ? 'is-active' : ''}`}
            onClick={() => setGlobalStoreView('all')}
          >
            Todas
          </button>
          {globalStores.map((store) => (
            <button
              key={`filter-${store.key}`}
              type="button"
              className={`inv-city-pill ${globalStoreView === store.key ? 'is-active' : ''}`}
              onClick={() => setGlobalStoreView(store.key)}
            >
              {store.location}
            </button>
          ))}
        </div>
      )}

      <div className="inv-toolbar">
        <div className="inv-toolbar-row">
          <input
            type="text"
            className="inv-search"
            placeholder="Buscar producto o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className={`inv-alert-toggle ${alertsOnly ? 'is-on' : ''}`}
            onClick={() => setAlertsOnly((prev) => !prev)}
          >
            Solo alertas ({lowOrCriticalCount + overstockCount})
          </button>
        </div>
        <div className="inv-toolbar-row inv-toolbar-meta">
          <span>
            Pendientes: <strong style={{ color: (changedSkus.length + changedMinSkus.length) > 0 ? '#f59e0b' : '#047857' }}>
              {new Set([...changedSkus, ...changedMinSkus]).size}
            </strong>
          </span>
          <span style={{ color: '#dc2626' }}>Bajo mínimo: <strong>{lowOrCriticalCount}</strong></span>
          {overstockCount > 0 && (
            <span style={{ color: '#2563eb' }}>Sobre máximo: <strong>{overstockCount}</strong></span>
          )}
          <div className="inv-toolbar-actions">
            <button
              type="button"
              onClick={saveMinimums}
              disabled={savingMins || changedMinSkus.length === 0}
              className="btn inv-save-levels"
            >
              {savingMins ? 'Guardando…' : 'Guardar min/max'}
            </button>
            <button
              type="button"
              onClick={saveAllChanges}
              disabled={saving || changedSkus.length === 0}
              className="btn inv-save-stock"
            >
              {saving ? 'Guardando…' : 'Guardar inventario'}
            </button>
          </div>
        </div>
      </div>

      {saveMessage && (
        <div className={`inv-save-msg ${saveMessage.startsWith('Error') ? 'is-error' : ''}`}>
          {saveMessage}
        </div>
      )}

      {visibleProducts.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#78716c', padding: '30px 0' }}>
          {products.length === 0 ? 'No hay productos registrados.' : 'Sin productos que coincidan con el filtro.'}
        </p>
      ) : isMobile ? (
        <div className="mobile-cards-list">
          {visibleProducts.map((product) => {
            const pending = changedSkuSet.has(product.sku) || changedMinSkuSet.has(product.sku);
            const levels = visibleStores.map((store) => getStockLevel(product, store.field, store.minField, store.maxField));
            return (
              <div key={product.sku} className={`mobile-card inv-m-card ${pending ? 'is-pending' : ''}`}>
                <div className="inv-m-head">
                  <div className="inv-m-title">
                    <span className="inv-sku">{product.sku}</span>
                    <span className="inv-name">{product.name}</span>
                  </div>
                  {pending
                    ? <span className="inv-chip is-pending">Pendiente</span>
                    : levelChip(worstLevel(levels))}
                </div>
                {visibleStores.map((store, index) => (
                  <div key={`${product.sku}-${store.key}`} className={`inv-m-store is-${levels[index]}`}>
                    <div className="inv-m-store-name">
                      {store.location}
                      {levels[index] !== 'ok' && levelChip(levels[index])}
                    </div>
                    <div className="inv-m-fields">
                      <label>
                        Stock
                        <input
                          type="number"
                          min="0"
                          className={`inv-input inv-input-stock is-${levels[index]}`}
                          value={product[store.field] ?? 0}
                          onChange={(e) => handleStockChange(product.sku, store.field, e.target.value)}
                        />
                      </label>
                      <label>
                        Mín
                        <input
                          type="number"
                          min="0"
                          className="inv-input inv-input-min"
                          value={product[store.minField] ?? 0}
                          onChange={(e) => handleMinChange(product.sku, store.minField, e.target.value)}
                        />
                      </label>
                      <label>
                        Máx
                        <input
                          type="number"
                          min="0"
                          className="inv-input inv-input-max"
                          value={product[store.maxField] ?? 0}
                          onChange={(e) => handleMinChange(product.sku, store.maxField, e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-th inv-th-product">Producto</th>
                {visibleStores.map((store) => (
                  <th key={`${store.key}-head`} className="inv-th inv-th-city">
                    {store.location}
                    <span className="inv-th-caption">Stock · Mín · Máx</span>
                  </th>
                ))}
                <th className="inv-th inv-th-state">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => {
                const pending = changedSkuSet.has(product.sku) || changedMinSkuSet.has(product.sku);
                const levels = visibleStores.map((store) => getStockLevel(product, store.field, store.minField, store.maxField));
                return (
                  <tr key={product.sku} className={pending ? 'is-pending' : ''}>
                    <td className="inv-td inv-td-product">
                      <span className="inv-sku">{product.sku}</span>
                      <span className="inv-name">{product.name}</span>
                      <span className="inv-updated">
                        {product.last_updated
                          ? new Date(product.last_updated).toLocaleDateString('es-BO')
                          : ''}
                      </span>
                    </td>
                    {visibleStores.map((store, index) => (
                      <td key={`${product.sku}-${store.key}`} className={`inv-td inv-td-city is-${levels[index]}`}>
                        <div className="inv-triplet">
                          {renderTriplet(product, store, levels[index])}
                        </div>
                      </td>
                    ))}
                    <td className="inv-td inv-td-state">
                      {pending
                        ? <span className="inv-chip is-pending">Pendiente</span>
                        : levelChip(worstLevel(levels))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default InventoryPanel;
