import { useState, useEffect } from 'react';

function InventoryPanel({ token }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingRows, setSavingRows] = useState({}); // track which rows are saving

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
    setProducts(prev => prev.map(p => 
      p.sku === sku ? { ...p, [field]: numValue } : p
    ));
  };

  const saveAllStocks = async (product) => {
    setSavingRows(prev => ({ ...prev, [product.sku]: true }));

    try {
      const stores = [
        { field: 'stock_cochabamba', location: 'Cochabamba' },
        { field: 'stock_santacruz', location: 'Santa Cruz' },
        { field: 'stock_lima', location: 'Lima' }
      ];

      for (const store of stores) {
        const new_stock = product[store.field] ?? 0;

        await fetch(`http://localhost:4000/api/products/${product.sku}/stock`, {
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
      }

      alert(`Stock actualizado correctamente para ${product.name}`);
    } catch (err) {
      alert('Error al guardar: ' + err.message);
      console.error(err);
    } finally {
      setSavingRows(prev => ({ ...prev, [product.sku]: false }));
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>Cargando inventario...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Panel de Inventario
      </h2>

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
              <th style={{ padding: '14px 12px', width: '120px', textAlign: 'center' }}>Acción</th>
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
                      style={{ width: '90px', padding: '8px', textAlign: 'center', borderRadius: '6px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
                    />
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      value={product.stock_santacruz ?? 0}
                      onChange={(e) => handleStockChange(product.sku, 'stock_santacruz', e.target.value)}
                      style={{ width: '90px', padding: '8px', textAlign: 'center', borderRadius: '6px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
                    />
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      value={product.stock_lima ?? 0}
                      onChange={(e) => handleStockChange(product.sku, 'stock_lima', e.target.value)}
                      style={{ width: '90px', padding: '8px', textAlign: 'center', borderRadius: '6px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
                    />
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center', color: '#94a3b8' }}>
                    {product.last_updated 
                      ? new Date(product.last_updated).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>

                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <button
                      onClick={() => saveAllStocks(product)}
                      disabled={savingRows[product.sku]}
                      style={{
                        padding: '10px 20px',
                        background: savingRows[product.sku] ? '#6b7280' : '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: savingRows[product.sku] ? 'not-allowed' : 'pointer',
                        fontSize: '0.95rem',
                        fontWeight: '600',
                        minWidth: '100px'
                      }}
                    >
                      {savingRows[product.sku] ? 'Guardando...' : 'Guardar Todo'}
                    </button>
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