import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, apiRequest } from './apiClient';
import pdfLogo from './assets/logo.png';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';
const SEGMENT_TALLERES = 'talleres';
const SEGMENT_HOGAR = 'hogar';
const SEGMENT_OPTIONS = [
  { key: SEGMENT_TALLERES, title: 'Herramientas' },
  { key: SEGMENT_HOGAR, title: 'Hogar' }
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
const SEGMENT_VISUALS = {
  [SEGMENT_TALLERES]: {
    heroTitle: 'PCX Acero',
    heroSubtitle: 'Shops, fabricas y garajes',
    heroBg: 'linear-gradient(140deg, #0f172a 0%, #111827 55%, #1f2937 100%)',
    heroPattern: 'radial-gradient(circle at 10px 10px, rgba(255,255,255,0.16) 1.4px, transparent 1.5px)',
    heroPatternSize: '26px 26px',
    heroText: '#e2e8f0',
    heroSubText: '#94a3b8',
    accent: '#ef4444',
    panelBg: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
    sectionBg: 'linear-gradient(180deg, rgba(15,23,42,0.04), rgba(255,255,255,0.98))',
    sectionBorder: '#cdd8e6'
  },
  [SEGMENT_HOGAR]: {
    heroTitle: 'PCX Armonia',
    heroSubtitle: 'Disenada para tu espacio',
    heroBg: 'linear-gradient(140deg, #f3e5dd 0%, #fdf7f2 62%, #f7ede7 100%)',
    heroPattern: 'radial-gradient(circle at 10px 10px, rgba(155,122,104,0.20) 1.2px, transparent 1.3px)',
    heroPatternSize: '24px 24px',
    heroText: '#8b6b5c',
    heroSubText: '#b08b7b',
    accent: '#c78f76',
    panelBg: 'linear-gradient(180deg, #fffaf7 0%, #ffffff 100%)',
    sectionBg: 'linear-gradient(180deg, rgba(227,201,186,0.24), rgba(255,255,255,0.98))',
    sectionBorder: '#e8d5c9'
  }
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
  const explicit = (
    explicitRaw.startsWith('/customer-menu-images/')
    || explicitRaw.startsWith('/menu-images/')
    || explicitRaw.startsWith('/api/public/menu-image/')
  )
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
  const [isCheckoutExpanded, setIsCheckoutExpanded] = useState(false);
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
  const comboProducts = useMemo(
    () => products
      .filter((product) => isComboProduct(product))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })),
    [products]
  );
  const nonComboProducts = useMemo(
    () => products.filter((product) => !isComboProduct(product)),
    [products]
  );
  const tableroProducts = useMemo(
    () => nonComboProducts.filter((product) => {
      const isTableroCategory = String(product.category || CATEGORY_ACCESORIOS) === CATEGORY_TABLEROS;
      return isTableroCategory && Boolean(detectTableroModelKey(product));
    }),
    [nonComboProducts]
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
    () => nonComboProducts
      .filter((product) => {
        const isTableroCategory = String(product.category || CATEGORY_ACCESORIOS) === CATEGORY_TABLEROS;
        // Safety net: if a product is tagged as Tableros but has no tablero model
        // dimensions (e.g. G08BP), still show it as accessory instead of hiding it.
        if (!isTableroCategory) return true;
        return !detectTableroModelKey(product);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })),
    [nonComboProducts]
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
  const ventaTypeLabel = ventaType === 'cf' ? 'Con factura' : 'Sin factura';

  useEffect(() => {
    if (cartItems.length === 0 && isCheckoutExpanded) {
      setIsCheckoutExpanded(false);
    }
  }, [cartItems.length, isCheckoutExpanded]);

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
      setCustomerName('');
      setCustomerPhone('');
      setDepartment('');
      setProvincia('');
      setIsProvincia(false);
      setIsCheckoutExpanded(false);
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

  const desktopWorkspaceMaxWidth = 1240;
  const desktopCartPanelWidth = 430;

  const renderTableroGroupCard = (group) => {
    const selectedColorKey = selectedTableroColorByModel[group.key] || group.variants[0]?.key;
    let selectedVariant = group.variants.find((variant) => variant.key === selectedColorKey) || group.variants[0];
    if (selectedVariant && !selectedVariant.product) {
      selectedVariant = group.variants.find((variant) => Boolean(variant.product)) || selectedVariant;
    }
    const availableVariants = group.variants.filter((variant) => Boolean(variant.product));

    return (
      <div
        key={group.key}
        style={{
          border: `1px solid ${LIGHT_THEME.border}`,
          background: LIGHT_THEME.surface,
          borderRadius: '12px',
          padding: isCompactLayout ? '10px' : '11px',
          display: 'grid',
          gap: '8px'
        }}
      >
        <div style={{ fontWeight: 700, fontSize: isCompactLayout ? '1.08rem' : '1.15rem', color: LIGHT_THEME.text, lineHeight: 1.05 }}>
          Tablero {group.title}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '7px',
            justifyContent: 'center'
          }}
        >
          {availableVariants.map((variant) => {
            const variantProduct = variant.product;
            if (!variantProduct) return null;
            const variantQty = Number(quantities[variantProduct.sku] || 0);
            const isSelected = variant.key === selectedVariant?.key;
            const variantPrice = ventaType === 'cf'
              ? Number(variantProduct.price_cf ?? variantProduct.cf ?? variantProduct.price ?? 0)
              : Number(variantProduct.price_sf ?? variantProduct.sf ?? variantProduct.price ?? 0);
            return (
              <button
                key={`${group.key}-tile-${variant.key}`}
                type="button"
                onClick={() => {
                  selectTableroVariant(group.key, variant.key);
                  increase(variantProduct.sku);
                }}
                style={{
                  position: 'relative',
                  width: isCompactLayout ? 'calc((100% - 14px) / 3)' : 'calc((100% - 28px) / 5)',
                  maxWidth: isCompactLayout ? '160px' : '190px',
                  boxSizing: 'border-box',
                  border: `1px solid ${isSelected ? '#3b82f6' : LIGHT_THEME.border}`,
                  background: isSelected ? 'rgba(59,130,246,0.08)' : '#fff',
                  borderRadius: '9px',
                  padding: '7px',
                  display: 'grid',
                  gap: '6px',
                  justifyItems: 'center',
                  cursor: 'pointer'
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    minWidth: '20px',
                    height: '20px',
                    borderRadius: '999px',
                    padding: '0 5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    color: '#fff',
                    background: variantQty > 0 ? '#2563eb' : '#94a3b8',
                    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.22)'
                  }}
                >
                  {variantQty}
                </span>
                <div
                  style={{
                    width: isCompactLayout ? '78px' : '84px',
                    height: isCompactLayout ? '78px' : '84px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: LIGHT_THEME.surfaceAlt
                  }}
                >
                  <ProductImage
                    product={variantProduct}
                    height={isCompactLayout ? '78px' : '84px'}
                    enableSkuFallback
                    fit="contain"
                    imagePadding="6px"
                  />
                </div>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: LIGHT_THEME.text, lineHeight: 1.1 }}>
                  {variant.label}
                </div>
                <div style={{ fontSize: '0.64rem', color: LIGHT_THEME.textMuted }}>
                  {variantPrice.toFixed(2)} Bs
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
      <div style={{ display: 'grid', gridTemplateColumns: isCompactLayout ? '1fr' : 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
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
              gridTemplateRows: '122px minmax(0, 1fr)'
            }}>
              <button
                type="button"
                onClick={() => increase(product.sku)}
                style={{
                  position: 'relative',
                  border: 'none',
                  borderBottom: `1px solid ${LIGHT_THEME.border}`,
                  background: LIGHT_THEME.surfaceAlt,
                  padding: 0,
                  cursor: 'pointer'
                }}
                aria-label={`Agregar ${product.name}`}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    minWidth: '24px',
                    height: '24px',
                    borderRadius: '999px',
                    padding: '0 6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    color: '#fff',
                    background: qty > 0 ? '#2563eb' : '#94a3b8',
                    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.22)'
                  }}
                >
                  {qty}
                </span>
                <ProductImage
                  product={product}
                  height="122px"
                  accessorioFallback
                  fit="contain"
                  imagePadding="8px"
                />
              </button>
              <div style={{ padding: '9px', display: 'flex', flexDirection: 'column', minHeight: '108px' }}>
                <div style={{
                  fontWeight: 700,
                  marginBottom: '4px',
                  color: LIGHT_THEME.text,
                  minHeight: '42px',
                  lineHeight: 1.2
                }}>
                  {product.name}
                </div>
                <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                  {displayPrice.toFixed(2)} Bs
                </div>
                <div style={{ marginTop: 'auto', color: LIGHT_THEME.textMuted, fontSize: '0.78rem' }}>
                  Cant: <strong style={{ color: LIGHT_THEME.text }}>{qty}</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderAccessorySwatchGrid = (items, emptyMessage) => {
    if (!Array.isArray(items) || items.length === 0) {
      return <div style={{ color: LIGHT_THEME.textMuted }}>{emptyMessage}</div>;
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', justifyContent: 'center' }}>
        {items.map((product) => {
          const qty = Number(quantities[product.sku] || 0);
          const displayPrice = ventaType === 'cf'
            ? Number(product.price_cf ?? product.cf ?? product.price ?? 0)
            : Number(product.price_sf ?? product.sf ?? product.price ?? 0);
          return (
            <button
              key={`swatch-${product.sku}`}
              type="button"
              onClick={() => increase(product.sku)}
              title={product.name}
              style={{
                position: 'relative',
                width: isCompactLayout ? 'calc((100% - 14px) / 3)' : 'calc((100% - 28px) / 5)',
                maxWidth: isCompactLayout ? '160px' : '190px',
                boxSizing: 'border-box',
                border: `1px solid ${LIGHT_THEME.border}`,
                background: '#fff',
                borderRadius: '9px',
                padding: '7px',
                display: 'grid',
                gap: '6px',
                justifyItems: 'center',
                cursor: 'pointer'
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  minWidth: '20px',
                  height: '20px',
                  borderRadius: '999px',
                  padding: '0 5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  color: '#fff',
                  background: qty > 0 ? '#2563eb' : '#94a3b8',
                  boxShadow: '0 1px 4px rgba(15, 23, 42, 0.22)'
                }}
              >
                {qty}
              </span>
              <div
                style={{
                  width: isCompactLayout ? '78px' : '84px',
                  height: isCompactLayout ? '78px' : '84px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: LIGHT_THEME.surfaceAlt
                }}
              >
                <ProductImage
                  product={product}
                  height={isCompactLayout ? '78px' : '84px'}
                  accessorioFallback
                  fit="contain"
                  imagePadding="6px"
                />
              </div>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: LIGHT_THEME.text,
                  lineHeight: 1.1,
                  textAlign: 'center'
                }}
              >
                {product.name}
              </div>
              <div style={{ fontSize: '0.64rem', color: LIGHT_THEME.textMuted }}>
                {displayPrice.toFixed(2)} Bs
              </div>
            </button>
          );
        })}
      </div>
    );
  };
  const segmentVisual = SEGMENT_VISUALS[activeSegment] || SEGMENT_VISUALS[SEGMENT_TALLERES];

  const sectionRows = activeSegment === SEGMENT_HOGAR
    ? [
      { key: 'hogar-tableros', title: 'PCX Armonia', kind: 'tableros', items: tablerosHogar, empty: 'Sin tableros multifunciones disponibles.' },
      { key: 'hogar-accesorios', title: 'Accesorios de Plástico', kind: 'swatches', items: accesoriosHogar, empty: 'Sin accesorios de plástico disponibles.' },
      { key: 'hogar-combos', title: 'Combos', kind: 'grid', items: combosHogar, empty: 'Sin combos para hogar disponibles.' }
    ]
    : [
      { key: 'talleres-tableros', title: 'PCX Acero', kind: 'tableros', items: tablerosTalleres, empty: 'Sin tableros industriales disponibles.' },
      { key: 'talleres-accesorios', title: 'Accesorios', kind: 'swatches', items: accesoriosTalleres, empty: 'Sin accesorios disponibles.' },
      { key: 'talleres-combos', title: 'Combos', kind: 'grid', items: combosTalleres, empty: 'Sin combos disponibles.' }
    ];

  return (
    <div className="container" style={{ maxWidth: `${desktopWorkspaceMaxWidth}px`, paddingTop: '10px', color: LIGHT_THEME.text, background: LIGHT_THEME.pageBg, borderRadius: '16px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isCompactLayout ? '1fr' : `minmax(0, 1fr) minmax(380px, ${desktopCartPanelWidth}px)`,
          gap: isCompactLayout ? '12px' : '14px',
          alignItems: 'start'
        }}
      >
        <div className="card" style={{ marginBottom: 0, background: segmentVisual.panelBg, border: `1px solid ${segmentVisual.sectionBorder}`, boxShadow: '0 8px 22px rgba(15, 23, 42, 0.08)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <img
              src={pdfLogo}
              alt="PCX"
              style={{ width: isCompactLayout ? '74px' : '84px', height: 'auto', display: 'block', objectFit: 'contain' }}
              loading="eager"
            />
            <h2 style={{ margin: 0, color: LIGHT_THEME.text, fontSize: isCompactLayout ? '1.22rem' : '1.35rem' }}>Tienda</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {SEGMENT_OPTIONS.map((segment) => (
              <button
                key={segment.key}
                type="button"
                className="btn"
                onClick={() => setActiveSegment(segment.key)}
                style={activeSegment === segment.key
                  ? {
                    background: SEGMENT_VISUALS[segment.key]?.accent || LIGHT_THEME.primary,
                    color: '#fff',
                    border: `1px solid ${SEGMENT_VISUALS[segment.key]?.accent || LIGHT_THEME.primary}`,
                    minHeight: '30px',
                    padding: '4px 10px',
                    fontSize: '0.84rem'
                  }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}`, minHeight: '30px', padding: '4px 10px', fontSize: '0.84rem' }}
              >
                {segment.title}
              </button>
            ))}
          </div>

          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: '12px',
              padding: isCompactLayout ? '10px 12px' : '12px 14px',
              marginBottom: '12px',
              border: `1px solid ${segmentVisual.accent}66`,
              background: segmentVisual.heroBg
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: segmentVisual.heroPattern,
                backgroundSize: segmentVisual.heroPatternSize,
                opacity: activeSegment === SEGMENT_TALLERES ? 0.5 : 0.35
              }}
            />
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div>
                <div style={{ fontSize: isCompactLayout ? '1rem' : '1.08rem', fontWeight: 800, color: segmentVisual.heroText }}>
                  {segmentVisual.heroTitle}
                </div>
                <div style={{ marginTop: '2px', fontSize: '0.82rem', color: segmentVisual.heroSubText }}>
                  {segmentVisual.heroSubtitle}
                </div>
              </div>
              <div style={{ width: isCompactLayout ? '44px' : '56px', height: '4px', borderRadius: '999px', background: segmentVisual.accent }} />
            </div>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {sectionRows.map((section) => (
              <section
                key={section.key}
                style={{
                  border: `1px solid ${segmentVisual.sectionBorder}`,
                  background: segmentVisual.sectionBg,
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
                  : section.kind === 'swatches'
                    ? renderAccessorySwatchGrid(section.items, section.empty)
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
          <h3 style={{ marginBottom: '6px', color: LIGHT_THEME.text }}>Tu pedido</h3>
          <div style={{ color: LIGHT_THEME.textMuted, fontSize: '0.86rem', marginBottom: '10px' }}>
            {cartUnits} unidad(es) · {ventaTypeLabel}
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ marginBottom: '6px', color: LIGHT_THEME.textSoft, fontSize: '0.9rem' }}>Tipo de venta</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setVentaType('sf')}
                style={ventaType === 'sf'
                  ? { background: LIGHT_THEME.primary, color: '#fff', border: `1px solid ${LIGHT_THEME.primary}`, minHeight: '30px', padding: '4px 8px', fontSize: '0.82rem' }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}`, minHeight: '30px', padding: '4px 8px', fontSize: '0.82rem' }}
              >
                Sin factura
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setVentaType('cf')}
                style={ventaType === 'cf'
                  ? { background: LIGHT_THEME.primary, color: '#fff', border: `1px solid ${LIGHT_THEME.primary}`, minHeight: '30px', padding: '4px 8px', fontSize: '0.82rem' }
                  : { background: '#fff', color: LIGHT_THEME.textSoft, border: `1px solid ${LIGHT_THEME.border}`, minHeight: '30px', padding: '4px 8px', fontSize: '0.82rem' }}
              >
                Con factura
              </button>
            </div>
          </div>

          <div style={{ maxHeight: isCompactLayout ? '240px' : '300px', overflowY: 'auto', marginBottom: '8px', paddingRight: '4px' }}>
            {cartItems.length === 0 ? (
              <div style={{ color: LIGHT_THEME.textMuted }}>Aún no agregaste productos.</div>
            ) : cartItems.map((item) => {
              const unitPrice = Number(item.qty || 0) > 0 ? Number(item.lineTotal || 0) / Number(item.qty || 1) : 0;
              return (
                <div key={`cart-${item.sku}`} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  alignItems: 'start',
                  gap: '10px',
                  marginBottom: '8px',
                  color: LIGHT_THEME.text,
                  borderBottom: `1px dashed ${LIGHT_THEME.border}`,
                  paddingBottom: '7px'
                }}>
                  <div style={{ minWidth: 0, display: 'grid', gap: '2px' }}>
                    <div
                      style={{
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={item.name}
                    >
                      {item.name}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: LIGHT_THEME.textMuted }}>
                      SKU: {String(item.sku || '').toUpperCase()}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: LIGHT_THEME.textSoft }}>
                      {ventaTypeLabel} · {unitPrice.toFixed(2)} Bs c/u
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: '6px', justifyItems: 'end' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{item.lineTotal.toFixed(2)} Bs</strong>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => decrease(item.sku)}
                        className="btn"
                        style={{ minHeight: '28px', minWidth: '28px', padding: 0, background: '#e2e8f0', color: '#0f172a', border: `1px solid ${LIGHT_THEME.border}` }}
                      >
                        -
                      </button>
                      <span
                        style={{
                          minWidth: '30px',
                          height: '28px',
                          borderRadius: '7px',
                          border: `1px solid ${LIGHT_THEME.border}`,
                          background: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.84rem',
                          fontWeight: 700
                        }}
                      >
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => increase(item.sku)}
                        className="btn"
                        style={{ minHeight: '28px', minWidth: '28px', padding: 0, background: '#2563eb', color: '#fff', border: '1px solid #1d4ed8' }}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setQty(item.sku, 0)}
                        aria-label={`Eliminar ${item.name}`}
                        className="btn"
                        style={{
                          minHeight: '28px',
                          minWidth: '28px',
                          padding: 0,
                          borderRadius: '7px',
                          border: '1px solid #fecdd3',
                          background: '#fff1f2',
                          color: '#e11d48',
                          fontWeight: 800,
                          fontSize: '0.9rem'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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

          <button
            type="button"
            className="btn"
            disabled={cartItems.length === 0}
            onClick={() => setIsCheckoutExpanded((prev) => !prev)}
            style={{
              width: '100%',
              minHeight: '40px',
              marginBottom: isCheckoutExpanded ? '10px' : 0,
              background: isCheckoutExpanded ? '#1e293b' : LIGHT_THEME.primary,
              color: '#fff',
              border: `1px solid ${isCheckoutExpanded ? '#334155' : LIGHT_THEME.primary}`,
              fontWeight: 700
            }}
          >
            {isCheckoutExpanded ? 'Ocultar datos del cliente' : 'Finalizar pedido · ingresar datos del cliente'}
          </button>

          {isCheckoutExpanded && (
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
          )}

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
