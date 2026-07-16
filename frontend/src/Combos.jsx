// src/Combos.jsx
import { useState, useEffect, useCallback } from 'react';
import { sortProductsByCatalogOrder } from './productCatalog';
import { apiRequest, API_BASE } from './apiClient';
import { clearDraftState, useDraftState } from './useDraftState';
import { useOutbox } from './OutboxProvider';
import { useToast } from './ui/toastContext';

// Combo photos are downscaled in the browser before upload, same as product
// photos, so we ship tens of KB instead of a multi-MB phone snapshot.
const downscaleImage = (file, { maxDim = 800, quality = 0.82 } = {}) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = String(reader.result || '');
  };
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

const resolveImageUrl = (rawUrl = '') => {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${String(API_BASE || '').replace(/\/+$/, '')}${value}`;
  return value;
};

function Combos({ token }) {
  const toast = useToast();
  const { isOnline, enqueueWrite } = useOutbox();
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
  const [editingComboId, setEditingComboId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imageBusyId, setImageBusyId] = useState(null);

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

  const calculateBaseTotals = (items = comboItems) => {
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
    return { sfTotal, cfTotal };
  };

  const calculatePrices = (items = comboItems, overrides = {}) => {
    const { sfTotal, cfTotal } = calculateBaseTotals(items);
    const discountRatio = Math.max(0, Math.min(100, Number(overrides.discountPercent ?? discountPercent) || 0)) / 100;
    const discountFixed = Math.max(0, Number(overrides.discountAmount ?? discountAmount) || 0);
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

  const resetForm = () => {
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
    setEditingComboId(null);
  };

  const handleStartEditCombo = (combo) => {
    const nextItems = Array.isArray(combo?.items) && combo.items.length > 0
      ? combo.items.map((item) => ({
        sku: String(item?.sku || '').trim().toUpperCase(),
        quantity: Math.max(1, Number.parseInt(item?.quantity, 10) || 1)
      }))
      : [{ sku: '', quantity: 1 }];
    const { sfTotal } = calculateBaseTotals(nextItems);
    const comboFinalSf = Number(combo?.sf_price || 0);
    const inferredDiscount = Math.max(0, Number((sfTotal - comboFinalSf).toFixed(2)));

    setEditingComboId(combo?.id || null);
    setComboName(String(combo?.name || ''));
    setComboItems(nextItems);
    setDiscountPercent(0);
    setDiscountAmount(inferredDiscount);
    calculatePrices(nextItems, { discountPercent: 0, discountAmount: inferredDiscount });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSaveCombo = async () => {
    if (!comboName.trim() || comboItems.every(i => !i.sku)) {
      toast.error('Ingrese nombre y al menos un producto válido');
      return;
    }

    const validItems = comboItems.filter(i => i.sku && i.quantity > 0);
    const payload = {
      name: comboName,
      sf: comboPriceSf,
      cf: comboPriceCf,
      products: validItems.map(i => ({ sku: i.sku, quantity: i.quantity }))
    };
    const isEditing = Boolean(editingComboId);
    const endpoint = isEditing ? `/api/combos/${editingComboId}` : '/api/combos';
    const method = isEditing ? 'PUT' : 'POST';

    if (!isOnline) {
      enqueueWrite({
        label: `${isEditing ? 'Editar' : 'Crear'} combo ${comboName.trim()}`,
        path: endpoint,
        options: {
          method,
          body: payload
        },
        meta: {
          comboName: comboName.trim(),
          comboId: editingComboId || null
        }
      });
      resetForm();
      toast.info(`Sin conexión: ${isEditing ? 'edición' : 'creación'} de combo en cola para sincronizar.`);
      return;
    }

    try {
      await apiRequest(endpoint, {
        method,
        token,
        body: payload,
        timeoutMs: 18000
      });

      toast.success(isEditing ? 'Combo actualizado correctamente' : 'Combo creado correctamente');
      resetForm();
      fetchCombos();
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const uploadComboImage = async (comboId, file) => {
    if (!file) return;
    setImageBusyId(comboId);
    try {
      const dataUrl = await downscaleImage(file);
      const res = await apiRequest(`/api/combos/${comboId}/image`, {
        method: 'POST',
        token,
        body: { data_url: dataUrl },
        timeoutMs: 20000
      });
      setCombos((prev) => prev.map((c) => (c.id === comboId ? { ...c, image_url: res.image_url } : c)));
      toast.success('Imagen del combo actualizada');
    } catch (err) {
      toast.error('Error al subir imagen: ' + err.message);
    } finally {
      setImageBusyId(null);
    }
  };

  const removeComboImage = async (comboId) => {
    if (!window.confirm('¿Quitar la imagen de este combo?')) return;
    setImageBusyId(comboId);
    try {
      await apiRequest(`/api/combos/${comboId}/image`, { method: 'DELETE', token, timeoutMs: 18000 });
      setCombos((prev) => prev.map((c) => (c.id === comboId ? { ...c, image_url: null } : c)));
      toast.success('Imagen eliminada');
    } catch (err) {
      toast.error('Error al eliminar imagen: ' + err.message);
    } finally {
      setImageBusyId(null);
    }
  };

  const handleDeleteCombo = async (id) => {
    if (!window.confirm('¿Eliminar combo permanentemente?')) return;

    if (!isOnline) {
      enqueueWrite({
        label: `Eliminar combo #${id}`,
        path: `/api/combos/${id}`,
        options: {
          method: 'DELETE'
        },
        meta: { comboId: id }
      });
      setCombos((prev) => prev.filter((combo) => combo.id !== id));
      toast.info('Sin conexión: eliminación en cola para sincronizar.');
      return;
    }

    try {
      await apiRequest(`/api/combos/${id}`, {
        method: 'DELETE',
        token,
        timeoutMs: 18000
      });
      toast.success('Combo eliminado');
      fetchCombos();
    } catch (err) {
      toast.error('Error al eliminar: ' + err.message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}>Cargando...</div>;

  const editingCombo = editingComboId ? combos.find((c) => c.id === editingComboId) : null;
  const editingImageUrl = resolveImageUrl(editingCombo?.image_url);

  return (
    <div style={{ padding: '16px' }}>
      <h2 style={{ textAlign: 'center', color: '#dc2626', marginBottom: '24px' }}>Combos</h2>
      {error && <p style={{ textAlign: 'center', color: '#dc2626', marginBottom: '12px' }}>{error}</p>}

      {/* Create Combo Form */}
      <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', marginBottom: '32px' }}>
        <h3 style={{ color: '#78716c', marginBottom: '16px' }}>
          {editingComboId ? `Editar Combo #${editingComboId}` : 'Crear Nuevo Combo'}
        </h3>

        <input
          type="text"
          value={comboName}
          onChange={(e) => setComboName(e.target.value)}
          placeholder="Nombre del Combo (ej: Combo Básico 3x2)"
          style={{ width: '100%', padding: '12px', marginBottom: '16px', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
        />

        {editingComboId ? (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px', padding: '12px', background: '#faf8f5', border: '1px solid #e7e0d8', borderRadius: '8px', flexWrap: 'wrap' }}>
            <div style={{ width: '96px', height: '96px', borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid #e7e0d8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {editingImageUrl ? (
                <img src={editingImageUrl} alt={comboName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: '#a8a29e', fontSize: '0.75rem', textAlign: 'center' }}>Sin<br />imagen</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ color: '#78716c', display: 'block', marginBottom: '8px', fontWeight: 600 }}>Imagen del combo</label>
              <p style={{ color: '#a8a29e', fontSize: '0.8rem', margin: '0 0 10px' }}>
                Se mostrará en la vista de catálogo de Cotizar. Usa JPG, PNG o WEBP.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <label style={{ padding: '8px 14px', background: '#2563eb', color: 'white', borderRadius: '6px', cursor: imageBusyId === editingComboId ? 'wait' : 'pointer', fontSize: '0.9rem', opacity: imageBusyId === editingComboId ? 0.6 : 1 }}>
                  {imageBusyId === editingComboId ? 'Subiendo…' : (editingImageUrl ? 'Cambiar imagen' : 'Subir imagen')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    disabled={imageBusyId === editingComboId}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadComboImage(editingComboId, f); }}
                  />
                </label>
                {editingImageUrl && (
                  <button
                    type="button"
                    onClick={() => removeComboImage(editingComboId)}
                    disabled={imageBusyId === editingComboId}
                    style={{ padding: '8px 14px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}
                  >
                    Quitar
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: '#a8a29e', fontSize: '0.85rem', margin: '-4px 0 16px' }}>
            💡 Crea el combo primero; luego, al editarlo, podrás subir una imagen para el catálogo.
          </p>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: '#78716c', display: 'block', marginBottom: '8px' }}>Productos del Combo</label>

          {comboItems.map((item, index) => (
            <div key={index} style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center' }}>
              <select
                value={item.sku}
                onChange={(e) => handleItemChange(index, 'sku', e.target.value)}
                style={{ flex: 1, padding: '10px', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
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
                style={{ width: '80px', padding: '10px', textAlign: 'center', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
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
            <label style={{ color: '#78716c', display: 'block', marginBottom: '6px' }}>Precio base SF</label>
            <input
              type="number"
              value={basePriceSf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#ffffff', color: '#78716c', border: '1px solid #e7e0d8', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#78716c', display: 'block', marginBottom: '6px' }}>Precio base CF</label>
            <input
              type="number"
              value={basePriceCf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#ffffff', color: '#78716c', border: '1px solid #e7e0d8', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#78716c', display: 'block', marginBottom: '6px' }}>Descuento %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              style={{ width: '100%', padding: '12px', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#78716c', display: 'block', marginBottom: '6px' }}>Descuento fijo (Bs)</label>
            <input
              type="number"
              min="0"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: '100%', padding: '12px', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#78716c', display: 'block', marginBottom: '6px' }}>Precio Sin Factura (final)</label>
            <input
              type="number"
              value={comboPriceSf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#78716c', display: 'block', marginBottom: '6px' }}>Precio Con Factura (final)</label>
            <input
              type="number"
              value={comboPriceCf}
              readOnly
              style={{ width: '100%', padding: '12px', background: '#ffffff', color: '#292524', border: '1px solid #e7e0d8', borderRadius: '6px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleSaveCombo}
            style={{ flex: 1, minWidth: '180px', padding: '14px', background: '#047857', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer' }}
            disabled={!comboName.trim() || comboItems.every(i => !i.sku)}
          >
            {editingComboId ? 'Guardar cambios' : 'Crear Combo'}
          </button>
          {editingComboId && (
            <button
              onClick={resetForm}
              style={{ minWidth: '160px', padding: '14px', background: '#d9d0c5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1rem', cursor: 'pointer' }}
            >
              Cancelar edición
            </button>
          )}
        </div>
      </div>

      {/* Existing Combos */}
      <h3 style={{ color: '#78716c', marginBottom: '12px' }}>Combos Existentes</h3>
      {combos.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#78716c' }}>No hay combos creados aún</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#ffffff' }}>
                <th style={{ padding: '12px', textAlign: 'center', width: '64px' }}>Imagen</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Nombre</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Precio SF</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Precio CF</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {combos.map(combo => (
                <tr key={combo.id} style={{ borderBottom: '1px solid #e7e0d8' }}>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '6px', overflow: 'hidden', background: '#faf8f5', border: '1px solid #e7e0d8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {resolveImageUrl(combo.image_url) ? (
                        <img src={resolveImageUrl(combo.image_url)} alt={combo.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: '#c7c0b6', fontSize: '0.6rem' }}>—</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>{combo.name}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {Number(combo.sf_price).toFixed(2)} Bs
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {Number(combo.cf_price).toFixed(2)} Bs
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                      onClick={() => handleStartEditCombo(combo)}
                      style={{ background: '#2563eb', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', marginRight: '8px' }}
                    >
                      Editar
                    </button>
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