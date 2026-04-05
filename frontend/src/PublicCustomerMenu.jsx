import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';
const TABLERO_MODELS = [
  { key: 'T94x95', label: 'T94x95' },
  { key: 'T61x95', label: 'T61x95' }
];
const TABLERO_COLOR_VARIANTS = [
  { key: 'rojo', label: 'Rojo', hex: '#ef4444' },
  { key: 'negro', label: 'Negro', hex: '#111827' },
  { key: 'amarillo', label: 'Amarillo', hex: '#facc15' },
  { key: 'azul_petroleo', label: 'Azul Petroleo', hex: '#0f766e' },
  { key: 'plomo', label: 'Plomo', hex: '#6b7280' }
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function detectTableroModelKey(product) {
  const raw = `${String(product?.sku || '')} ${String(product?.name || '')}`.toUpperCase();
  if (/T\s*94\s*X\s*95/.test(raw)) return 'T94x95';
  if (/T\s*61\s*X\s*95/.test(raw)) return 'T61x95';
  return null;
}

function detectTableroColorKey(product) {
  const normalized = normalizeText(`${String(product?.name || '')} ${String(product?.sku || '')}`);
  if (normalized.includes('azul petroleo') || normalized.includes('azulpetroleo')) return 'azul_petroleo';
  if (normalized.includes('plomo')) return 'plomo';
  if (normalized.includes('amarillo')) return 'amarillo';
  if (normalized.includes('negro')) return 'negro';
  if (normalized.includes('rojo')) return 'rojo';

  const normalizedSku = String(product?.sku || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
  if (normalizedSku.endsWith('AP') || normalizedSku.endsWith('AZP') || normalizedSku.endsWith('ZP')) return 'azul_petroleo';
  if (normalizedSku.endsWith('PL') || normalizedSku.endsWith('P') || normalizedSku.endsWith('G')) return 'plomo';
  if (normalizedSku.endsWith('R')) return 'rojo';
  if (normalizedSku.endsWith('N')) return 'negro';
  if (normalizedSku.endsWith('Y') || normalizedSku.endsWith('A')) return 'amarillo';
  return null;
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
  const [selectedTableroColorByModel, setSelectedTableroColorByModel] = useState({});
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
  const tableroProducts = useMemo(
    () => products.filter((product) => String(product.category || CATEGORY_ACCESORIOS) === CATEGORY_TABLEROS),
    [products]
  );
  const tableroGroups = useMemo(() => {
    const byModelAndColor = new Map();
    for (const product of tableroProducts) {
      const modelKey = detectTableroModelKey(product);
      const colorKey = detectTableroColorKey(product);
      if (!modelKey || !colorKey) continue;
      const compositeKey = `${modelKey}|${colorKey}`;
      if (!byModelAndColor.has(compositeKey)) {
        byModelAndColor.set(compositeKey, product);
      }
    }

    return TABLERO_MODELS.map((model) => ({
      key: model.key,
      title: model.label,
      variants: TABLERO_COLOR_VARIANTS.map((color) => ({
        ...color,
        product: byModelAndColor.get(`${model.key}|${color.key}`) || null
      }))
    }));
  }, [tableroProducts]);

  useEffect(() => {
    setSelectedTableroColorByModel((prev) => {
      const next = { ...prev };
      let changed = false;
      const validModelKeys = new Set(TABLERO_MODELS.map((model) => model.key));
      Object.keys(next).forEach((modelKey) => {
        if (!validModelKeys.has(modelKey)) {
          delete next[modelKey];
          changed = true;
        }
      });
      for (const group of tableroGroups) {
        const selectedColor = next[group.key];
        const hasCurrent = group.variants.some((variant) => variant.key === selectedColor && variant.product);
        if (!hasCurrent) {
          const firstAvailable = group.variants.find((variant) => Boolean(variant.product));
          const fallbackKey = firstAvailable?.key || group.variants[0]?.key;
          if (fallbackKey) {
            next[group.key] = fallbackKey;
          }
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tableroGroups]);
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
  const selectTableroVariant = (modelKey, colorKey) => {
    setSelectedTableroColorByModel((prev) => ({ ...prev, [modelKey]: colorKey }));
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
                const selectedColorKey = selectedTableroColorByModel[group.key] || group.variants[0]?.key;
                let selectedVariant = group.variants.find((variant) => variant.key === selectedColorKey) || group.variants[0];
                if (selectedVariant && !selectedVariant.product) {
                  selectedVariant = group.variants.find((variant) => Boolean(variant.product)) || selectedVariant;
                }
                const selectedProduct = selectedVariant?.product || null;
                const qty = selectedProduct ? Number(quantities[selectedProduct.sku] || 0) : 0;

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
                        background: selectedProduct?.image_url
                          ? `center / cover no-repeat url(${selectedProduct.image_url})`
                          : 'linear-gradient(135deg, rgba(30,64,175,0.35), rgba(225,29,72,0.28))',
                        borderBottom: '1px solid rgba(71,85,105,0.45)'
                      }}
                    />

                    <div style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 800, color: '#f1f5f9', marginBottom: '4px' }}>{group.title}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '10px' }}>
                        SKU seleccionado: {selectedProduct?.sku || 'No disponible'}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        {group.variants.map((variant) => {
                          const isSelected = variant.key === selectedVariant?.key;
                          const variantQty = variant.product ? Number(quantities[variant.product.sku] || 0) : 0;
                          const isUnavailable = !variant.product;
                          return (
                            <button
                              key={`${group.key}-${variant.key}`}
                              type="button"
                              onClick={() => variant.product && selectTableroVariant(group.key, variant.key)}
                              disabled={isUnavailable}
                              style={{
                                minHeight: '34px',
                                padding: '6px 10px',
                                borderRadius: '999px',
                                border: isSelected ? '1px solid #60a5fa' : '1px solid #475569',
                                background: isUnavailable ? '#0b1220' : (isSelected ? 'rgba(37,99,235,0.22)' : '#0f172a'),
                                color: isUnavailable ? '#64748b' : '#e2e8f0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '7px',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                opacity: isUnavailable ? 0.6 : 1
                              }}
                              aria-label={`Seleccionar color ${variant.label}`}
                            >
                              <span
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '999px',
                                  background: variant.hex,
                                  border: variant.hex === '#f8fafc' ? '1px solid #94a3b8' : '1px solid rgba(15,23,42,0.55)'
                                }}
                              />
                              <span>{variant.label}</span>
                              {variantQty > 0 && (
                                <span style={{ color: '#86efac' }}>({variantQty})</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                        {selectedProduct ? `${Number(selectedProduct.price || 0).toFixed(2)} Bs` : 'No disponible'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => selectedProduct && decrease(selectedProduct.sku)}
                          disabled={!selectedProduct}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#334155', color: 'white' }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={qty}
                          onChange={(e) => selectedProduct && setQty(selectedProduct.sku, e.target.value)}
                          disabled={!selectedProduct}
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
                          onClick={() => selectedProduct && increase(selectedProduct.sku)}
                          disabled={!selectedProduct}
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
