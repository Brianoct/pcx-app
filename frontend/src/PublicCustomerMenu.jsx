import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';
const COLOR_BY_CODE = {
  R: 'Rojo',
  N: 'Negro',
  B: 'Blanco',
  W: 'Blanco',
  V: 'Verde',
  A: 'Azul',
  Z: 'Azul',
  G: 'Gris',
  C: 'Cafe',
  M: 'Marron',
  Y: 'Amarillo',
  O: 'Naranja'
};
const COLOR_HEX = {
  rojo: '#ef4444',
  negro: '#111827',
  blanco: '#f8fafc',
  verde: '#22c55e',
  azul: '#3b82f6',
  gris: '#6b7280',
  cafe: '#92400e',
  marron: '#92400e',
  amarillo: '#facc15',
  naranja: '#fb923c'
};

function normalizeColorKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function detectColorFromName(name) {
  const value = String(name || '').trim();
  if (!value) return null;

  const parenMatch = value.match(/\(([^)]+)\)\s*$/);
  if (parenMatch?.[1]) {
    const label = String(parenMatch[1]).trim();
    return {
      label,
      source: 'name',
      baseName: value.slice(0, parenMatch.index).trim()
    };
  }

  const dashMatch = value.match(/\s[-/]\s([A-Za-zÁÉÍÓÚáéíóúÑñ ]+)$/);
  if (dashMatch?.[1]) {
    const label = String(dashMatch[1]).trim();
    return {
      label,
      source: 'name',
      baseName: value.slice(0, dashMatch.index).trim()
    };
  }
  return null;
}

