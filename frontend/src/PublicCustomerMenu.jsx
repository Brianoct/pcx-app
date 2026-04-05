import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';
const TABLERO_MODELS = [
  { key: 'T94x95', label: 'T94x95' },
  { key: 'T61x95', label: 'T61x95' },
  { key: 'T1099', label: 'T1099' }
];
const TABLERO_COLOR_VARIANTS = [
  { key: 'rojo', label: 'Rojo', hex: '#ef4444' },
  { key: 'negro', label: 'Negro', hex: '#111827' },
  { key: 'amarillo', label: 'Amarillo', hex: '#facc15' },
  { key: 'azul_petroleo', label: 'Azul Petroleo', hex: '#0f766e' },
  { key: 'plomo', label: 'Plomo', hex: '#6b7280' }
];
const TABLERO_COLOR_CODES = {
  rojo: 'R',
  negro: 'N',
  amarillo: 'A',
  azul_petroleo: 'AP',
  plomo: 'P'
};
const LOCAL_IMAGE_EXTENSIONS = ['jpg'];
const ACCESORIO_IMAGE_FALLBACK_PATTERNS = [
  'name',
  'sku',
  'name_compact',
  'name_with_dash'
];
const IMAGE_FALLBACK_BACKGROUND = 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';
const CONTAIN_IMAGE_BACKGROUND = '#f8fafc';
const FAILED_IMAGE_URLS = new Set();
const LIGHT_THEME = {
  pageBg: '#f3f6fb',
  surface: '#ffffff',
  surfaceAlt: '#f8fafc',
  border: '#dbe4ee',
  text: '#0f172a',
  textMuted: '#64748b',
  textSoft: '#475569',
  inputBg: '#ffffff',
  primary: '#e11d48'
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeSkuToken(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function detectTableroModelKey(product) {
  const raw = normalizeSkuToken(`${String(product?.sku || '')} ${String(product?.name || '')}`);
  if (raw.includes('T94X95') || raw.includes('T9495') || raw.includes('9495')) return 'T94x95';
  if (raw.includes('T61X95') || raw.includes('T6195') || raw.includes('6195')) return 'T61x95';
  if (raw.includes('T1099') || raw.includes('1099')) return 'T1099';
  return null;
}

function detectTableroColorKey(product) {
  const normalized = normalizeText(`${String(product?.name || '')} ${String(product?.sku || '')}`);
  if (normalized.includes('azul petroleo') || normalized.includes('azulpetroleo')) return 'azul_petroleo';
  if (normalized.includes('plomo')) return 'plomo';
  if (normalized.includes('amarillo')) return 'amarillo';
  if (normalized.includes('negro')) return 'negro';
  if (normalized.includes('rojo')) return 'rojo';

  const normalizedSku = normalizeSkuToken(product?.sku || '');
  if (normalizedSku.endsWith('AP') || normalizedSku.endsWith('AZP') || normalizedSku.endsWith('ZP')) return 'azul_petroleo';
  if (normalizedSku.endsWith('AM')) return 'amarillo';
  if (normalizedSku.endsWith('PL') || normalizedSku.endsWith('P') || normalizedSku.endsWith('G')) return 'plomo';
  if (normalizedSku.endsWith('R')) return 'rojo';
  if (normalizedSku.endsWith('N')) return 'negro';
  if (normalizedSku.endsWith('Y') || normalizedSku.endsWith('A')) return 'amarillo';
  return null;
}

function getTableroImageSkuAliases(product) {
  const modelKey = detectTableroModelKey(product);
  const colorKey = detectTableroColorKey(product);
  const colorCode = TABLERO_COLOR_CODES[colorKey] || '';
  if (!modelKey || !colorCode) return [];
  const compactModel = modelKey.replace(/x/gi, '');
  const preferred = `${modelKey}${colorCode}`;
  return Array.from(new Set([
    preferred,
    preferred.toUpperCase(),
    `${compactModel}${colorCode}`,
    `${compactModel}${colorCode}`.toUpperCase()
  ].filter(Boolean)));
}

function getProductImageCandidates(product, options = {}) {
  const { enableSkuFallback = false, includeAliases = true } = options;
  const candidates = [];
  const explicit = String(product?.image_url || '').trim();
  if (explicit) {
    candidates.push(explicit);
  }
  if (enableSkuFallback) {
    const rawSku = String(product?.sku || '').trim();
    const compactSku = rawSku.replace(/\s+/g, '');
    const upperSku = compactSku.toUpperCase();
    if (compactSku) {
      for (const ext of LOCAL_IMAGE_EXTENSIONS) {
        candidates.push(`/menu-images/${compactSku}.${ext}`);
      }
    }
    if (upperSku && upperSku !== compactSku) {
      for (const ext of LOCAL_IMAGE_EXTENSIONS) {
        candidates.push(`/menu-images/${upperSku}.${ext}`);
      }
    }
    if (includeAliases) {
      const tableroAliases = getTableroImageSkuAliases(product);
      for (const alias of tableroAliases) {
        for (const ext of LOCAL_IMAGE_EXTENSIONS) {
          candidates.push(`/menu-images/${alias}.${ext}`);
        }
      }
    }
  }
  return Array.from(new Set(candidates));
}

function getAccesorioImageCandidates(product) {
  const rawName = String(product?.name || '').trim();
  const normalizedName = normalizeText(rawName);
  const compactName = normalizedName.replace(/\s+/g, '');
  const dashedName = normalizedName.replace(/\s+/g, '-');
  const sku = String(product?.sku || '').trim().toUpperCase();

  const candidates = [];
  for (const ext of LOCAL_IMAGE_EXTENSIONS) {
    if (ACCESORIO_IMAGE_FALLBACK_PATTERNS.includes('name') && normalizedName) {
      candidates.push(`/menu-images/${normalizedName}.${ext}`);
    }
    if (ACCESORIO_IMAGE_FALLBACK_PATTERNS.includes('name_compact') && compactName) {
      candidates.push(`/menu-images/${compactName}.${ext}`);
    }
    if (ACCESORIO_IMAGE_FALLBACK_PATTERNS.includes('name_with_dash') && dashedName) {
      candidates.push(`/menu-images/${dashedName}.${ext}`);
    }
    if (ACCESORIO_IMAGE_FALLBACK_PATTERNS.includes('sku') && sku) {
      candidates.push(`/menu-images/${sku}.${ext}`);
    }
  }
  return Array.from(new Set(candidates));
}

function ProductImage({
  product,
  height,
  enableSkuFallback = false,
  includeAliases = true,
  accessorioFallback = false,
  fit = 'cover',
  imagePadding = 0
}) {
  const candidates = useMemo(
    () => {
      const baseCandidates = getProductImageCandidates(product, { enableSkuFallback, includeAliases });
      const accessoryCandidates = accessorioFallback ? getAccesorioImageCandidates(product) : [];
      return Array.from(new Set([...baseCandidates, ...accessoryCandidates]))
        .filter((candidate) => !FAILED_IMAGE_URLS.has(candidate));
    },
    [product, enableSkuFallback, includeAliases, accessorioFallback]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [product?.sku, product?.image_url, enableSkuFallback]);

  const src = candidates[candidateIndex] || '';
  if (!src) {
    return <div style={{ height, width: '100%', background: IMAGE_FALLBACK_BACKGROUND }} />;
  }

  return (
    <img
      src={src}
      alt={String(product?.name || product?.sku || 'Producto')}
      onError={() => {
        if (src) FAILED_IMAGE_URLS.add(src);
        setCandidateIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
      }}
      style={{
        width: '100%',
        height,
        objectFit: fit,
        objectPosition: 'center',
        display: 'block',
        background: fit === 'contain' ? CONTAIN_IMAGE_BACKGROUND : IMAGE_FALLBACK_BACKGROUND,
        padding: imagePadding,
        boxSizing: 'border-box'
      }}
      loading="lazy"
    />
  );
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
  const [expandedTableroKey, setExpandedTableroKey] = useState(TABLERO_MODELS[0]?.key || '');
  const [isCompactLayout, setIsCompactLayout] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth < 980 : false
  ));

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

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsCompactLayout(window.innerWidth < 980);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  useEffect(() => {
    setExpandedTableroKey((prev) => {
      if (tableroGroups.some((group) => group.key === prev)) return prev;
      return tableroGroups[0]?.key || '';
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
  const toggleTableroDropdown = (modelKey) => {
    setExpandedTableroKey((prev) => (prev === modelKey ? '' : modelKey));
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
        <div className="card" style={{ textAlign: 'center', color: LIGHT_THEME.textMuted, background: LIGHT_THEME.surface, border: `1px solid ${LIGHT_THEME.border}` }}>Cargando menú...</div>
      </div>
    );
  }

  if (error && !menuData) {
    return (
      <div className="container" style={{ maxWidth: '1080px' }}>
        <div className="card" style={{ textAlign: 'center', color: '#dc2626', background: LIGHT_THEME.surface, border: `1px solid ${LIGHT_THEME.border}` }}>{error}</div>
      </div>
    );
  }

  const sellerName = String(menuData?.seller?.display_name || 'Ventas PCX');

  return (
    <div className="container" style={{ maxWidth: '1120px', paddingTop: '28px', color: LIGHT_THEME.text, background: LIGHT_THEME.pageBg, borderRadius: '16px' }}>
      <div className="card" style={{ marginBottom: '14px', background: LIGHT_THEME.surface, border: `1px solid ${LIGHT_THEME.border}`, boxShadow: '0 8px 22px rgba(15, 23, 42, 0.08)' }}>
        <h2 style={{ marginBottom: '8px', color: LIGHT_THEME.primary }}>Menú PCX</h2>
        <p style={{ color: LIGHT_THEME.textSoft, marginBottom: '4px' }}>
          Elige tus productos y envía tu pedido. Te contactará <strong>{sellerName}</strong>.
        </p>
        {menuData?.default_store && (
          <p style={{ color: LIGHT_THEME.textMuted, fontSize: '0.9rem' }}>
            Despacho base: {menuData.default_store}
          </p>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isCompactLayout ? '1fr' : 'minmax(0, 1fr) 340px',
          gap: isCompactLayout ? '12px' : '14px',
          alignItems: 'start'
        }}
      >
        <div className="card" style={{ marginBottom: 0, background: LIGHT_THEME.surface, border: `1px solid ${LIGHT_THEME.border}`, boxShadow: '0 8px 22px rgba(15, 23, 42, 0.08)' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className="btn"
                onClick={() => setActiveCategory(category)}
                style={activeCategory === category
                  ? { background: LIGHT_THEME.primary, color: '#fff', border: `1px solid ${LIGHT_THEME.primary}` }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}` }}
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
                const isExpanded = expandedTableroKey === group.key;

                return (
                  <div
                    key={group.key}
                    style={{
                      border: `1px solid ${LIGHT_THEME.border}`,
                      background: LIGHT_THEME.surface,
                      borderRadius: '12px',
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleTableroDropdown(group.key)}
                      style={{
                        width: '100%',
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <div
                        style={{
                          borderBottom: `1px solid ${LIGHT_THEME.border}`,
                          background: LIGHT_THEME.surfaceAlt
                        }}
                      >
                        <ProductImage
                          product={selectedProduct}
                          height={isCompactLayout ? '180px' : '220px'}
                          enableSkuFallback
                          fit="contain"
                          imagePadding="10px"
                        />
                      </div>
                      <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800, color: LIGHT_THEME.text, marginBottom: '3px' }}>
                            Tablero {group.title}
                          </div>
                          <div style={{ color: '#10b981', fontSize: '0.95rem', fontWeight: 700 }}>
                            {selectedProduct ? `${Number(selectedProduct.price || 0).toFixed(2)} Bs` : 'No disponible'}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            border: `1px solid ${isExpanded ? '#93c5fd' : LIGHT_THEME.border}`,
                            borderRadius: '999px',
                            padding: '6px 10px',
                            background: isExpanded ? 'rgba(59,130,246,0.1)' : '#fff',
                            color: isExpanded ? '#1d4ed8' : LIGHT_THEME.textSoft,
                            fontSize: '0.82rem',
                            fontWeight: 800
                          }}
                        >
                          Más
                          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${LIGHT_THEME.border}`, padding: '10px 12px', display: 'grid', gap: '8px', background: '#fff' }}>
                        {group.variants.map((variant) => {
                          const variantProduct = variant.product;
                          const isUnavailable = !variantProduct;
                          const variantQty = variantProduct ? Number(quantities[variantProduct.sku] || 0) : 0;
                          const isSelected = variant.key === selectedVariant?.key;
                          return (
                            <div
                              key={`${group.key}-${variant.key}`}
                              style={{
                                border: `1px solid ${isSelected ? '#93c5fd' : LIGHT_THEME.border}`,
                                background: isSelected ? 'rgba(59,130,246,0.06)' : '#fff',
                                borderRadius: '10px',
                                padding: '8px',
                                display: 'grid',
                                gridTemplateColumns: isCompactLayout ? '1fr' : 'minmax(0, 1fr) auto',
                                gap: '8px',
                                alignItems: 'center',
                                opacity: isUnavailable ? 0.64 : 1
                              }}
                            >
                              <button
                                type="button"
                                disabled={isUnavailable}
                                onClick={() => variantProduct && selectTableroVariant(group.key, variant.key)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  padding: 0,
                                  width: '100%',
                                  textAlign: 'left',
                                  cursor: isUnavailable ? 'not-allowed' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px'
                                }}
                              >
                                <div
                                  style={{
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '8px',
                                    border: `1px solid ${LIGHT_THEME.border}`,
                                    overflow: 'hidden',
                                    background: LIGHT_THEME.surfaceAlt,
                                    flexShrink: 0
                                  }}
                                >
                                  {variantProduct ? (
                                    <ProductImage
                                      product={variantProduct}
                                      height="56px"
                                      enableSkuFallback
                                      includeAliases={false}
                                      fit="contain"
                                      imagePadding="4px"
                                    />
                                  ) : (
                                    <div style={{ width: '100%', height: '100%', background: '#f1f5f9' }} />
                                  )}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      fontWeight: 700,
                                      color: LIGHT_THEME.text,
                                      whiteSpace: 'nowrap',
                                      lineHeight: 1.2
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: '10px',
                                        height: '10px',
                                        borderRadius: '999px',
                                        background: variant.hex,
                                        border: variant.hex === '#f8fafc' ? '1px solid #94a3b8' : '1px solid rgba(15,23,42,0.22)'
                                      }}
                                    />
                                    {variant.label}
                                  </div>
                                  <div style={{ color: LIGHT_THEME.textMuted, fontSize: '0.8rem' }}>
                                    {variantProduct?.sku || 'No disponible'}
                                  </div>
                                  <div style={{ color: '#10b981', fontWeight: 700, fontSize: '0.9rem' }}>
                                    {variantProduct ? `${Number(variantProduct.price || 0).toFixed(2)} Bs` : '—'}
                                  </div>
                                </div>
                              </button>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifySelf: isCompactLayout ? 'start' : 'end' }}>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => variantProduct && decrease(variantProduct.sku)}
                                  disabled={isUnavailable}
                                  style={{ minHeight: '34px', minWidth: '34px', padding: '6px', background: '#e2e8f0', color: '#0f172a' }}
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={variantQty}
                                  onChange={(e) => variantProduct && setQty(variantProduct.sku, e.target.value)}
                                  disabled={isUnavailable}
                                  style={{
                                    width: '68px',
                                    minHeight: '34px',
                                    textAlign: 'center',
                                    borderRadius: '8px',
                                    border: `1px solid ${LIGHT_THEME.border}`,
                                    background: '#fff',
                                    color: LIGHT_THEME.text
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => variantProduct && increase(variantProduct.sku)}
                                  disabled={isUnavailable}
                                  style={{ minHeight: '34px', minWidth: '34px', padding: '6px', background: '#2563eb', color: '#fff' }}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isCompactLayout ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {filteredProducts.map((product) => {
                const qty = Number(quantities[product.sku] || 0);
                return (
                  <div key={product.sku} style={{
                    border: `1px solid ${LIGHT_THEME.border}`,
                    background: LIGHT_THEME.surface,
                    borderRadius: '12px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '128px',
                      borderBottom: `1px solid ${LIGHT_THEME.border}`,
                      background: LIGHT_THEME.surfaceAlt
                    }}>
                      <ProductImage
                        product={product}
                        height="128px"
                        accessorioFallback
                      />
                    </div>
                    <div style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px', color: LIGHT_THEME.text }}>{product.name}</div>
                      <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                        {Number(product.price || 0).toFixed(2)} Bs
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button type="button" className="btn" onClick={() => decrease(product.sku)} style={{ minHeight: '34px', padding: '6px 10px', background: '#e2e8f0', color: '#0f172a' }}>-</button>
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
                            border: `1px solid ${LIGHT_THEME.border}`,
                            background: '#fff',
                            color: LIGHT_THEME.text
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

        <div
          className="card"
          style={{
            marginBottom: 0,
            background: LIGHT_THEME.surface,
            border: `1px solid ${LIGHT_THEME.border}`,
            boxShadow: '0 8px 22px rgba(15, 23, 42, 0.08)',
            position: isCompactLayout ? 'static' : 'sticky',
            top: isCompactLayout ? 'auto' : '88px'
          }}
        >
          <h3 style={{ marginBottom: '8px', color: LIGHT_THEME.text }}>Tu pedido</h3>
          <div style={{ color: LIGHT_THEME.textMuted, fontSize: '0.9rem', marginBottom: '12px' }}>
            {cartUnits} unidad(es) · {cartTotal.toFixed(2)} Bs
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '12px', paddingRight: '4px' }}>
            {cartItems.length === 0 ? (
              <div style={{ color: LIGHT_THEME.textMuted }}>Aún no agregaste productos.</div>
            ) : cartItems.map((item) => (
              <div key={`cart-${item.sku}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', color: LIGHT_THEME.text }}>
                <span>{item.qty}× {item.name}</span>
                <strong>{item.lineTotal.toFixed(2)} Bs</strong>
              </div>
            ))}
          </div>

          <form onSubmit={submitOrder} style={{ display: 'grid', gap: '8px' }}>
            <input
              type="text"
              placeholder="Nombre/Apellidos"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              style={{ minHeight: '40px', borderRadius: '8px', border: `1px solid ${LIGHT_THEME.border}`, background: LIGHT_THEME.inputBg, color: LIGHT_THEME.text, padding: '8px 10px' }}
            />
            <input
              type="text"
              placeholder="Telefono"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              required
              style={{ minHeight: '40px', borderRadius: '8px', border: `1px solid ${LIGHT_THEME.border}`, background: LIGHT_THEME.inputBg, color: LIGHT_THEME.text, padding: '8px 10px' }}
            />
            <textarea
              rows={3}
              placeholder="Nota (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ borderRadius: '8px', border: `1px solid ${LIGHT_THEME.border}`, background: LIGHT_THEME.inputBg, color: LIGHT_THEME.text, padding: '8px 10px' }}
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
