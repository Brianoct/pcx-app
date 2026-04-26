import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, apiRequest } from './apiClient';
import pdfLogo from './assets/logo.png';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';
const SEGMENT_TALLERES = 'talleres';
const SEGMENT_HOGAR = 'hogar';
const SEGMENT_OPTIONS = [
  { key: SEGMENT_TALLERES, title: 'Para Talleres y Profesionales' },
  { key: SEGMENT_HOGAR, title: 'Para el Hogar (Multifunciones)' }
];
const INDUSTRIAL_TABLERO_MODELS = new Set(['T10x99', 'T61x95', 'T94x95']);
const HOGAR_TABLERO_MODELS = new Set(['T47x64']);
const HOGAR_ACCESSORY_KEYWORDS = [
  'plastico',
  'plástico',
  'multifuncion',
  'multifunción',
  'bandeja'
];
const HOGAR_ACCESSORY_GANCHO_HINTS = ['gancho', 'j', '5cm', '8cm', 'blanco', 'negro'];
const INDUSTRIAL_ACCESSORY_KEYWORDS = ['cromo', 'metal', 'acero', 'industrial'];
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
const TABLERO_COLOR_VARIANTS = [
  { key: 'rojo', label: 'Rojo', hex: '#ef4444' },
  { key: 'negro', label: 'Negro', hex: '#111827' },
  { key: 'amarillo', label: 'Amarillo', hex: '#facc15' },
  { key: 'azul_petroleo', label: 'Azul Petroleo', hex: '#0f766e' },
  { key: 'plomo', label: 'Plomo', hex: '#6b7280' },
  { key: 'blanco', label: 'Blanco', hex: '#f8fafc' }
];
const TABLERO_COLOR_CODES = {
  rojo: 'R',
  negro: 'N',
  amarillo: 'A',
  azul_petroleo: 'AP',
  plomo: 'P',
  blanco: 'B'
};
const TABLERO_COLOR_BY_KEY = Object.fromEntries(TABLERO_COLOR_VARIANTS.map((item) => [item.key, item]));
const TABLERO_KNOWN_COLOR_KEYS = TABLERO_COLOR_VARIANTS.map((item) => item.key);
const TABLERO_SKU_SUFFIX_TO_COLOR_KEY = {
  AP: 'azul_petroleo',
  AM: 'amarillo',
  PL: 'plomo',
  BL: 'blanco',
  R: 'rojo',
  N: 'negro',
  A: 'amarillo',
  P: 'plomo',
  B: 'blanco'
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

function extractTableroDimensionsToken(value) {
  const normalized = normalizeSkuToken(value);
  let match = normalized.match(/T(\d{2,3})X(\d{2,3})/);
  if (match) return `${match[1]}x${match[2]}`;

  match = normalized.match(/T(\d{4,6})/);
  if (!match) return null;
  const digits = String(match[1] || '');
  if (digits.length === 4) return `${digits.slice(0, 2)}x${digits.slice(2)}`;
  if (digits.length === 5) return `${digits.slice(0, 2)}x${digits.slice(2)}`;
  if (digits.length >= 6) return `${digits.slice(0, 3)}x${digits.slice(3, 6)}`;
  return null;
}

function formatTableroModelLabel(modelKey) {
  const dimensions = String(modelKey || '').replace(/^T/i, '').trim();
  if (!dimensions) return String(modelKey || '').trim() || 'Modelo';
  return dimensions;
}

function getTableroModelSortValue(modelKey) {
  const dimensions = String(modelKey || '').replace(/^T/i, '').trim();
  const match = dimensions.match(/^(\d{2,3})x(\d{2,3})$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return Number.POSITIVE_INFINITY;
  return width * 1000 + height;
}

function normalizeTableroModelKey(modelKey) {
  const cleaned = String(modelKey || '')
    .trim()
    .replace(/^T/i, '')
    .replace(/\s+/g, '')
    .replace(/X/g, 'x');
  return cleaned ? `T${cleaned}` : '';
}

function getTableroSegmentByModel(modelKey) {
  const normalized = normalizeTableroModelKey(modelKey);
  if (HOGAR_TABLERO_MODELS.has(normalized)) return SEGMENT_HOGAR;
  if (INDUSTRIAL_TABLERO_MODELS.has(normalized)) return SEGMENT_TALLERES;
  return SEGMENT_TALLERES;
}

function detectTableroModelKey(product) {
  const combined = `${String(product?.sku || '')} ${String(product?.name || '')}`;
  const dimensions = extractTableroDimensionsToken(combined);
  if (dimensions) return `T${dimensions}`;
  const rawSku = normalizeSkuToken(product?.sku || '');
  if (rawSku.startsWith('T') && rawSku.length >= 3) {
    return rawSku;
  }
  return null;
}

function detectTableroColorKey(product) {
  const normalized = normalizeText(`${String(product?.name || '')} ${String(product?.sku || '')}`);
  if (normalized.includes('blanco')) return 'blanco';
  if (normalized.includes('azul petroleo') || normalized.includes('azulpetroleo')) return 'azul_petroleo';
  if (normalized.includes('plomo')) return 'plomo';
  if (normalized.includes('amarillo')) return 'amarillo';
  if (normalized.includes('negro')) return 'negro';
  if (normalized.includes('rojo')) return 'rojo';

  const normalizedSku = normalizeSkuToken(product?.sku || '');
  const suffixChecks = Object.keys(TABLERO_SKU_SUFFIX_TO_COLOR_KEY).sort((a, b) => b.length - a.length);
  for (const suffix of suffixChecks) {
    if (normalizedSku.endsWith(suffix)) {
      return TABLERO_SKU_SUFFIX_TO_COLOR_KEY[suffix];
    }
  }
  return null;
}

function getTableroVariantLabel(product, colorKey) {
  if (TABLERO_COLOR_BY_KEY[colorKey]) return TABLERO_COLOR_BY_KEY[colorKey].label;
  const fallback = String(product?.name || product?.sku || '').trim();
  return fallback || 'Variante';
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
  const explicitRaw = String(product?.image_url || '').trim();
  const explicit = explicitRaw.startsWith('/customer-menu-images/')
    ? `${String(API_BASE || '').replace(/\/+$/, '')}${explicitRaw}`
    : explicitRaw;
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

function isComboProduct(product) {
  const sku = normalizeSkuToken(product?.sku || '');
  const name = normalizeText(product?.name || '');
  return sku.startsWith('COMBO') || name.includes('combo');
}

function isHogarAccessoryProduct(product) {
  const text = normalizeText(`${product?.name || ''} ${product?.sku || ''}`);
  if (INDUSTRIAL_ACCESSORY_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)))) {
    return false;
  }
  if (HOGAR_ACCESSORY_KEYWORDS.some((keyword) => text.includes(normalizeText(keyword)))) {
    return true;
  }
  // Some legacy product names omit "plastico" but are still hogar hooks.
  return text.includes('gancho') && HOGAR_ACCESSORY_GANCHO_HINTS.some((hint) => text.includes(hint));
}

