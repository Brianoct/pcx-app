// src/Combos.jsx
import { useState, useEffect, useCallback } from 'react';

function Combos({ token }) {
  const products = [
    { sku: 'T6195R', name: 'Tablero 61x95 Rojo', sf: 330, cf: 383 },
    { sku: 'T6195N', name: 'Tablero 61x95 Negro', sf: 330, cf: 383 },
    { sku: 'T6195AM', name: 'Tablero 61x95 Amarillo', sf: 330, cf: 383 },
    { sku: 'T6195AP', name: 'Tablero 61x95 Azul Petroleo', sf: 330, cf: 383 },
    { sku: 'T6195PL', name: 'Tablero 61x95 Plomo', sf: 330, cf: 383 },
    { sku: 'T9495R', name: 'Tablero 94x95 Rojo', sf: 450, cf: 522 },
    { sku: 'T9495N', name: 'Tablero 94x95 Negro', sf: 450, cf: 522 },
    { sku: 'T9495AM', name: 'Tablero 94x95 Amarillo', sf: 450, cf: 522 },
    { sku: 'T9495AP', name: 'Tablero 94x95 Azul Petroleo', sf: 450, cf: 522 },
    { sku: 'T9495PL', name: 'Tablero 94x95 Plomo', sf: 450, cf: 522 },
    { sku: 'T1099R', name: 'Tablero 10x99 Rojo', sf: 105, cf: 122 },
    { sku: 'T1099N', name: 'Tablero 10x99 Negro', sf: 105, cf: 122 },
    { sku: 'T1099AP', name: 'Tablero 10x99 Azul Petroleo', sf: 105, cf: 122 },
    { sku: 'R40N', name: 'Repisa Grande Negro', sf: 85, cf: 99 },
    { sku: 'R25N', name: 'Repisa Pequeña Negro', sf: 40, cf: 47 },
    { sku: 'D40N', name: 'Desarmador Grande Negro', sf: 70, cf: 82 },
    { sku: 'D22N', name: 'Desarmador Pequeño Negro', sf: 45, cf: 53 },
    { sku: 'L40N', name: 'Llave Grande Negro', sf: 80, cf: 93 },
    { sku: 'L22N', name: 'Llave Pequeño Negro', sf: 50, cf: 58 },
    { sku: 'C15N', name: 'Caja Negro', sf: 48, cf: 56 },
    { sku: 'M08N', name: 'Martillo Negro', sf: 17, cf: 20 },
    { sku: 'A15N', name: 'Amoladora Negro', sf: 30, cf: 35 },
    { sku: 'RR15N', name: 'Repisa/Rollo Negro', sf: 90, cf: 105 },
    { sku: 'G05C', name: 'Gancho 5cm Cromo', sf: 65, cf: 76 },
    { sku: 'G10C', name: 'Gancho 10cm Cromo', sf: 84, cf: 98 }
  ];

  const [combos, setCombos] = useState([]);
  const [comboName, setComboName] = useState('');
  const [comboItems, setComboItems] = useState([{ sku: '', quantity: 1 }]);
  const [comboPriceSf, setComboPriceSf] = useState(0);
  const [comboPriceCf, setComboPriceCf] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const fetchCombos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/combos`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudieron cargar combos');
      const data = await res.json();
      setCombos(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [API_BASE, token]);

  useEffect(() => {
    fetchCombos();
  }, [fetchCombos]);

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
    setComboPriceSf(sfTotal);
    setComboPriceCf(cfTotal);
  };

  const handleCreateCombo = async () => {
    if (!comboName.trim() || comboItems.every(i => !i.sku)) {
      alert('Ingrese nombre y al menos un producto válido');
      return;
    }

    const validItems = comboItems.filter(i => i.sku && i.quantity > 0);

    try {
      const res = await fetch(`${API_BASE}/api/combos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: comboName,
          sf: comboPriceSf,
          cf: comboPriceCf,
          products: validItems.map(i => ({ sku: i.sku, quantity: i.quantity }))
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al crear combo');
      }

      alert('Combo creado correctamente');
      setComboName('');
      setComboItems([{ sku: '', quantity: 1 }]);
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
      const res = await fetch(`${API_BASE}/api/combos/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudo eliminar');
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
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Precio Sin Factura (calculado)</label>
            <input
              type="number"
              value={comboPriceSf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Precio Con Factura (calculado)</label>
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