function detectColorFromSku(sku) {
  const normalizedSku = String(sku || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
  if (!normalizedSku || normalizedSku.length < 3) return null;

  const code = normalizedSku.slice(-1);
  const baseSku = normalizedSku.slice(0, -1);
  if (!COLOR_BY_CODE[code]) return null;
  if (!/\d/.test(baseSku)) return null;

  return {
    label: COLOR_BY_CODE[code],
    source: 'sku',
    code,
    baseSku
  };
}

function getColorHex(label, code) {
  const normalized = normalizeColorKey(label);
  if (COLOR_HEX[normalized]) return COLOR_HEX[normalized];
  if (code && COLOR_HEX[normalizeColorKey(COLOR_BY_CODE[code] || '')]) {
    return COLOR_HEX[normalizeColorKey(COLOR_BY_CODE[code] || '')];
  }
  return '#94a3b8';
}

function getTableroVariantMeta(product) {
  const name = String(product?.name || '').trim();
  const sku = String(product?.sku || '').trim();
  const fromName = detectColorFromName(name);
  const fromSku = detectColorFromSku(sku);

  const colorLabel = fromName?.label || fromSku?.label || null;
  const baseName = fromName?.baseName || name;
  const modelKey = String(fromSku?.baseSku || baseName || sku || '').trim();
  const normalizedSku = String(sku || '').replace(/\s+/g, '').toUpperCase();
  const modelLabel = fromName?.baseName
    || (fromSku && normalizedSku === String(name || '').replace(/\s+/g, '').toUpperCase() ? fromSku.baseSku : null)
    || baseName
    || sku;
  const colorCode = fromSku?.code || null;

  return {
    modelKey: modelKey || sku || name,
    modelLabel,
    colorLabel: colorLabel || 'Variante',
    colorCode,
    colorHex: getColorHex(colorLabel, colorCode)
  };
}

export default function PublicCustomerMenu() {
  const { shareToken } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [menuData, setMenuData] = useState(null);
  const [activeCategory, setActiveCategory] = useState(CATEGORY_TABLEROS);
  const [quantities, setQuantities] = useState({});
  const [selectedTableroSkuByModel, setSelectedTableroSkuByModel] = useState({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const loadMenu = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest(`/api/public/menu/${encodeURIComponent(shareToken || '')}`, {
          retries: 0
        });
        setMenuData(data || null);
        const categories = Array.isArray(data?.categories) && data.categories.length > 0
          ? data.categories
          : [CATEGORY_TABLEROS, CATEGORY_ACCESORIOS];
        setActiveCategory(categories.includes(CATEGORY_TABLEROS) ? CATEGORY_TABLEROS : categories[0]);
      } catch (err) {
        setError(err.message || 'No se pudo cargar el menú');
      } finally {
        setLoading(false);
      }
    };
    loadMenu();
  }, [shareToken]);

  const products = useMemo(
    () => Array.isArray(menuData?.products) ? menuData.products : [],
    [menuData]
  );
  const categories = useMemo(
    () => Array.isArray(menuData?.categories) && menuData.categories.length > 0
      ? menuData.categories
      : [CATEGORY_TABLEROS, CATEGORY_ACCESORIOS],
    [menuData]
  );
  const filteredProducts = useMemo(
    () => products.filter((product) => String(product.category || CATEGORY_ACCESORIOS) === activeCategory),
    [products, activeCategory]
  );
  const tableroGroups = useMemo(() => {
    if (activeCategory !== CATEGORY_TABLEROS) return [];
    const groups = new Map();
    for (const product of filteredProducts) {
      const meta = getTableroVariantMeta(product);
      if (!groups.has(meta.modelKey)) {
        groups.set(meta.modelKey, {
          key: meta.modelKey,
          title: meta.modelLabel,
          variants: []
        });
      }
      groups.get(meta.modelKey).variants.push({
        ...product,
        colorLabel: meta.colorLabel,
        colorCode: meta.colorCode,
        colorHex: meta.colorHex
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        variants: [...group.variants].sort((a, b) => String(a.colorLabel).localeCompare(String(b.colorLabel)))
      }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }, [activeCategory, filteredProducts]);

  useEffect(() => {
    if (activeCategory !== CATEGORY_TABLEROS) return;
    setSelectedTableroSkuByModel((prev) => {
      const next = { ...prev };
      let changed = false;
      const validModelKeys = new Set(tableroGroups.map((group) => group.key));
      Object.keys(next).forEach((modelKey) => {
        if (!validModelKeys.has(modelKey)) {
          delete next[modelKey];
          changed = true;
        }
      });
      for (const group of tableroGroups) {
        const selectedSku = next[group.key];
        const hasCurrent = group.variants.some((variant) => variant.sku === selectedSku);
        if (!hasCurrent && group.variants[0]?.sku) {
          next[group.key] = group.variants[0].sku;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeCategory, tableroGroups]);
  const cartItems = useMemo(() => (
    products
      .filter((product) => Number(quantities[product.sku] || 0) > 0)
      .map((product) => {
        const qty = Number(quantities[product.sku] || 0);
        const price = Number(product.price || 0);
        return {
          ...product,
          qty,
          lineTotal: qty * price
        };
      })
  ), [products, quantities]);
  const cartUnits = cartItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

  const setQty = (sku, qty) => {
    const normalizedQty = Math.max(0, Number.parseInt(qty, 10) || 0);
    setQuantities((prev) => {
      if (normalizedQty === 0) {
        const next = { ...prev };
        delete next[sku];
        return next;
      }
      return { ...prev, [sku]: normalizedQty };
    });
  };

  const increase = (sku) => setQty(sku, Number(quantities[sku] || 0) + 1);
  const decrease = (sku) => setQty(sku, Math.max(0, Number(quantities[sku] || 0) - 1));
  const selectTableroVariant = (modelKey, sku) => {
    setSelectedTableroSkuByModel((prev) => ({ ...prev, [modelKey]: sku }));
  };

  const submitOrder = async (e) => {
    e.preventDefault();
    if (cartItems.length === 0) {
      alert('Selecciona al menos un producto');
      return;
    }
    if (!String(customerName || '').trim() || !String(customerPhone || '').trim()) {
      alert('Completa nombre y teléfono');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(null);
    try {
      const payload = {
        customer_name: String(customerName || '').trim(),
        customer_phone: String(customerPhone || '').trim(),
        notes: String(notes || '').trim() || null,
        items: cartItems.map((item) => ({
          sku: item.sku,
          qty: Number(item.qty || 0)
        }))
      };
      const data = await apiRequest(`/api/public/menu/${encodeURIComponent(shareToken || '')}/order`, {
        method: 'POST',
        body: payload,
        retries: 0
      });
      setSuccess(data || { message: 'Pedido enviado correctamente' });
      setQuantities({});
      setNotes('');
    } catch (err) {
      setError(err.message || 'No se pudo enviar el pedido');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ maxWidth: '1080px' }}>
        <div className="card" style={{ textAlign: 'center', color: '#94a3b8' }}>Cargando menú...</div>
      </div>
    );
  }

  if (error && !menuData) {
    return (
      <div className="container" style={{ maxWidth: '1080px' }}>
        <div className="card" style={{ textAlign: 'center', color: '#fca5a5' }}>{error}</div>
      </div>
    );
  }

  const sellerName = String(menuData?.seller?.display_name || 'Ventas PCX');

  return (
    <div className="container" style={{ maxWidth: '1120px', paddingTop: '28px' }}>
      <div className="card" style={{ marginBottom: '14px' }}>
        <h2 style={{ marginBottom: '8px', color: '#f87171' }}>Menú PCX</h2>
        <p style={{ color: '#cbd5e1', marginBottom: '4px' }}>
          Elige tus productos y envía tu pedido. Te contactará <strong>{sellerName}</strong>.
        </p>
        {menuData?.default_store && (
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Despacho base: {menuData.default_store}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '14px' }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`btn ${activeCategory === category ? 'btn-primary' : ''}`}
                onClick={() => setActiveCategory(category)}
                style={activeCategory === category ? {} : { background: '#1f2937', color: '#e2e8f0', border: '1px solid #334155' }}
              >
                {category}
              </button>
            ))}
          </div>

          {activeCategory === CATEGORY_TABLEROS ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {tableroGroups.map((group) => {
                const selectedSku = selectedTableroSkuByModel[group.key] || group.variants[0]?.sku;
                const selectedVariant = group.variants.find((variant) => variant.sku === selectedSku) || group.variants[0];
                if (!selectedVariant) return null;
                const qty = Number(quantities[selectedVariant.sku] || 0);

                return (
                  <div
                    key={group.key}
                    style={{
                      border: '1px solid rgba(71,85,105,0.55)',
                      background: '#111827',
                      borderRadius: '12px',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        height: '148px',
                        background: selectedVariant.image_url
                          ? `center / cover no-repeat url(${selectedVariant.image_url})`
                          : 'linear-gradient(135deg, rgba(30,64,175,0.35), rgba(225,29,72,0.28))',
                        borderBottom: '1px solid rgba(71,85,105,0.45)'
                      }}
                    />

                    <div style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 800, color: '#f1f5f9', marginBottom: '4px' }}>{group.title}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '10px' }}>
                        SKU seleccionado: {selectedVariant.sku}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        {group.variants.map((variant) => {
                          const isSelected = variant.sku === selectedVariant.sku;
                          const variantQty = Number(quantities[variant.sku] || 0);
                          return (
                            <button
                              key={variant.sku}
                              type="button"
                              onClick={() => selectTableroVariant(group.key, variant.sku)}
                              style={{
                                minHeight: '34px',
                                padding: '6px 10px',
                                borderRadius: '999px',
                                border: isSelected ? '1px solid #60a5fa' : '1px solid #475569',
                                background: isSelected ? 'rgba(37,99,235,0.22)' : '#0f172a',
                                color: '#e2e8f0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '7px',
                                fontWeight: 700,
                                fontSize: '0.8rem'
                              }}
                              aria-label={`Seleccionar color ${variant.colorLabel}`}
                            >
                              <span
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '999px',
                                  background: variant.colorHex,
                                  border: variant.colorHex === '#f8fafc' ? '1px solid #94a3b8' : '1px solid rgba(15,23,42,0.55)'
                                }}
                              />
                              <span>{variant.colorLabel}</span>
                              {variantQty > 0 && (
                                <span style={{ color: '#86efac' }}>({variantQty})</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                        {Number(selectedVariant.price || 0).toFixed(2)} Bs
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => decrease(selectedVariant.sku)}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#334155', color: 'white' }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={qty}
                          onChange={(e) => setQty(selectedVariant.sku, e.target.value)}
                          style={{
                            width: '74px',
                            minHeight: '34px',
                            textAlign: 'center',
                            borderRadius: '8px',
                            border: '1px solid #334155',
                            background: '#0f172a',
                            color: 'white'
                          }}
                        />
                        <button
                          type="button"
                          className="btn"
                          onClick={() => increase(selectedVariant.sku)}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#2563eb', color: 'white' }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {filteredProducts.map((product) => {
                const qty = Number(quantities[product.sku] || 0);
                return (
                  <div key={product.sku} style={{
                    border: '1px solid rgba(71,85,105,0.55)',
                    background: '#111827',
                    borderRadius: '12px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '128px',
                      background: product.image_url
                        ? `center / cover no-repeat url(${product.image_url})`
                        : 'linear-gradient(135deg, rgba(30,64,175,0.35), rgba(225,29,72,0.28))',
                      borderBottom: '1px solid rgba(71,85,105,0.45)'
                    }} />
                    <div style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px', color: '#f1f5f9' }}>{product.name}</div>
                      <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                        {Number(product.price || 0).toFixed(2)} Bs
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button type="button" className="btn" onClick={() => decrease(product.sku)} style={{ minHeight: '34px', padding: '6px 10px', background: '#334155', color: 'white' }}>-</button>
                        <input
                          type="number"
                          min="0"
                          value={qty}
                          onChange={(e) => setQty(product.sku, e.target.value)}
                          style={{
                            width: '70px',
                            minHeight: '34px',
                            textAlign: 'center',
                            borderRadius: '8px',
                            border: '1px solid #334155',
                            background: '#0f172a',
                            color: 'white'
                          }}
                        />
                        <button type="button" className="btn" onClick={() => increase(product.sku)} style={{ minHeight: '34px', padding: '6px 10px', background: '#2563eb', color: 'white' }}>+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginBottom: '8px' }}>Tu pedido</h3>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '12px' }}>
            {cartUnits} unidad(es) · {cartTotal.toFixed(2)} Bs
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '12px', paddingRight: '4px' }}>
            {cartItems.length === 0 ? (
              <div style={{ color: '#94a3b8' }}>Aún no agregaste productos.</div>
            ) : cartItems.map((item) => (
              <div key={`cart-${item.sku}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', color: '#e2e8f0' }}>
                <span>{item.qty}× {item.name}</span>
                <strong>{item.lineTotal.toFixed(2)} Bs</strong>
              </div>
            ))}
          </div>

          <form onSubmit={submitOrder} style={{ display: 'grid', gap: '8px' }}>
            <input
              type="text"
              placeholder="Tu nombre"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              style={{ minHeight: '40px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', padding: '8px 10px' }}
            />
            <input
              type="text"
              placeholder="Tu teléfono"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              required
              style={{ minHeight: '40px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', padding: '8px 10px' }}
            />
            <textarea
              rows={3}
              placeholder="Nota (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', padding: '8px 10px' }}
            />
            <button type="submit" className="btn btn-primary" disabled={saving || cartItems.length === 0}>
              {saving ? 'Enviando...' : 'Enviar pedido'}
            </button>
          </form>

          {error && (
            <div style={{ marginTop: '10px', color: '#fca5a5', fontSize: '0.9rem' }}>{error}</div>
          )}
          {success && (
            <div style={{ marginTop: '10px', color: '#86efac', fontSize: '0.9rem' }}>
              {success.message || 'Pedido enviado correctamente'}
              {success.quote_id ? ` · N° ${success.quote_id}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