function isHogarComboProduct(product) {
  const text = normalizeText(`${product?.name || ''} ${product?.sku || ''}`);
  return (
    text.includes('47x64')
    || text.includes('multifuncion')
    || text.includes('multifunción')
    || text.includes('hogar')
    || text.includes('plastico')
    || text.includes('plástico')
  );
}

function shouldShowAccessoryInSegment(product, segment) {
  if (segment === SEGMENT_HOGAR) {
    return isHogarAccessoryProduct(product);
  }
  return !isHogarAccessoryProduct(product);
}

function shouldShowComboInSegment(product, segment) {
  if (segment === SEGMENT_HOGAR) {
    return isHogarComboProduct(product);
  }
  return !isHogarComboProduct(product);
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
  const [activeSegment, setActiveSegment] = useState(SEGMENT_TALLERES);
  const [quantities, setQuantities] = useState({});
  const [selectedTableroColorByModel, setSelectedTableroColorByModel] = useState({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [provincia, setProvincia] = useState('');
  const [isProvincia, setIsProvincia] = useState(false);
  const [ventaType, setVentaType] = useState('sf');
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
      } catch (err) {
        setError(err.message || 'No se pudo cargar el catálogo');
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
  const tableroProducts = useMemo(
    () => products.filter((product) => String(product.category || CATEGORY_ACCESORIOS) === CATEGORY_TABLEROS),
    [products]
  );
  const tableroGroups = useMemo(() => {
    const byModel = new Map();
    for (const product of tableroProducts) {
      const modelKey = detectTableroModelKey(product);
      if (!modelKey) continue;
      if (!byModel.has(modelKey)) {
        byModel.set(modelKey, {
          key: modelKey,
          title: formatTableroModelLabel(modelKey),
          variantsByKey: new Map()
        });
      }
      const group = byModel.get(modelKey);
      const colorKey = detectTableroColorKey(product) || `variant-${normalizeSkuToken(product?.sku || product?.name || '')}`;
      const colorMeta = TABLERO_COLOR_BY_KEY[colorKey] || {
        key: colorKey,
        label: getTableroVariantLabel(product, colorKey),
        hex: '#cbd5e1'
      };
      if (!group.variantsByKey.has(colorMeta.key)) {
        group.variantsByKey.set(colorMeta.key, {
          ...colorMeta,
          product
        });
      }
    }

    return [...byModel.values()]
      .map((group) => {
        const variants = [...group.variantsByKey.values()]
          .sort((a, b) => {
            const colorRankA = TABLERO_KNOWN_COLOR_KEYS.indexOf(a.key);
            const colorRankB = TABLERO_KNOWN_COLOR_KEYS.indexOf(b.key);
            if (colorRankA !== -1 || colorRankB !== -1) {
              if (colorRankA === -1) return 1;
              if (colorRankB === -1) return -1;
              return colorRankA - colorRankB;
            }
            return String(a.label || '').localeCompare(String(b.label || ''));
          });
        return {
          key: group.key,
          title: group.title,
          variants
        };
      })
      .sort((a, b) => {
        const aScore = getTableroModelSortValue(a.key);
        const bScore = getTableroModelSortValue(b.key);
        if (aScore !== bScore) return aScore - bScore;
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }, [tableroProducts]);

  useEffect(() => {
    setSelectedTableroColorByModel((prev) => {
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

  const accessoryProducts = useMemo(
    () => products
      .filter((product) => String(product.category || CATEGORY_ACCESORIOS) !== CATEGORY_TABLEROS)
      .filter((product) => !isComboProduct(product))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })),
    [products]
  );
  const comboProducts = useMemo(
    () => products
      .filter((product) => isComboProduct(product))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })),
    [products]
  );
  const tablerosTalleres = useMemo(
    () => tableroGroups.filter((group) => getTableroSegmentByModel(group.key) === SEGMENT_TALLERES),
    [tableroGroups]
  );
  const tablerosHogar = useMemo(
    () => tableroGroups.filter((group) => getTableroSegmentByModel(group.key) === SEGMENT_HOGAR),
    [tableroGroups]
  );
  const accesoriosTalleres = useMemo(
    () => accessoryProducts.filter((product) => !isHogarAccessoryProduct(product)),
    [accessoryProducts]
  );
  const accesoriosHogar = useMemo(
    () => accessoryProducts.filter((product) => isHogarAccessoryProduct(product)),
    [accessoryProducts]
  );
  const combosTalleresRaw = useMemo(
    () => comboProducts.filter((product) => !isHogarComboProduct(product)),
    [comboProducts]
  );
  const combosHogarRaw = useMemo(
    () => comboProducts.filter((product) => isHogarComboProduct(product)),
    [comboProducts]
  );
  const combosTalleres = combosTalleresRaw.length > 0 ? combosTalleresRaw : comboProducts;
  const combosHogar = combosHogarRaw.length > 0 ? combosHogarRaw : comboProducts;

  const cartItems = useMemo(() => (
    products
      .filter((product) => Number(quantities[product.sku] || 0) > 0)
      .map((product) => {
        const qty = Number(quantities[product.sku] || 0);
        const price = ventaType === 'cf'
          ? Number(product.price_cf ?? product.cf ?? product.price ?? 0)
          : Number(product.price_sf ?? product.sf ?? product.price ?? 0);
        return {
          ...product,
          qty,
          lineTotal: qty * price
        };
      })
  ), [products, quantities, ventaType]);
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

  const renderCatalogProductCard = (product) => {
    const qty = Number(quantities[product.sku] || 0);
    const displayPrice = ventaType === 'cf'
      ? Number(product.price_cf ?? product.cf ?? product.price ?? 0)
      : Number(product.price_sf ?? product.sf ?? product.price ?? 0);
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
            {displayPrice.toFixed(2)} Bs
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
  };

  const renderTableroGroupCardLegacy = (group) => {
    const selectedColorKey = selectedTableroColorByModel[group.key] || group.variants[0]?.key;
    let selectedVariant = group.variants.find((variant) => variant.key === selectedColorKey) || group.variants[0];
    if (selectedVariant && !selectedVariant.product) {
      selectedVariant = group.variants.find((variant) => Boolean(variant.product)) || selectedVariant;
    }
    const selectedProduct = selectedVariant?.product || null;
    const selectedQty = selectedProduct ? Number(quantities[selectedProduct.sku] || 0) : 0;
    const selectedPrice = selectedProduct
      ? (ventaType === 'cf'
        ? Number(selectedProduct.price_cf ?? selectedProduct.cf ?? selectedProduct.price ?? 0)
        : Number(selectedProduct.price_sf ?? selectedProduct.sf ?? selectedProduct.price ?? 0))
      : 0;
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
                {selectedProduct ? `${selectedPrice.toFixed(2)} Bs` : 'No disponible'}
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
        venta_type: ventaType,
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

  const renderTableroGroupCard = (group) => {
    const selectedColorKey = selectedTableroColorByModel[group.key] || group.variants[0]?.key;
    let selectedVariant = group.variants.find((variant) => variant.key === selectedColorKey) || group.variants[0];
    if (selectedVariant && !selectedVariant.product) {
      selectedVariant = group.variants.find((variant) => Boolean(variant.product)) || selectedVariant;
    }
    const selectedProduct = selectedVariant?.product || null;
    const selectedQty = selectedProduct ? Number(quantities[selectedProduct.sku] || 0) : 0;
    const selectedPrice = selectedProduct
      ? (ventaType === 'cf'
        ? Number(selectedProduct.price_cf ?? selectedProduct.cf ?? selectedProduct.price ?? 0)
        : Number(selectedProduct.price_sf ?? selectedProduct.sf ?? selectedProduct.price ?? 0))
      : 0;
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
                {selectedProduct ? `${selectedPrice.toFixed(2)} Bs` : 'No disponible'}
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
  };

  const renderAccessoryGrid = (items, emptyMessage) => {
    if (!Array.isArray(items) || items.length === 0) {
      return <div style={{ color: LIGHT_THEME.textMuted }}>{emptyMessage}</div>;
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: isCompactLayout ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        {items.map((product) => {
          const qty = Number(quantities[product.sku] || 0);
          const displayPrice = ventaType === 'cf'
            ? Number(product.price_cf ?? product.cf ?? product.price ?? 0)
            : Number(product.price_sf ?? product.sf ?? product.price ?? 0);
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
                  {displayPrice.toFixed(2)} Bs
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
    );
  };

  const sectionRows = activeSegment === SEGMENT_HOGAR
    ? [
      { key: 'hogar-tableros', title: 'Tableros Multifunciones', kind: 'tableros', items: tablerosHogar, empty: 'Sin tableros multifunciones disponibles.' },
      { key: 'hogar-accesorios', title: 'Accesorios de Plástico', kind: 'grid', items: accesoriosHogar, empty: 'Sin accesorios de plástico disponibles.' },
      { key: 'hogar-combos', title: 'Combos', kind: 'grid', items: combosHogar, empty: 'Sin combos para hogar disponibles.' }
    ]
    : [
      { key: 'talleres-tableros', title: 'Tableros Metálicos Industriales', kind: 'tableros', items: tablerosTalleres, empty: 'Sin tableros industriales disponibles.' },
      { key: 'talleres-accesorios', title: 'Accesorios', kind: 'grid', items: accesoriosTalleres, empty: 'Sin accesorios disponibles.' },
      { key: 'talleres-combos', title: 'Combos', kind: 'grid', items: combosTalleres, empty: 'Sin combos disponibles.' }
    ];

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
          <div style={{ color: LIGHT_THEME.textSoft, fontSize: '0.92rem', marginBottom: '8px', fontWeight: 700 }}>
            Tienda PCX
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {SEGMENT_OPTIONS.map((segment) => (
              <button
                key={segment.key}
                type="button"
                className="btn"
                onClick={() => setActiveSegment(segment.key)}
                style={activeSegment === segment.key
                  ? { background: LIGHT_THEME.primary, color: '#fff', border: `1px solid ${LIGHT_THEME.primary}` }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}` }}
              >
                {segment.title}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {sectionRows.map((section) => (
              <section
                key={section.key}
                style={{
                  border: `1px solid ${LIGHT_THEME.border}`,
                  background: LIGHT_THEME.surface,
                  borderRadius: '12px',
                  padding: isCompactLayout ? '10px' : '12px',
                  display: 'grid',
                  gap: '10px'
                }}
              >
                <h3 style={{ margin: 0, color: LIGHT_THEME.text, fontSize: '1rem' }}>{section.title}</h3>
                {section.kind === 'tableros'
                  ? (section.items.length === 0
                    ? <div style={{ color: LIGHT_THEME.textMuted, fontSize: '0.9rem' }}>{section.empty}</div>
                    : section.items.map((group) => renderTableroGroupCard(group)))
                  : renderAccessoryGrid(section.items, section.empty)}
              </section>
            ))}
          </div>
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
            {cartUnits} unidad(es)
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ marginBottom: '6px', color: LIGHT_THEME.textSoft, fontSize: '0.9rem' }}>Tipo de venta</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setVentaType('sf')}
                style={ventaType === 'sf'
                  ? { background: LIGHT_THEME.primary, color: '#fff', border: `1px solid ${LIGHT_THEME.primary}` }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}` }}
              >
                Sin factura
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setVentaType('cf')}
                style={ventaType === 'cf'
                  ? { background: LIGHT_THEME.primary, color: '#fff', border: `1px solid ${LIGHT_THEME.primary}` }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}` }}
              >
                Con factura
              </button>
            </div>
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '8px', paddingRight: '4px' }}>
            {cartItems.length === 0 ? (
              <div style={{ color: LIGHT_THEME.textMuted }}>Aún no agregaste productos.</div>
            ) : cartItems.map((item) => (
              <div key={`cart-${item.sku}`} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: '8px',
                marginBottom: '8px',
                color: LIGHT_THEME.text,
                borderBottom: `1px dashed ${LIGHT_THEME.border}`,
                paddingBottom: '6px'
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: LIGHT_THEME.textMuted }}>
                    {item.qty} x {(Number(item.lineTotal || 0) / Math.max(Number(item.qty || 1), 1)).toFixed(2)} Bs
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => decrease(item.sku)}
                      style={{ minHeight: '28px', minWidth: '28px', padding: '0 8px', background: '#e2e8f0', color: '#0f172a' }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => increase(item.sku)}
                      style={{ minHeight: '28px', minWidth: '28px', padding: '0 8px', background: '#2563eb', color: '#fff' }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setQty(item.sku, 0)}
                      style={{ minHeight: '28px', padding: '0 8px', background: '#ef4444', color: '#fff' }}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
                <strong style={{ alignSelf: 'start' }}>{item.lineTotal.toFixed(2)} Bs</strong>
              </div>
            ))}
          </div>
          <div style={{
            marginBottom: '12px',
            paddingTop: '8px',
            borderTop: `1px solid ${LIGHT_THEME.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: LIGHT_THEME.textSoft, fontWeight: 700 }}>Total</span>
            <strong style={{ color: LIGHT_THEME.text, fontSize: '1rem' }}>{cartTotal.toFixed(2)} Bs</strong>
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
