import { useState, useEffect } from 'react';

function InventoryPanel({ token }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [originalStocks, setOriginalStocks] = useState({});
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    const fetchInventory = async () => {
      try {
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
        for (const p of data) {
          baseline[p.sku] = {
            stock_cochabamba: Number(p.stock_cochabamba ?? 0),
            stock_santacruz: Number(p.stock_santacruz ?? 0),
            stock_lima: Number(p.stock_lima ?? 0)
          };
        }
        setOriginalStocks(baseline);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchInventory();
  }, [token]);

  const handleStockChange = (sku, field, value) => {
    const numValue = value === '' ? 0 : Math.max(0, Number(value));
    setSaveMessage('');
    setProducts(prev => prev.map(p => 
      p.sku === sku ? { ...p, [field]: numValue } : p
    ));
  };

  const saveAllChanges = async () => {
    const stores = [
      { field: 'stock_cochabamba', location: 'Cochabamba' },
      { field: 'stock_santacruz', location: 'Santa Cruz' },
      { field: 'stock_lima', location: 'Lima' }
    ];

    const changedProducts = products.filter((product) => {
      const base = originalStocks[product.sku];
      if (!base) return false;
      return stores.some((store) => Number(product[store.field] ?? 0) !== Number(base[store.field] ?? 0));
    });

    if (changedProducts.length === 0) return;

    setSaving(true);
    setSaveMessage('');
    try {
      for (const product of changedProducts) {
        for (const store of stores) {
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

  const stores = [
    { field: 'stock_cochabamba', location: 'Cochabamba' },
    { field: 'stock_santacruz', location: 'Santa Cruz' },
    { field: 'stock_lima', location: 'Lima' }
  ];

  const changedSkus = products.reduce((acc, product) => {
    const base = originalStocks[product.sku];
    if (!base) return acc;
    const changed = stores.some((store) => Number(product[store.field] ?? 0) !== Number(base[store.field] ?? 0));
    if (changed) acc.push(product.sku);
    return acc;
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>Cargando inventario...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Panel de Inventario
      </h2>

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

      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          minWidth: '1100px',
          tableLayout: 'fixed'
        }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              <th style={{ padding: '14px 12px', width: '100px', textAlign: 'center' }}>SKU</th>
              <th style={{ padding: '14px 12px', width: '280px', textAlign: 'center' }}>Producto</th>
              <th style={{ padding: '14px 12px', width: '130px', textAlign: 'center' }}>Cochabamba</th>
              <th style={{ padding: '14px 12px', width: '130px', textAlign: 'center' }}>Santa Cruz</th>
              <th style={{ padding: '14px 12px', width: '130px', textAlign: 'center' }}>Lima</th>
              <th style={{ padding: '14px 12px', width: '180px', textAlign: 'center' }}>Última actualización</th>
              <th style={{ padding: '14px 12px', width: '120px', textAlign: 'center' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  No hay productos registrados.
                </td>
              </tr>
            ) : (
              products.map(product => (
                <tr key={product.sku} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>{product.sku}</td>
                  <td style={{ padding: '14px 12px' }}>{product.name}</td>

                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      value={product.stock_cochabamba ?? 0}
                      onChange={(e) => handleStockChange(product.sku, 'stock_cochabamba', e.target.value)}
                      style={{
                        width: '90px',
                        padding: '8px',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: changedSkus.includes(product.sku) ? '1px solid #f59e0b' : '1px solid #334155',
                        background: '#0f172a',
                        color: 'white'
                      }}
                    />
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      value={product.stock_santacruz ?? 0}
                      onChange={(e) => handleStockChange(product.sku, 'stock_santacruz', e.target.value)}
                      style={{
                        width: '90px',
                        padding: '8px',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: changedSkus.includes(product.sku) ? '1px solid #f59e0b' : '1px solid #334155',
                        background: '#0f172a',
                        color: 'white'
                      }}
                    />
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      value={product.stock_lima ?? 0}
                      onChange={(e) => handleStockChange(product.sku, 'stock_lima', e.target.value)}
                      style={{
                        width: '90px',
                        padding: '8px',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: changedSkus.includes(product.sku) ? '1px solid #f59e0b' : '1px solid #334155',
                        background: '#0f172a',
                        color: 'white'
                      }}
                    />
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center', color: '#94a3b8' }}>
                    {product.last_updated 
                      ? new Date(product.last_updated).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center', color: changedSkus.includes(product.sku) ? '#f59e0b' : '#10b981', fontWeight: '700' }}>
                    {changedSkus.includes(product.sku) ? 'Pendiente' : 'Guardado'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default InventoryPanel;