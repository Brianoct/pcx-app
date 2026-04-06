import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';
import pdfLogo from './assets/logo.png';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';
const DEPARTMENT_OPTIONS = [
  'Beni',
  'Chuquisaca',
  'Cochabamba',
  'La Paz',
  'Oruro',
  'Pando',
  'Potosí',
  'Santa Cruz',
  'Tarija'
];
const TABLERO_MODELS = [
  { key: 'T61x95', label: 'T61x95' },
  { key: 'T94x95', label: 'T94x95' },
  { key: 'T10x99', label: 'T10x99' }
];
const TABLERO_COLOR_VARIANTS = [
  { key: 'rojo', label: 'Rojo', hex: '#ef4444' },
  { key: 'negro', label: 'Negro', hex: '#111827' },
  { key: 'amarillo', label: 'Amarillo', hex: '#facc15' },
  { key: 'azul_petroleo', label: 'Azul Petroleo', hex: '#0f766e' },
  { key: 'plomo', label: 'Plomo', hex: '#6b7280' }
];
const TABLERO_MODEL_COLOR_KEYS = {
  T10x99: ['negro']
};
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

function getTableroVariantsForModel(modelKey) {
  const allowedKeys = TABLERO_MODEL_COLOR_KEYS[modelKey];
  if (!Array.isArray(allowedKeys) || allowedKeys.length === 0) return TABLERO_COLOR_VARIANTS;
  const allowedSet = new Set(allowedKeys);
  return TABLERO_COLOR_VARIANTS.filter((variant) => allowedSet.has(variant.key));
}

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
  if (raw.includes('T10X99') || raw.includes('T1099') || raw.includes('1099')) return 'T10x99';
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
    `${compactModel}${colorCode}`,
    `${compactModel}${colorCode}`.toUpperCase(),
    preferred,
    preferred.toUpperCase()
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
    const skuBaseCandidates = [];
    if (compactSku) skuBaseCandidates.push(compactSku);
    if (upperSku && upperSku !== compactSku) skuBaseCandidates.push(upperSku);
    const aliasBaseCandidates = includeAliases ? getTableroImageSkuAliases(product) : [];
    // Prefer compact tablero aliases (e.g. T9495R/T6195R) first to match the
    // filename scheme currently used in menu-images.
    const orderedBaseCandidates = Array.from(new Set([
      ...aliasBaseCandidates,
      ...skuBaseCandidates
    ]));
    for (const base of orderedBaseCandidates) {
      for (const ext of LOCAL_IMAGE_EXTENSIONS) {
        candidates.push(`/menu-images/${base}.${ext}`);
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
  const [department, setDepartment] = useState('');
  const [provincia, setProvincia] = useState('');
  const [isProvincia, setIsProvincia] = useState(false);
  const [notes, setNotes] = useState('');
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

    return TABLERO_MODELS.map((model) => {
      const variantsForModel = getTableroVariantsForModel(model.key);
      return {
        key: model.key,
        title: model.label,
        variants: variantsForModel.map((color) => ({
          ...color,
          product: byModelAndColor.get(`${model.key}|${color.key}`) || null
        }))
      };
    });
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
    if (isProvincia && !String(provincia || '').trim()) {
      alert('Completa la provincia');
      return;
    }
    if (!isProvincia && !String(department || '').trim()) {
      alert('Selecciona un departamento');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(null);
    try {
      const payload = {
        customer_name: String(customerName || '').trim(),
        customer_phone: String(customerPhone || '').trim(),
        department: isProvincia ? null : (String(department || '').trim() || null),
        provincia: isProvincia ? (String(provincia || '').trim() || null) : null,
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
        <div className="card" style={{ textAlign: 'center', color: LIGHT_THEME.textMuted, background: LIGHT_THEME.surface, border: `1px solid ${LIGHT_THEME.border}` }}>Cargando Catalogo...</div>
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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <img
            src={pdfLogo}
            alt="PCX"
            style={{ width: '108px', height: 'auto', display: 'block', objectFit: 'contain' }}
            loading="eager"
          />
          <h2 style={{ marginBottom: 0, color: LIGHT_THEME.primary }}>Catálogo PCX</h2>
        </div>
        <p style={{ color: LIGHT_THEME.textSoft, marginBottom: '4px' }}>
          Hola, soy <strong>{sellerName}</strong>. Este es nuestro catálogo de productos. Selecciona los productos que deseas.
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
            <div style={{ display: 'grid', gap: '14px' }}>
              {tableroGroups.map((group) => {
                const selectedColorKey = selectedTableroColorByModel[group.key] || group.variants[0]?.key;
                let selectedVariant = group.variants.find((variant) => variant.key === selectedColorKey) || group.variants[0];
                if (selectedVariant && !selectedVariant.product) {
                  selectedVariant = group.variants.find((variant) => Boolean(variant.product)) || selectedVariant;
                }
                const selectedProduct = selectedVariant?.product || null;
                const selectedQty = selectedProduct ? Number(quantities[selectedProduct.sku] || 0) : 0;
                const availableVariants = group.variants.filter((variant) => Boolean(variant.product));

                return (
                  <div
                    key={group.key}
                    style={{
                      border: `1px solid ${LIGHT_THEME.border}`,
                      background: LIGHT_THEME.surface,
                      borderRadius: '12px',
                      padding: isCompactLayout ? '12px' : '14px',
                      display: 'grid',
                      gap: '12px'
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isCompactLayout ? '1fr' : 'minmax(0, 1.1fr) minmax(320px, 0.9fr)',
                        gap: isCompactLayout ? '12px' : '16px',
                        alignItems: 'start'
                      }}
                    >
                      <div
                        style={{
                          border: `1px solid ${LIGHT_THEME.border}`,
                          borderRadius: '12px',
                          background: LIGHT_THEME.surfaceAlt,
                          overflow: 'hidden'
                        }}
                      >
                        <ProductImage
                          product={selectedProduct}
                          height={isCompactLayout ? '220px' : '320px'}
                          enableSkuFallback
                          fit="contain"
                          imagePadding={isCompactLayout ? '10px' : '14px'}
                        />
                      </div>

                      <div style={{ display: 'grid', gap: '12px', alignContent: 'start' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '1.45rem', color: LIGHT_THEME.text, lineHeight: 1.1 }}>
                            Tablero {group.title}
                          </div>
                          <div style={{ color: LIGHT_THEME.textMuted, marginTop: '4px' }}>
                            Selecciona un color y ajusta cantidad
                          </div>
                          <div style={{ color: '#10b981', fontWeight: 800, marginTop: '8px', fontSize: '1.15rem' }}>
                            {selectedProduct ? `${Number(selectedProduct.price || 0).toFixed(2)} Bs` : 'No disponible'}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => selectedProduct && decrease(selectedProduct.sku)}
                            disabled={!selectedProduct}
                            style={{ minHeight: '38px', minWidth: '38px', padding: '8px', background: '#e2e8f0', color: '#0f172a', fontSize: '1rem' }}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={selectedQty}
                            onChange={(e) => selectedProduct && setQty(selectedProduct.sku, e.target.value)}
                            disabled={!selectedProduct}
                            style={{
                              width: '86px',
                              minHeight: '38px',
                              textAlign: 'center',
                              borderRadius: '8px',
                              border: `1px solid ${LIGHT_THEME.border}`,
                              background: '#fff',
                              color: LIGHT_THEME.text,
                              fontSize: '1rem'
                            }}
                          />
                          <button
                            type="button"
                            className="btn"
                            onClick={() => selectedProduct && increase(selectedProduct.sku)}
                            disabled={!selectedProduct}
                            style={{ minHeight: '38px', minWidth: '38px', padding: '8px', background: '#2563eb', color: '#fff', fontSize: '1rem' }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {availableVariants.map((variant) => {
                        const variantProduct = variant.product;
                        if (!variantProduct) return null;
                        const isSelected = variant.key === selectedVariant?.key;
                        return (
                          <button
                            key={`${group.key}-thumb-${variant.key}`}
                            type="button"
                            onClick={() => selectTableroVariant(group.key, variant.key)}
                            style={{
                              border: `1px solid ${isSelected ? '#3b82f6' : LIGHT_THEME.border}`,
                              background: isSelected ? 'rgba(59,130,246,0.08)' : '#fff',
                              borderRadius: '10px',
                              padding: '6px',
                              width: isCompactLayout ? '66px' : '74px',
                              display: 'grid',
                              gap: '5px',
                              justifyItems: 'center',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{
                              width: isCompactLayout ? '52px' : '60px',
                              height: isCompactLayout ? '52px' : '60px',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              border: `1px solid ${LIGHT_THEME.border}`,
                              background: LIGHT_THEME.surfaceAlt
                            }}>
                              <ProductImage
                                product={variantProduct}
                                height={isCompactLayout ? '52px' : '60px'}
                                enableSkuFallback
                                fit="contain"
                                imagePadding="4px"
                              />
                            </div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', fontWeight: 700, color: LIGHT_THEME.text }}>
                              <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '999px',
                                background: variant.hex,
                                border: variant.hex === '#f8fafc' ? '1px solid #94a3b8' : '1px solid rgba(15,23,42,0.22)'
                              }} />
                              {variant.label}
                            </div>
                          </button>
                        );
                      })}
                    </div>
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
                    overflow: 'hidden',
                    display: 'grid',
                    gridTemplateRows: '156px minmax(0, 1fr)'
                  }}>
                    <div style={{
                      borderBottom: `1px solid ${LIGHT_THEME.border}`,
                      background: LIGHT_THEME.surfaceAlt
                    }}>
                      <ProductImage
                        product={product}
                        height="156px"
                        accessorioFallback
                        fit="contain"
                        imagePadding="10px"
                      />
                    </div>
                    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', minHeight: '144px' }}>
                      <div style={{
                        fontWeight: 700,
                        marginBottom: '4px',
                        color: LIGHT_THEME.text,
                        minHeight: '54px',
                        lineHeight: 1.2
                      }}>
                        {product.name}
                      </div>
                      <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                        {Number(product.price || 0).toFixed(2)} Bs
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: 'auto' }}>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: LIGHT_THEME.textSoft, fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={isProvincia}
                onChange={(e) => setIsProvincia(e.target.checked)}
              />
              Provincia (no departamento)
            </label>
            {isProvincia ? (
              <input
                type="text"
                maxLength={26}
                placeholder="Provincia"
                value={provincia}
                onChange={(e) => setProvincia(e.target.value)}
                required
                style={{ minHeight: '40px', borderRadius: '8px', border: `1px solid ${LIGHT_THEME.border}`, background: LIGHT_THEME.inputBg, color: LIGHT_THEME.text, padding: '8px 10px' }}
              />
            ) : (
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                required
                style={{
                  minHeight: '40px',
                  borderRadius: '8px',
                  border: `1px solid ${LIGHT_THEME.border}`,
                  background: LIGHT_THEME.inputBg,
                  color: LIGHT_THEME.text,
                  padding: '8px 34px 8px 10px',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  backgroundSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <option value="" disabled>Departamento</option>
                {DEPARTMENT_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            )}
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
