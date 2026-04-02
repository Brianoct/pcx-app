// src/Combos.jsx
import { useState, useEffect, useCallback } from 'react';
import { sortProductsByCatalogOrder } from './productCatalog';
import { apiRequest } from './apiClient';
import { clearDraftState, useDraftState } from './useDraftState';

function Combos({ token }) {
  const draftKey = 'draft:combos:create';
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [combos, setCombos] = useState([]);
  const [comboName, setComboName] = useDraftState(`${draftKey}:name`, '');
  const [comboItems, setComboItems] = useDraftState(`${draftKey}:items`, [{ sku: '', quantity: 1 }]);
  const [discountPercent, setDiscountPercent] = useDraftState(`${draftKey}:discountPercent`, 0);
  const [discountAmount, setDiscountAmount] = useDraftState(`${draftKey}:discountAmount`, 0);
  const [comboPriceSf, setComboPriceSf] = useState(0);
  const [comboPriceCf, setComboPriceCf] = useState(0);
  const [basePriceSf, setBasePriceSf] = useState(0);
  const [basePriceCf, setBasePriceCf] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchCombos = useCallback(async () => {
    try {
      const data = await apiRequest('/api/combos', {
        token,
        timeoutMs: 14000
      });
      setCombos(data);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  const fetchCatalog = useCallback(async () => {
    try {
      const data = await apiRequest('/api/product-catalog', {
        token,
        timeoutMs: 14000
      });
      const ordered = sortProductsByCatalogOrder(Array.isArray(data) ? data : []);
      setProducts(ordered);
    } catch (err) {
      setError(err.message);
      setProducts([]);
    }
  }, [token]);

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([fetchCatalog(), fetchCombos()]);
      setLoading(false);
    };
    loadData();
  }, [fetchCatalog, fetchCombos]);

  useEffect(() => {
    if (draftLoaded) return;
    if (!comboName && (!Array.isArray(comboItems) || comboItems.every((item) => !item?.sku))) {
      setDraftLoaded(true);
      return;
    }
    const shouldRecover = window.confirm('Se encontró un borrador de combo. ¿Quieres recuperarlo?');
    if (!shouldRecover) {
      clearDraftState(`${draftKey}:name`);
      clearDraftState(`${draftKey}:items`);
      clearDraftState(`${draftKey}:discountPercent`);
      clearDraftState(`${draftKey}:discountAmount`);
      setComboName('');
      setComboItems([{ sku: '', quantity: 1 }]);
      setDiscountPercent(0);
      setDiscountAmount(0);
    }
    setDraftLoaded(true);
  }, [draftLoaded, comboName, comboItems, discountPercent, discountAmount]);

  const handleAddItem = () => {
    setComboItems([...comboItems, { sku: '', quantity: 1 }]);
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...comboItems];
    newItems[index][field] = field === 'quantity' ? (parseInt(value) || 1) : value;
    setComboItems(newItems);
    calculatePrices(newItems);
  };

  const handleRemoveItem = (index) => {
    if (comboItems.length === 1) return;
    const newItems = comboItems.filter((_, i) => i !== index);
    setComboItems(newItems);
    calculatePrices(newItems);
  };

  const calculatePrices = (items = comboItems) => {
    let sfTotal = 0;
    let cfTotal = 0;
    items.forEach(item => {
      if (item.sku) {
        const prod = products.find(p => p.sku === item.sku);
        if (prod) {
          sfTotal += prod.sf * (item.quantity || 1);
          cfTotal += prod.cf * (item.quantity || 1);
        }
      }
    });
    const discountRatio = Math.max(0, Math.min(100, Number(discountPercent) || 0)) / 100;
    const discountFixed = Math.max(0, Number(discountAmount) || 0);
    const combinedDiscount = (sfTotal * discountRatio) + discountFixed;
    const finalSf = Math.max(0, sfTotal - combinedDiscount);
    const finalCf = Math.max(0, cfTotal - combinedDiscount);
    setBasePriceSf(sfTotal);
    setBasePriceCf(cfTotal);
    setComboPriceSf(Number(finalSf.toFixed(2)));
    setComboPriceCf(Number(finalCf.toFixed(2)));
  };

  useEffect(() => {
    calculatePrices();
  }, [discountPercent, discountAmount, products]);

  const handleCreateCombo = async () => {
    if (!comboName.trim() || comboItems.every(i => !i.sku)) {
      alert('Ingrese nombre y al menos un producto válido');
      return;
    }

    const validItems = comboItems.filter(i => i.sku && i.quantity > 0);

    try {
      await apiRequest('/api/combos', {
        method: 'POST',
        token,
        body: {
          name: comboName,
          sf: comboPriceSf,
          cf: comboPriceCf,
          products: validItems.map(i => ({ sku: i.sku, quantity: i.quantity }))
        },
        timeoutMs: 18000
      });

      alert('Combo creado correctamente');
      clearDraftState(`${draftKey}:name`);
      clearDraftState(`${draftKey}:items`);
      clearDraftState(`${draftKey}:discountPercent`);
      clearDraftState(`${draftKey}:discountAmount`);
      setComboName('');
      setComboItems([{ sku: '', quantity: 1 }]);
      setDiscountPercent(0);
      setDiscountAmount(0);
      setBasePriceSf(0);
      setBasePriceCf(0);
      setComboPriceSf(0);
      setComboPriceCf(0);
      fetchCombos();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeleteCombo = async (id) => {
    if (!window.confirm('¿Eliminar combo permanentemente?')) return;

    try {
      await apiRequest(`/api/combos/${id}`, {
        method: 'DELETE',
        token,
        timeoutMs: 18000
      });
      alert('Combo eliminado');
      fetchCombos();
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}>Cargando...</div>;

  return (
    <div style={{ padding: '16px' }}>
      <h2 style={{ textAlign: 'center', color: '#f87171', marginBottom: '24px' }}>Combos</h2>
      {error && <p style={{ textAlign: 'center', color: '#f87171', marginBottom: '12px' }}>{error}</p>}

      {/* Create Combo Form */}
      <div style={{ background: '#1e293b', padding: '20px', borderRadius: '12px', marginBottom: '32px' }}>
        <h3 style={{ color: '#94a3b8', marginBottom: '16px' }}>Crear Nuevo Combo</h3>

        <input
          type="text"
          value={comboName}
          onChange={(e) => setComboName(e.target.value)}
          placeholder="Nombre del Combo (ej: Combo Básico 3x2)"
          style={{ width: '100%', padding: '12px', marginBottom: '16px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
        />

        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#94a3b8', display: 'block', marginBottom: '8px' }}>Productos del Combo</label>

          {comboItems.map((item, index) => (
            <div key={index} style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center' }}>
              <select
                value={item.sku}
                onChange={(e) => handleItemChange(index, 'sku', e.target.value)}
                style={{ flex: 1, padding: '10px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
              >
                <option value="">Seleccionar producto...</option>
                {products.map(p => (
                  <option key={p.sku} value={p.sku}>
                    {p.sku} - {p.name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="1"
                value={item.quantity}
                onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                style={{ width: '80px', padding: '10px', textAlign: 'center', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
              />

              <button
                onClick={() => handleRemoveItem(index)}
                style={{ padding: '10px 14px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                disabled={comboItems.length === 1}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddItem}
            style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            + Agregar producto
          </button>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Precio base SF</label>
            <input
              type="number"
              value={basePriceSf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Precio base CF</label>
            <input
              type="number"
              value={basePriceCf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Descuento %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Descuento fijo (Bs)</label>
            <input
              type="number"
              min="0"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Precio Sin Factura (final)</label>
            <input
              type="number"
              value={comboPriceSf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Precio Con Factura (final)</label>
            <input
              type="number"
              value={comboPriceCf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
        </div>

        <button
          onClick={handleCreateCombo}
          style={{ width: '100%', padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer' }}
          disabled={!comboName.trim() || comboItems.every(i => !i.sku)}
        >
          Crear Combo
        </button>
      </div>

      {/* Existing Combos */}
      <h3 style={{ color: '#94a3b8', marginBottom: '12px' }}>Combos Existentes</h3>
      {combos.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#94a3b8' }}>No hay combos creados aún</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Nombre</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Precio SF</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Precio CF</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {combos.map(combo => (
                <tr key={combo.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px' }}>{combo.name}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {Number(combo.sf_price).toFixed(2)} Bs
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {Number(combo.cf_price).toFixed(2)} Bs
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeleteCombo(combo.id)}
                      style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Combos;