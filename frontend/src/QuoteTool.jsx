// QuoteTool.jsx — Cotizar.
//
// Distribución: a la izquierda se ARMA (cliente, destino y buscador de
// productos) y a la derecha queda la COTIZACIÓN (líneas, descuento, total y
// guardar), siempre a la vista. En pantallas angostas todo va en una columna
// y el total con el botón de guardar quedan pegados abajo.
import { useState, useEffect, useMemo, useRef } from 'react';
import logo from './assets/logo.png';
import { generateModernQuotePdf } from './quotePdf';
import { apiRequest } from './apiClient';
import { ORIGENES } from './segmentacion';
import { clearDraftState, useDraftState } from './useDraftState';
import { useOutbox } from './OutboxProvider';
import { useToast } from './ui/toastContext';
import QuotePicker, { QtyStepper } from './QuotePicker';
import CustomerHub, { CustomerSearchField } from './crm/CustomerHub';
import { looksLikeMapsLink, parseGpsInput } from './gps';

const PRODUCTS_VIEW_STORAGE_KEY = 'pcx.quoteProductsView';
const ALMACEN_STORAGE_KEY = 'pcx.quoteAlmacen';
const WIDE_LAYOUT_QUERY = '(min-width: 1240px)';
const MAX_LINE_QTY = 9999;

const ALMACEN_OPTIONS = ['Cochabamba', 'Santa Cruz'];
const DEPARTAMENTOS = ['Beni', 'Chuquisaca', 'Cochabamba', 'La Paz', 'Oruro', 'Pando', 'Potosí', 'Santa Cruz', 'Tarija'];

const clampNumber = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
};

const normalizeSku = (value) => String(value || '').trim().toUpperCase();
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Ids de línea únicos aunque se agreguen varios productos en el mismo ms.
let rowSequence = 0;
const nextRowId = () => {
  rowSequence = (rowSequence + 1) % 1000;
  return Date.now() * 1000 + rowSequence;
};

// Fecha de la proforma («24 de noviembre de 2026, 22:57»), sin el día de la semana.
const quoteDateText = () => {
  const formatted = new Intl.DateTimeFormat('es-BO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  const parts = formatted.split(', ');
  return parts.length > 1 ? parts.slice(1).join(', ') : formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

// Borradores viejos traían filas vacías (la lista de selects) o el mismo
// producto en dos filas: se limpian y se juntan por código.
const sanitizeDraftRows = (draftRows) => {
  const merged = new Map();
  for (const raw of Array.isArray(draftRows) ? draftRows : []) {
    const sku = normalizeSku(raw?.sku);
    if (!sku) continue;
    const qty = Math.min(MAX_LINE_QTY, Math.max(1, Number.parseInt(raw.qty, 10) || 1));
    const unitPrice = Number(raw.unitPrice) || 0;
    const previous = merged.get(sku);
    if (previous) {
      const nextQty = Math.min(MAX_LINE_QTY, previous.qty + qty);
      merged.set(sku, { ...previous, qty: nextQty, lineTotal: previous.unitPrice * nextQty });
      continue;
    }
    merged.set(sku, {
      id: nextRowId(),
      sku,
      skuDisplay: String(raw.skuDisplay || sku),
      qty,
      unitPrice,
      lineTotal: unitPrice * qty,
      isCombo: Boolean(raw.isCombo),
      comboItems: raw.isCombo && Array.isArray(raw.comboItems) ? raw.comboItems : undefined
    });
  }
  return [...merged.values()];
};

const readViewport = () => ({
  isMobile: typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
  isWide: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_LAYOUT_QUERY).matches
    : false
});

export default function QuoteTool({ token, user }) {
  const toast = useToast();
  const [combos, setCombos] = useState([]);
  const [products, setProducts] = useState([]);
  const legacyDraftStorageKey = 'pcx.quoteDraft.v1';
  const userDraftSuffix = user?.id
    ? `id:${user.id}`
    : `email:${String(user?.email || 'anon').trim().toLowerCase()}`;
  const draftStorageKey = `pcx.quoteDraft.v2:${userDraftSuffix}`;
  const [draft, setDraft] = useDraftState(draftStorageKey, null);

  // Solo líneas reales: { id, sku, skuDisplay, qty, unitPrice, lineTotal,
  // isCombo, comboItems }. El stock no se guarda en la fila: se deriva del
  // mapa de stock del almacén elegido.
  const [rows, setRows] = useState([]);
  const [ventaType, setVentaType] = useState('sf');
  const [discountMode, setDiscountMode] = useState('percent');
  const [discountInput, setDiscountInput] = useState(0);
  // Mientras se escribe en un campo de descuento se muestra tal cual el
  // texto tecleado; recién al salir del campo se formatea a 2 decimales.
  // (Antes cada tecla reformateaba el valor y no se podía borrar ni escribir.)
  const [discountDraft, setDiscountDraft] = useState({ field: null, text: '' });
  const [customerCoupon, setCustomerCoupon] = useState(null);
  const [selectedCouponCode, setSelectedCouponCode] = useState('');
  const [useAlternativeName, setUseAlternativeName] = useState(false);
  const [alternativeName, setAlternativeName] = useState('');
  const [alternativePhone, setAlternativePhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  // Segmentación: cómo nos conoció (una vez por cliente). Dónde usa el
  // tablero ya no se pregunta aquí: vive en la ficha del cliente (Clientes).
  // knownCustomer = ficha encontrada por teléfono.
  const [origen, setOrigen] = useState('');
  const [knownCustomer, setKnownCustomer] = useState(null);
  const [origenAuto, setOrigenAuto] = useState('');
  // Secciones plegadas: opciones de envío y negociación de descuento.
  const [showShipping, setShowShipping] = useState(false);
  const shippingAutoOpenedRef = useRef(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [payMethod, setPayMethod] = useState('QR');
  const [lastOrder, setLastOrder] = useState(null);
  const [pendingItems, setPendingItems] = useState(null);
  const [savedInfo, setSavedInfo] = useState(null);
  // Atajos del vendedor: sus productos y destinos más cotizados.
  const [shortcuts, setShortcuts] = useState({ products: [], destinations: [] });
  // Stock de todo el catálogo en el almacén elegido (una sola consulta).
  const [stockState, setStockState] = useState({ store: '', stock: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const phoneDigitsForLookup = String(customerPhone || '').replace(/\D/g, '');
  // Se pregunta el origen solo la primera vez: teléfono nuevo, o cliente sin
  // origen guardado. Las cotizaciones del inbox de WhatsApp lo traen solo.
  const needsOrigen = phoneDigitsForLookup.length >= 7 && !(knownCustomer && knownCustomer.origen);
  const [department, setDepartment] = useState('');
  // Destino canonico (catalogo geografico): {id, municipio, provincia, departamento}.
  const [destino, setDestino] = useState(null);
  const [destQuery, setDestQuery] = useState('');
  const [destResults, setDestResults] = useState([]);
  const [destOpen, setDestOpen] = useState(false);
  // Ruta de escape: destino no listado -> texto libre + departamento manual.
  const [destFallback, setDestFallback] = useState(false);
  const [fallbackCiudad, setFallbackCiudad] = useState('');
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmFollowUpsDue, setCrmFollowUpsDue] = useState(0);
  // Promos combinables: el vendedor marca las que se lleva el cliente. Dos
  // promos del MISMO grupo de exclusión no se combinan (marcar una desmarca
  // la otra); sin grupo, combinan libremente. La elección viaja en
  // selected_promo_ids y el servidor estampa solo esas (y revalida grupos).
  const [selectedPromoIds, setSelectedPromoIds] = useState([]);
  // Regalo en modo «elección»: qué producto de la lista eligió el vendedor,
  // por promo (promoId -> sku).
  const [giftChoiceByPromo, setGiftChoiceByPromo] = useState({});

  // Toolchest de marketing: promos activas hoy (envío gratis, sorteo...).
  // El servidor decide qué aplica al guardar; esto es el aviso para el vendedor.
  const [activePromos, setActivePromos] = useState([]);

  // Almacén por defecto: la ciudad del usuario, si es una sede (ahorra un
  // clic y evita el «Selecciona el almacén» al guardar). Quien no tiene sede
  // (Admin, vendedor de otra ciudad) arranca con el último que usó aquí.
  const [almacen, setAlmacen] = useState(() => {
    const city = String(user?.city || '').trim();
    if (ALMACEN_OPTIONS.includes(city)) return city;
    try {
      const saved = localStorage.getItem(ALMACEN_STORAGE_KEY);
      return ALMACEN_OPTIONS.includes(saved) ? saved : '';
    } catch {
      return '';
    }
  });
  const [shippingNotes, setShippingNotes] = useState('');
  const [salesUsers, setSalesUsers] = useState([]);
  const [assignedSellerId, setAssignedSellerId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // When set, the quote came from a WhatsApp conversation and the PDF is
  // sent back into that thread after saving.
  const [whatsappConversationId, setWhatsappConversationId] = useState(null);

  // Envío local: el vendedor pega el GPS que mandó el cliente (o llega solo
  // desde el chat de WhatsApp) y el servidor lo cotiza con los anillos que
  // configuró Almacén. El cargo se suma DESPUÉS del descuento negociado.
  const [deliveryInput, setDeliveryInput] = useState('');
  const [deliveryQuote, setDeliveryQuote] = useState(null);
  const [deliveryIncluded, setDeliveryIncluded] = useState(true);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const isSavingRef = useRef(false);
  const restoredDraftKeyRef = useRef('');
  const [draftNotice, setDraftNotice] = useState('');
  const { enqueue } = useOutbox();
  const [viewport, setViewport] = useState(readViewport);
  const { isMobile, isWide } = viewport;
  // Alto visible del área de contenido: limita la cotización fija de la
  // derecha y la lista de productos para que nada quede fuera de pantalla.
  const [scrollportHeight, setScrollportHeight] = useState(0);
  // Lista compacta o catálogo con fotos; ambas editan las mismas líneas. La
  // preferencia se guarda por dispositivo.
  const [pickerView, setPickerView] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(PRODUCTS_VIEW_STORAGE_KEY) : null;
    return saved === 'catalogo' ? 'catalogo' : 'lista';
  });
  const pageRef = useRef(null);
  const ticketRef = useRef(null);
  const nameInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const destInputRef = useRef(null);
  const pickerInputRef = useRef(null);
  // Estado del destino leído desde callbacks asíncronos (autocompletar al
  // reconocer al cliente sin pisar lo que el vendedor ya escribió).
  const destStateRef = useRef({ destino: null, destFallback: false, destQuery: '' });
  destStateRef.current = { destino, destFallback, destQuery };

  const normalizedRole = String(user?.role || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const isSalesRole = normalizedRole === 'ventas'
    || normalizedRole === 'ventas lider'
    || normalizedRole === 'sales'
    || normalizedRole === 'vendedor';
  const requiresSellerAssignment = !isSalesRole;

  const focusPicker = () => {
    if (isMobile) return;
    window.setTimeout(() => pickerInputRef.current?.focus(), 0);
  };

  const chooseDestino = (result) => {
    setDestino(result);
    setDestFallback(false);
    setDestQuery('');
    setDestOpen(false);
    focusPicker();
  };

  // Lo que la app ya sabe del cliente: su último pedido (para repetirlo) y el
  // destino de su cotización más reciente. Sin `forceDestination` solo llena
  // el destino si el vendedor todavía no escribió uno.
  const loadCustomerExtras = async (customer, { forceDestination = false, isActive = () => true } = {}) => {
    let extras = null;
    try {
      extras = await apiRequest(`/api/customers/${customer.id}/last-order`, { token });
    } catch {
      extras = null;
    }
    if (!isActive()) return;
    setLastOrder(extras?.order || null);

    const current = destStateRef.current;
    const destinationFree = !current.destino && !current.destFallback && !current.destQuery.trim();
    if (!forceDestination && !destinationFree) return;

    if (extras?.destino?.id) {
      setDestino(extras.destino);
      setDestFallback(false);
      setDestQuery('');
      return;
    }
    // Sin cotización previa con destino del catálogo: se intenta con el texto
    // guardado en la ficha. Un único resultado se selecciona solo.
    const ciudad = String(customer.ciudad || '').trim();
    const provincia = String(customer.provincia || '').trim();
    const savedDest = ciudad || provincia;
    if (savedDest) {
      try {
        const data = await apiRequest(`/api/geo/search?q=${encodeURIComponent(savedDest)}`, { token });
        if (!isActive()) return;
        const results = Array.isArray(data?.results) ? data.results : [];
        const exact = results.filter((r) => sameText(r.municipio, ciudad) && (!provincia || sameText(r.provincia, provincia)));
        const pick = exact.length === 1 ? exact[0] : (results.length === 1 ? results[0] : null);
        if (pick) {
          setDestino(pick);
          setDestFallback(false);
          setDestQuery('');
        } else if (forceDestination) {
          setDestQuery(savedDest);
        }
      } catch {
        if (forceDestination && isActive()) setDestQuery(savedDest);
      }
    } else if (customer.department && forceDestination) {
      setDestFallback(true);
      setDepartment(customer.department);
    }
  };

  // Picking a customer (from autocomplete or the hub) fills the quote form —
  // the whole point: never re-type customer data.
  const applyCustomer = (customer) => {
    if (!customer) return;
    setCustomerName(String(customer.name || '').slice(0, 80));
    setCustomerPhone(String(customer.phone || '').slice(0, 40));
    // Cartera: preselect the rep who owns this customer and repeat the
    // almacén of their last quote — the seller only confirms.
    if (customer.assigned_user_id) setAssignedSellerId(String(customer.assigned_user_id));
    if (ALMACEN_OPTIONS.includes(customer.last_store_location)) setAlmacen(customer.last_store_location);
    // Destino: el de su última cotización (cliente recurrente = cero clics).
    loadCustomerExtras(customer, { forceDestination: true });
  };

  // Typeahead de destinos (250ms de debounce; minimo 2 letras).
  useEffect(() => {
    const q = destQuery.trim();
    if (!token || destino || q.length < 2) {
      setDestResults([]);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(() => {
      apiRequest(`/api/geo/search?q=${encodeURIComponent(q)}`, { token })
        .then((data) => {
          if (!active) return;
          setDestResults(Array.isArray(data?.results) ? data.results : []);
          setDestOpen(true);
        })
        .catch(() => { if (active) setDestResults([]); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [token, destQuery, destino]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/promos/active', { token })
      .then((data) => {
        if (!active) return;
        const promos = Array.isArray(data?.promos) ? data.promos : [];
        setActivePromos(promos);
        // Una sola promo vigente: se aplica sola (mismo comportamiento de
        // siempre). Con varias, el vendedor marca cuáles en los chips.
        setSelectedPromoIds(promos.length === 1 ? [promos[0].id] : []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/customers?limit=1', { token })
      .then((data) => { if (active) setCrmFollowUpsDue(Number(data?.follow_ups_due || 0)); })
      .catch(() => {});
    return () => { active = false; };
  }, [token, crmOpen]);

  const formatSkuNameLabel = (skuValue, nameValue) => {
    const sku = String(skuValue || '').trim().toUpperCase();
    const name = String(nameValue || '').trim();
    if (/^COMBO_\d+$/.test(sku)) return name || 'Combo';
    if (sku && name) {
      const upperName = name.toUpperCase();
      if (upperName === sku || upperName.startsWith(`${sku} -`)) return name;
      return `${sku} - ${name}`;
    }
    return sku || name || 'Producto';
  };

  useEffect(() => {
    const onResize = () => setViewport((prev) => {
      const next = readViewport();
      return prev.isMobile === next.isMobile && prev.isWide === next.isWide ? prev : next;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const scroller = pageRef.current ? pageRef.current.closest('.shell-content') : null;
    if (!scroller) return undefined;
    const measure = () => setScrollportHeight(scroller.clientHeight || 0);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!token) return;
    const fetchCatalog = async () => {
      try {
        const data = await apiRequest('/api/product-catalog', { token });
        setProducts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching product catalog:', err);
      }
    };
    fetchCatalog();
  }, [token]);

  useEffect(() => {
    const fetchCombos = async () => {
      try {
        const data = await apiRequest('/api/combos', { token });
        setCombos(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching combos:', err);
      }
    };
    fetchCombos();
  }, [token]);

  // Atajos: productos y destinos que este vendedor cotiza más. Se refrescan
  // después de cada cotización guardada.
  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    apiRequest('/api/quote-shortcuts', { token })
      .then((data) => {
        if (!active) return;
        setShortcuts({
          products: (Array.isArray(data?.top_products) ? data.top_products : []).map((entry) => normalizeSku(entry?.sku)).filter(Boolean),
          destinations: (Array.isArray(data?.top_destinations) ? data.top_destinations : []).filter((entry) => entry && entry.id)
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [token, refreshTick]);

  // Recuerda el almacén elegido en este dispositivo. Sin almacén no hay
  // stock que mostrar ni se puede guardar: las opciones de envío se abren
  // solas (una vez) para que se elija.
  useEffect(() => {
    if (!almacen) {
      if (!shippingAutoOpenedRef.current) {
        shippingAutoOpenedRef.current = true;
        setShowShipping(true);
      }
      return;
    }
    try {
      localStorage.setItem(ALMACEN_STORAGE_KEY, almacen);
    } catch {
      // sin storage: la preferencia no se guarda
    }
  }, [almacen]);

  // Stock del almacén elegido, de todo el catálogo en una consulta. Si falla
  // no se muestra stock ni se bloquea nada (el servidor valida al cobrar).
  useEffect(() => {
    if (!token || !almacen) return undefined;
    let active = true;
    apiRequest(`/api/stock/map?store_location=${encodeURIComponent(almacen)}`, { token })
      .then((data) => {
        if (active) setStockState({ store: almacen, stock: data && typeof data.stock === 'object' ? data.stock : null });
      })
      .catch(() => { if (active) setStockState({ store: almacen, stock: null }); });
    return () => { active = false; };
  }, [token, almacen, refreshTick]);

  // Al volver a la pestaña después de un rato se refresca el stock.
  useEffect(() => {
    let lastRefresh = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 60000) return;
      lastRefresh = Date.now();
      setRefreshTick((prev) => prev + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (!token || !requiresSellerAssignment) return;
    const fetchSalesUsers = async () => {
      try {
        const data = await apiRequest('/api/sellers/assignable', { token });
        setSalesUsers(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) {
          setAssignedSellerId((prev) => prev || String(data[0].id));
        }
      } catch (err) {
        console.error(err);
        setSalesUsers([]);
      }
    };
    fetchSalesUsers();
  }, [token, requiresSellerAssignment]);

  // Al escribir el teléfono: cupón personal del cliente (motor de promos) y,
  // si el cliente ya existe, se completa solo lo que falte (nombre, origen,
  // destino de su última cotización y su último pedido para repetirlo).
  useEffect(() => {
    const digits = String(customerPhone || '').replace(/\D/g, '');
    if (!token || digits.length < 7) {
      setCustomerCoupon(null);
      setKnownCustomer(null);
      setLastOrder(null);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(() => {
      apiRequest(`/api/promos/coupon-for-customer?phone=${encodeURIComponent(digits)}`, { token })
        .then((data) => { if (active) setCustomerCoupon(data?.coupon || null); })
        .catch(() => { if (active) setCustomerCoupon(null); });
      apiRequest(`/api/customers?search=${encodeURIComponent(digits)}&limit=3`, { token })
        .then((data) => {
          if (!active) return;
          const match = (data?.customers || []).find((c) => String(c.phone || '').replace(/\D/g, '') === digits) || null;
          setKnownCustomer(match);
          if (!match) {
            setLastOrder(null);
            return;
          }
          setOrigen((prev) => prev || match.origen || '');
          setCustomerName((prev) => (prev.trim() ? prev : String(match.name || '').slice(0, 80)));
          if (match.assigned_user_id) setAssignedSellerId(String(match.assigned_user_id));
          loadCustomerExtras(match, { isActive: () => active });
        })
        .catch(() => { if (active) setKnownCustomer(null); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, customerPhone]);

  const promoGroupOf = (promo) => String(promo?.config?.exclusion_group || '').trim().toLowerCase();

  // Marcar una promo desmarca solo a las de SU MISMO grupo de exclusión; las
  // demás siguen marcadas (se combinan). Sin grupo no desplaza a nadie.
  const togglePromo = (promo, checked) => {
    setSelectedPromoIds((prev) => {
      if (!checked) return prev.filter((id) => id !== promo.id);
      const group = promoGroupOf(promo);
      const kept = group
        ? prev.filter((id) => promoGroupOf(activePromos.find((p) => p.id === id)) !== group)
        : prev;
      return [...kept, promo.id];
    });
  };

  const allItems = useMemo(() => [
    ...products.map((p) => ({ ...p, displayName: p.name })),
    ...combos.map((combo) => ({
      sku: `COMBO_${combo.id}`,
      displayName: `${combo.name} (Combo)`,
      name: combo.name,
      sf: Number(combo.sf_price) || 0,
      cf: Number(combo.cf_price) || 0,
      image_url: combo.image_url || null,
      product_line: combo.product_line || null,
      isCombo: true,
      comboId: combo.id,
      items: combo.items || []
    }))
  ], [products, combos]);
  const itemBySku = useMemo(() => new Map(allItems.map((item) => [normalizeSku(item.sku), item])), [allItems]);

  const findItem = (sku) => itemBySku.get(normalizeSku(sku)) || allItems.find((item) => item.sku === sku);
  // Single source for line pricing: respects the Con/Sin Factura toggle and
  // falls back to the other price only when the chosen one doesn't exist
  // (same rules as the edit flow in QuoteHistory).
  const unitPriceFor = (item) => {
    if (!item) return 0;
    return ventaType === 'cf'
      ? Number(item.cf ?? item.sf ?? 0)
      : Number(item.sf ?? item.cf ?? 0);
  };
  const getProductNameBySku = (skuValue = '') => {
    const normalizedSku = String(skuValue || '').trim().toUpperCase();
    if (!normalizedSku) return '';
    const product = products.find((p) => String(p?.sku || '').trim().toUpperCase() === normalizedSku);
    return String(product?.name || '').trim();
  };

  const getNormalizedComboItems = (entry) => {
    const fromEntry = Array.isArray(entry?.comboItems)
      ? entry.comboItems
      : (Array.isArray(entry?.items) ? entry.items : []);
    return fromEntry
      .map((comboItem) => ({
        sku: String(comboItem?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(comboItem?.quantity, 10)
      }))
      .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
  };

  // Disponibilidad en el almacén elegido. null = todavía no se sabe (sin
  // almacén o sin respuesta): nunca se trata como «hay 0». Un combo alcanza
  // para tantas unidades como permita su componente más escaso.
  const stockMap = stockState.store === almacen ? stockState.stock : null;
  const stockFor = (entry) => {
    if (!almacen || !stockMap || !entry) return null;
    const sku = normalizeSku(entry.sku);
    if (!sku) return null;
    const readStock = (code) => {
      const value = stockMap[code];
      if (value === null || value === undefined) return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    if (entry.isCombo || sku.startsWith('COMBO_')) {
      const comboItems = getNormalizedComboItems(Array.isArray(entry.comboItems) || Array.isArray(entry.items) ? entry : findItem(sku));
      if (comboItems.length === 0) return null;
      let minAvailable = Number.POSITIVE_INFINITY;
      for (const comboItem of comboItems) {
        const componentStock = readStock(comboItem.sku);
        if (componentStock === null) return null;
        minAvailable = Math.min(minAvailable, Math.floor(componentStock / comboItem.quantity));
      }
      return Number.isFinite(minAvailable) ? Math.max(0, minAvailable) : null;
    }
    return readStock(sku);
  };

  const buildRow = (item, qty) => {
    const unitPrice = unitPriceFor(item);
    return {
      id: nextRowId(),
      sku: normalizeSku(item.sku),
      skuDisplay: item.displayName,
      qty,
      unitPrice,
      lineTotal: unitPrice * qty,
      isCombo: Boolean(item.isCombo),
      comboItems: item.isCombo ? item.items : undefined
    };
  };

  // Fija la cantidad de un producto (0 lo quita). Lo usan los steppers del
  // buscador y de la cotización.
  const setItemQty = (skuValue, qtyValue) => {
    const sku = normalizeSku(skuValue);
    if (!sku) return;
    const nextQty = Math.min(MAX_LINE_QTY, Math.max(0, Number.parseInt(qtyValue, 10) || 0));
    setRows((prev) => {
      if (nextQty === 0) return prev.filter((row) => normalizeSku(row.sku) !== sku);
      if (prev.some((row) => normalizeSku(row.sku) === sku)) {
        return prev.map((row) => (
          normalizeSku(row.sku) === sku ? { ...row, qty: nextQty, lineTotal: (row.unitPrice || 0) * nextQty } : row
        ));
      }
      const item = findItem(sku);
      return item ? [...prev, buildRow(item, nextQty)] : prev;
    });
  };

  // Suma unidades de un producto (un toque en la lista, un chip o Enter).
  const addItem = (skuValue, delta = 1) => {
    const sku = normalizeSku(skuValue);
    const amount = Math.max(1, Number.parseInt(delta, 10) || 1);
    if (!sku) return;
    setRows((prev) => {
      const existing = prev.find((row) => normalizeSku(row.sku) === sku);
      if (existing) {
        const nextQty = Math.min(MAX_LINE_QTY, (Number(existing.qty) || 0) + amount);
        return prev.map((row) => (
          normalizeSku(row.sku) === sku ? { ...row, qty: nextQty, lineTotal: (row.unitPrice || 0) * nextQty } : row
        ));
      }
      const item = findItem(sku);
      return item ? [...prev, buildRow(item, Math.min(MAX_LINE_QTY, amount))] : prev;
    });
  };

  const removeRow = (rowId) => setRows((prev) => prev.filter((row) => row.id !== rowId));

  // Carga líneas a partir de [{ sku, qty }] (repetir pedido). Los productos
  // que ya no existen se saltan y se avisa.
  const loadRowsFromItems = (items = []) => {
    const quantities = new Map();
    const missing = [];
    for (const it of items) {
      const sku = normalizeSku(it?.sku);
      if (!sku) continue;
      if (!findItem(sku)) { missing.push(sku); continue; }
      const qty = Math.max(1, Number.parseInt(it?.qty, 10) || 1);
      quantities.set(sku, Math.min(MAX_LINE_QTY, (quantities.get(sku) || 0) + qty));
    }
    const built = [...quantities].map(([sku, qty]) => buildRow(findItem(sku), qty));
    if (built.length === 0) {
      toast.error('Los productos de ese pedido ya no están en el catálogo.');
      return;
    }
    setRows(built);
    if (missing.length > 0) toast.info(`No se cargaron (ya no están en catálogo): ${missing.join(', ')}`);
    else toast.success(`Pedido cargado: ${built.length} producto${built.length === 1 ? '' : 's'}. Revisa cantidades y precios.`);
  };

  // Pedido a repetir que llegó desde Historial: espera a que cargue el catálogo.
  useEffect(() => {
    if (!pendingItems || products.length === 0) return;
    loadRowsFromItems(pendingItems);
    setPendingItems(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItems, products.length]);

  const switchPickerView = (view) => {
    setPickerView(view);
    try {
      localStorage.setItem(PRODUCTS_VIEW_STORAGE_KEY, view);
    } catch {
      // storage unavailable; preference just won't persist
    }
  };

  const subtotal = rows.reduce((sum, r) => sum + (r.lineTotal || 0), 0);
  const getDiscountMetrics = (subtotalValue, modeValue, rawValue) => {
    const safeSubtotal = Math.max(0, Number(subtotalValue) || 0);
    const safeInput = Number(rawValue) || 0;

    let discountAmount = 0;
    if (safeSubtotal > 0) {
      if (modeValue === 'amount') {
        discountAmount = clampNumber(safeInput, 0, safeSubtotal);
      } else if (modeValue === 'target') {
        const targetTotal = clampNumber(safeInput, 0, safeSubtotal);
        discountAmount = safeSubtotal - targetTotal;
      } else {
        const discountPercent = clampNumber(safeInput, 0, 100);
        discountAmount = safeSubtotal * (discountPercent / 100);
      }
    }

    discountAmount = clampNumber(discountAmount, 0, safeSubtotal);
    const discountPercent = safeSubtotal > 0 ? (discountAmount / safeSubtotal) * 100 : 0;
    const targetTotal = Math.max(0, safeSubtotal - discountAmount);

    return { discountAmount, discountPercent, targetTotal };
  };
  const discountMetrics = getDiscountMetrics(subtotal, discountMode, discountInput);
  const discountAmountApplied = discountMetrics.discountAmount;
  const effectiveDiscountPercent = discountMetrics.discountPercent;
  const total = discountMetrics.targetTotal;
  // El envío local se suma después del descuento: no participa de la
  // negociación ni de los mínimos de promos (esos miran solo productos).
  const deliveryFee = deliveryQuote?.in_range && deliveryIncluded ? Number(deliveryQuote.price_bs || 0) : 0;
  // Promo "descuento en accesorios": % SOLO sobre las líneas cuyo producto es
  // tipo accesorio en el catálogo (tableros y combos pagan precio normal).
  // Se descuenta después del descuento negociado y antes del envío.
  const accessoriesSubtotal = rows.reduce((sum, row) => {
    if (!row.sku || row.isCombo) return sum;
    const item = findItem(row.sku);
    return item?.product_type === 'accesorio' ? sum + (row.lineTotal || 0) : sum;
  }, 0);
  const selectedAccessoryPromo = activePromos.find(
    (promo) => selectedPromoIds.includes(promo.id) && promo.tool === 'descuento_accesorios'
  ) || null;
  const accessoryPromoPercent = (
    selectedAccessoryPromo
    && total > 0
    && total >= Number(selectedAccessoryPromo.config?.min_total || 0)
  ) ? Number(selectedAccessoryPromo.config?.discount_percent || 0) : 0;
  const accessoryDiscountBs = Math.round(accessoriesSubtotal * accessoryPromoPercent) / 100;
  const grandTotal = Math.max(0, total - accessoryDiscountBs) + deliveryFee;

  const requestDeliveryQuote = async (rawInput) => {
    let gps = parseGpsInput(rawInput);
    setDeliveryLoading(true);
    try {
      // Link corto de compartir (goo.gl/maps/…): no trae coordenadas, el
      // servidor lo expande siguiendo la redirección de Google.
      if (!gps && looksLikeMapsLink(rawInput)) {
        const resolved = await apiRequest('/api/delivery/resolve', {
          method: 'POST',
          token,
          body: { link: String(rawInput).trim() }
        });
        if (Number.isFinite(Number(resolved?.lat)) && Number.isFinite(Number(resolved?.lng))) {
          gps = { lat: Number(resolved.lat), lng: Number(resolved.lng) };
        }
      }
      if (!gps) {
        toast.error('Pega la ubicación como "lat, lng" o un link de Google Maps');
        return;
      }
      const body = { lat: gps.lat, lng: gps.lng };
      if (almacen === 'Cochabamba' || almacen === 'Santa Cruz') body.city = almacen;
      const data = await apiRequest('/api/delivery/quote', { method: 'POST', token, body });
      setDeliveryQuote({ ...data, gps: `${gps.lat},${gps.lng}` });
      setDeliveryIncluded(true);
    } catch (err) {
      setDeliveryQuote(null);
      toast.error(err.message || 'No se pudo cotizar el envío');
    } finally {
      setDeliveryLoading(false);
    }
  };

  // Precios al día: al cambiar Con/Sin factura y también cuando llega el
  // catálogo (un borrador de ayer no debe guardar el precio de ayer).
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (!row.sku) return row;
        const item = findItem(row.sku);
        if (!item) return row;
        const newPrice = unitPriceFor(item);
        const lineTotal = newPrice * (Number(row.qty) || 0);
        if (newPrice === row.unitPrice && lineTotal === row.lineTotal) return row;
        changed = true;
        return { ...row, unitPrice: newPrice, lineTotal };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventaType, allItems]);

  useEffect(() => {
    if (restoredDraftKeyRef.current === draftStorageKey) return;
    restoredDraftKeyRef.current = draftStorageKey;
    if (!draft || !draft.values || !draft.hasContent) return;
    const values = draft.values;
    if (Array.isArray(values.rows)) setRows(sanitizeDraftRows(values.rows));
    if (values.ventaType) setVentaType(values.ventaType);
    if (typeof values.discountMode === 'string') {
      setDiscountMode(['percent', 'amount', 'target'].includes(values.discountMode) ? values.discountMode : 'percent');
    }
    if (typeof values.discountInput === 'number') {
      setDiscountInput(values.discountInput);
    } else if (typeof values.discountPercent === 'number') {
      // Backward compatibility with older draft schema.
      setDiscountMode('percent');
      setDiscountInput(values.discountPercent);
    }
    if (typeof values.useAlternativeName === 'boolean') setUseAlternativeName(values.useAlternativeName);
    if (typeof values.alternativeName === 'string') setAlternativeName(values.alternativeName);
    if (typeof values.alternativePhone === 'string') setAlternativePhone(values.alternativePhone);
    if (typeof values.customerName === 'string') setCustomerName(values.customerName);
    if (typeof values.customerPhone === 'string') setCustomerPhone(values.customerPhone);
    if (typeof values.department === 'string') setDepartment(values.department);
    if (values.destino && values.destino.id) setDestino(values.destino);
    if (typeof values.destQuery === 'string') setDestQuery(values.destQuery);
    if (typeof values.destFallback === 'boolean') setDestFallback(values.destFallback);
    if (typeof values.fallbackCiudad === 'string') setFallbackCiudad(values.fallbackCiudad);
    if (typeof values.almacen === 'string' && values.almacen) setAlmacen(values.almacen);
    if (typeof values.shippingNotes === 'string') setShippingNotes(values.shippingNotes);
    if (typeof values.assignedSellerId === 'string') setAssignedSellerId(values.assignedSellerId);
    if (typeof values.selectedCouponCode === 'string') setSelectedCouponCode(values.selectedCouponCode);
    setDraftNotice('Se recuperó un borrador que no llegaste a guardar.');
  }, [draftStorageKey, draft]);

  useEffect(() => {
    // Remove legacy shared draft key so drafts never bleed across accounts again.
    clearDraftState(legacyDraftStorageKey);
  }, []);

  // Prefill handoff from the WhatsApp inbox ("Cotizar" on a conversation).
  // Runs after the draft restore so the conversation contact wins.
  useEffect(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem('pcx.quotePrefill');
      if (raw) sessionStorage.removeItem('pcx.quotePrefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw);
      if (prefill?.customerName) setCustomerName(String(prefill.customerName).slice(0, 80));
      if (prefill?.customerPhone) setCustomerPhone(String(prefill.customerPhone).slice(0, 40));
      if (prefill?.conversationId) { setWhatsappConversationId(Number(prefill.conversationId)); setOrigenAuto('whatsapp'); setOrigen((prev) => prev || 'whatsapp'); }
      if (Array.isArray(prefill?.items) && prefill.items.length > 0) setPendingItems(prefill.items);
      if (prefill?.origen) { setOrigenAuto(String(prefill.origen)); setOrigen((prev) => prev || String(prefill.origen)); }
      // GPS del chat de WhatsApp: llega listo para cotizar el envío local,
      // así que las opciones de envío se abren solas.
      if (prefill?.gps) {
        setDeliveryInput(String(prefill.gps).slice(0, 120));
        setShowShipping(true);
      }
    } catch {
      // malformed prefill; start the quote empty
    }
  }, []);

  useEffect(() => {
    const hasContent =
      Boolean(customerName || customerPhone || department || destino || destQuery || fallbackCiudad || shippingNotes || alternativeName || alternativePhone)
      || rows.length > 0;

    setDraft({
      hasContent,
      values: {
        rows,
        ventaType,
        discountMode,
        discountInput,
        selectedCouponCode,
        useAlternativeName,
        alternativeName,
        alternativePhone,
        customerName,
        customerPhone,
        department,
        destino,
        destQuery,
        destFallback,
        fallbackCiudad,
        almacen,
        shippingNotes,
        assignedSellerId
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    ventaType,
    discountMode,
    discountInput,
    selectedCouponCode,
    products,
    useAlternativeName,
    alternativeName,
    alternativePhone,
    customerName,
    customerPhone,
    department,
    destino,
    destQuery,
    destFallback,
    fallbackCiudad,
    almacen,
    shippingNotes,
    assignedSellerId
  ]);

  // Mirrors every canSave condition with a human explanation, so the save
  // button can say WHY instead of just ghosting (it read as a bug).
  const saveBlockers = (() => {
    const blockers = [];
    if (!customerName.trim() || !customerPhone.trim()) blockers.push('Completa el nombre y celular del cliente.');
    if (needsOrigen && !origen) blockers.push('Indica cómo nos conoció el cliente.');
    if (!destino && !destFallback) blockers.push('Selecciona el destino de envío.');
    if (destFallback && !department) blockers.push('Selecciona el departamento del destino.');
    if (!almacen) blockers.push('Selecciona el almacén (en Envío).');
    if (rows.length === 0) blockers.push('Agrega al menos un producto.');
    if (rows.length > 0 && !rows.every((r) => r.sku && r.unitPrice > 0 && r.qty > 0)) {
      blockers.push('Hay líneas sin precio o cantidad.');
    }
    for (const r of rows) {
      // Sin almacén o sin stock consultado todavía no hay nada que comparar.
      const availableStock = stockFor(r);
      if (availableStock === null) continue;
      if (Number(r.qty || 0) > availableStock) {
        blockers.push(`Stock insuficiente para ${r.skuDisplay || r.sku}: pediste ${Number(r.qty || 0)} y hay ${availableStock} en ${almacen}.`);
      }
    }
    if (useAlternativeName && (!alternativeName.trim() || !alternativePhone.trim())) {
      blockers.push('Completa el nombre y celular de quien recibe (en Envío).');
    }
    if (requiresSellerAssignment && !assignedSellerId) blockers.push('Asigna el vendedor.');
    return blockers;
  })();

  const canSave = saveBlockers.length === 0;

  const resetQuoteForm = () => {
    setRows([]);
    setVentaType('sf');
    setDiscountMode('percent');
    setDiscountInput(0);
    setSelectedCouponCode('');
    setSelectedPromoIds(activePromos.length === 1 ? [activePromos[0].id] : []);
    setGiftChoiceByPromo({});
    setDeliveryInput('');
    setDeliveryQuote(null);
    setDeliveryIncluded(true);
    setUseAlternativeName(false);
    setAlternativeName('');
    setAlternativePhone('');
    setCustomerName('');
    setOrigen('');
    setOrigenAuto('');
    setKnownCustomer(null);
    setCustomerPhone('');
    setDepartment('');
    setDestino(null);
    setDestQuery('');
    setDestFallback(false);
    setFallbackCiudad('');
    // El almacén se conserva: casi siempre se cotiza del mismo, y dejarlo
    // vacío mostraba «Stock insuficiente… hay 0» en la segunda cotización.
    setShippingNotes('');
    setShowShipping(false);
    setShowDiscount(false);
    setLastOrder(null);
    if (requiresSellerAssignment && Array.isArray(salesUsers) && salesUsers.length > 0) {
      setAssignedSellerId(String(salesUsers[0].id));
    } else {
      setAssignedSellerId('');
    }
    clearDraftState(draftStorageKey);
  };

  const discardDraft = () => {
    resetQuoteForm();
    setDraftNotice('');
  };

  const saveAndGeneratePDF = async ({ paid = false } = {}) => {
    if (isSavingRef.current) return;
    if (!canSave) {
      // El botón siempre responde: dice exactamente qué falta y abre la
      // sección plegada si el dato está ahí.
      toast.error(saveBlockers[0] || 'Completa los datos de la cotización.');
      if (!almacen || (useAlternativeName && (!alternativeName.trim() || !alternativePhone.trim()))) setShowShipping(true);
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);

    const vendedorName = user ? (user.display_name || String(user.email || '').split('@')[0]) : 'Usuario';
    const selectedSeller = requiresSellerAssignment
      ? salesUsers.find((seller) => String(seller.id) === String(assignedSellerId))
      : null;
    const assignedSellerName = selectedSeller
      ? (selectedSeller.display_name || String(selectedSeller.email || '').split('@')[0] || vendedorName)
      : vendedorName;

    const rowsWithDisplay = rows.map(row => {
      const item = findItem(row.sku);
      const resolvedSku = String(row.sku || '').trim().toUpperCase();
      const resolvedName = item
        ? String(item.name || item.displayName || resolvedSku).trim()
        : String(row.skuDisplay || row.displayName || resolvedSku).trim();
      return {
        ...row,
        sku: resolvedSku,
        availableStock: stockFor(row),
        displayName: formatSkuNameLabel(resolvedSku, resolvedName)
      };
    });

    const expandedRows = [];
    for (const row of rowsWithDisplay) {
      if (row.isCombo) {
        expandedRows.push({
          ...row,
          skuDisplay: row.displayName,
          isComboHeader: true,
          isIndented: false
        });

        row.comboItems?.forEach(comboItem => {
          const componentSku = String(comboItem?.sku || '').trim().toUpperCase();
          const componentName = String(
            comboItem?.name
            || comboItem?.displayName
            || getProductNameBySku(componentSku)
            || ''
          ).trim();
          expandedRows.push({
            sku: componentSku,
            skuDisplay: formatSkuNameLabel(componentSku, componentName || 'Componente de combo'),
            qty: comboItem.quantity * (row.qty || 1),
            unitPrice: 0,
            lineTotal: 0,
            availableStock: null,
            isIndented: true
          });
        });
      } else {
        expandedRows.push({
          ...row,
          isIndented: false
        });
      }
    }

    const discountPercentForStorage = Math.round(effectiveDiscountPercent);
    // El regalo solo viaja si hay una promo de regalo MARCADA y la compra
    // alcanza su mínimo (se rechequea aquí por si el total bajó después).
    // Modo «paquete»: viaja todo el paquete. Modo «elección»: viaja solo el
    // producto que eligió el vendedor en el chip.
    const giftItemsMap = new Map();
    for (const promo of activePromos) {
      if (!selectedPromoIds.includes(promo.id) || promo.tool !== 'regalo') continue;
      if (!(total > 0 && total >= Number(promo.config?.min_total || 0))) continue;
      const gifts = Array.isArray(promo.gift_products) ? promo.gift_products : [];
      if (gifts.length === 0) continue;
      const chosen = promo.config?.gift_mode === 'eleccion'
        ? [gifts.find((gift) => gift.sku === giftChoiceByPromo[promo.id]) || gifts[0]]
        : gifts;
      for (const gift of chosen) {
        const prev = giftItemsMap.get(gift.sku);
        giftItemsMap.set(gift.sku, { sku: gift.sku, qty: (prev?.qty || 0) + gift.qty, name: gift.name });
      }
    }
    const giftItemsForSave = [...giftItemsMap.values()];
    const payload = {
      customer_name: customerName,
      customer_phone: customerPhone,
      origen: origen || null,
      origen_detalle: origenAuto && origen === origenAuto ? (origenAuto === 'whatsapp' ? 'inbox WhatsApp' : 'automático') : null,
      department: destino ? destino.departamento : (destFallback ? department : null),
      provincia: destino ? destino.provincia : null,
      ciudad: destino ? destino.municipio : (fallbackCiudad.trim() || null),
      dest_geo_id: destino ? destino.id : null,
      shipping_notes: shippingNotes,
      alternative_name: useAlternativeName ? alternativeName.trim() : null,
      alternative_phone: useAlternativeName ? alternativePhone.trim() : null,
      store_location: almacen,
      vendor: requiresSellerAssignment ? assignedSellerName : vendedorName,
      venta_type: ventaType,
      discount_percent: discountPercentForStorage,
      coupon_code: selectedCouponCode || null,
      seller_user_id: requiresSellerAssignment ? Number(assignedSellerId) : null,
      gift_items: giftItemsForSave.length > 0 ? giftItemsForSave : null,
      selected_promo_ids: selectedPromoIds,
      delivery_fee_bs: deliveryFee > 0 ? deliveryFee : null,
      delivery_label: deliveryFee > 0 ? (deliveryQuote?.label || 'Envío local') : null,
      delivery_gps: deliveryFee > 0 ? (deliveryQuote?.gps || null) : null,
      rows: rowsWithDisplay,
      subtotal,
      total: grandTotal,
      // «Guardar como pagado»: nace cobrada (descuenta stock y entra a comisión).
      ...(paid ? { status: 'Pagado' } : {})
    };

    try {
      const idempotencyKey =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const requestPath = '/api/quotes';
      const requestOptions = {
        method: 'POST',
        token,
        headers: {
          'X-Idempotency-Key': idempotencyKey
        },
        body: payload,
        retries: 0
      };
      let savedData = null;
      try {
        savedData = await apiRequest(requestPath, requestOptions);
      } catch (requestErr) {
        const isLikelyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        if (!isLikelyOffline) throw requestErr;
        const queueId = enqueue({
          type: 'quote_create',
          label: `Cotización ${customerName || 'sin nombre'}`,
          endpoint: requestPath,
          method: 'POST',
          token,
          headers: requestOptions.headers || {},
          body: payload,
          meta: {
            customerName,
            customerPhone,
            storeLocation: almacen
          }
        });
        resetQuoteForm();
        toast.info(`Sin conexión. La cotización quedó en cola (pendiente de envío): ${queueId.slice(0, 8)}.`);
        return;
      }

      const quoteNumber = savedData?.id || savedData?.quote?.id || null;
      if (paid && quoteNumber) {
        try {
          await apiRequest(`/api/quotes/${quoteNumber}/payment-method`, { method: 'PATCH', token, body: { payment_method: payMethod } });
        } catch (payErr) {
          console.error('No se pudo guardar el método de pago:', payErr);
          toast.info('Venta guardada como pagada; el método de pago se puede marcar en Historial.');
        }
      }
      // Cartera: the backend may have credited the sale to the customer's rep.
      if (savedData?.assigned_to) {
        toast.info(`Cliente de cartera: la venta se asignó a ${savedData.assigned_to}.`);
      }
      // Promos aplicadas por el servidor (snapshot): van a la proforma tal cual.
      const savedPromos = Array.isArray(savedData?.promos) ? savedData.promos : [];
      const sorteoPromo = savedPromos.find((promo) => promo.tool === 'sorteo');
      if (sorteoPromo?.code) {
        toast.info(`🎟️ Sorteo: código ${sorteoPromo.code} (${sorteoPromo.tickets} ticket${sorteoPromo.tickets > 1 ? 's' : ''}) impreso en la proforma.`);
      }
      const cuponPromo = savedPromos.find((promo) => promo.tool === 'cupon');
      if (cuponPromo?.code) {
        toast.info(`🎫 Cupón ${cuponPromo.code} (${cuponPromo.discount_percent}%) para la próxima compra, impreso en la proforma.`);
      }
      const dateText = quoteDateText();
      const safeCustomerName = String(customerName || 'sin_nombre').trim().replace(/\s+/g, '_');
      const pdfFilename = quoteNumber
        ? `cotizacion_${quoteNumber}_${safeCustomerName}.pdf`
        : `cotizacion_${safeCustomerName}.pdf`;

      const pdfDoc = generateModernQuotePdf({
        logo,
        filename: pdfFilename,
        quoteNumber,
        customerName,
        customerPhone,
        vendorName: requiresSellerAssignment ? assignedSellerName : vendedorName,
        storeLocation: almacen,
        dateText,
        department: destino ? destino.departamento : (destFallback ? department : null),
        provincia: destino ? destino.provincia : null,
        ciudad: destino ? destino.municipio : (fallbackCiudad.trim() || null),
        shippingNotes,
        alternativeName: useAlternativeName ? alternativeName.trim() : null,
        alternativePhone: useAlternativeName ? alternativePhone.trim() : null,
        rows: expandedRows,
        subtotal,
        discountPercent: effectiveDiscountPercent,
        discountAmount: discountAmountApplied,
        accessoryDiscount: accessoryDiscountBs > 0
          ? { percent: accessoryPromoPercent, amount: accessoryDiscountBs }
          : null,
        total: grandTotal,
        deliveryFee: deliveryFee > 0 ? deliveryFee : null,
        promos: savedPromos
      });

      if (whatsappConversationId && pdfDoc) {
        try {
          const pdfBlob = pdfDoc.output('blob');
          const formData = new FormData();
          formData.append('file', new File([pdfBlob], pdfFilename, { type: 'application/pdf' }));
          const uploadRes = await apiRequest('/api/whatsapp/inbox/media/upload', {
            method: 'POST',
            token,
            body: formData,
            timeoutMs: 120000
          });
          const mediaId = String(uploadRes?.media_id || '').trim();
          if (!mediaId) throw new Error('No se obtuvo media_id del archivo');
          await apiRequest(`/api/whatsapp/inbox/conversations/${whatsappConversationId}/messages`, {
            method: 'POST',
            token,
            body: {
              type: 'document',
              media_id: mediaId,
              filename: pdfFilename,
              caption: quoteNumber ? `Cotización PCX #${quoteNumber}` : 'Cotización PCX'
            }
          });
          toast.success('Cotización guardada y PDF enviado al chat de WhatsApp');
        } catch (waErr) {
          console.error('No se pudo enviar el PDF al chat de WhatsApp:', waErr);
          toast.error('Cotización guardada, pero el PDF no se pudo enviar al chat de WhatsApp');
        }
      } else {
        toast.success('Cotización guardada y PDF generado');
      }

      // Tarjeta de «guardada»: compartir el PDF o escribir al cliente sin salir.
      try {
        setSavedInfo({
          quoteNumber,
          customerName,
          customerPhone,
          total: grandTotal,
          paid,
          filename: pdfFilename,
          blob: pdfDoc ? pdfDoc.output('blob') : null
        });
      } catch {
        setSavedInfo({ quoteNumber, customerName, customerPhone, total: grandTotal, paid, filename: pdfFilename, blob: null });
      }
      setWhatsappConversationId(null);
      setDraftNotice('');
      resetQuoteForm();
      // Stock y atajos al día para la siguiente cotización.
      setRefreshTick((prev) => prev + 1);
      // La tarjeta de «guardada» queda arriba: se sube para que se vea.
      if (pageRef.current && typeof pageRef.current.scrollIntoView === 'function') {
        pageRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (!isMobile) window.setTimeout(() => nameInputRef.current?.focus(), 0);
    } catch (err) {
      console.error('Error completo al guardar:', err);
      if (err?.status === 401 || /token inv[aá]lido/i.test(String(err?.message || ''))) {
        toast.error('Tu sesión venció. Vuelve a ingresar; lo que escribiste queda guardado como borrador.');
      } else {
        toast.error('Error al guardar: ' + (err.message || 'Error desconocido'));
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  // Tarjeta de «guardada»: enlace de WhatsApp al cliente y compartir el PDF.
  const savedWaUrl = (() => {
    if (!savedInfo) return '';
    let digits = String(savedInfo.customerPhone || '').replace(/\D/g, '');
    if (digits.length === 8) digits = `591${digits}`;
    if (digits.length < 10) return '';
    const text = `Hola ${String(savedInfo.customerName || '').split(' ')[0]}, te envío tu cotización${savedInfo.quoteNumber ? ` #${savedInfo.quoteNumber}` : ''} de PCX por ${Number(savedInfo.total || 0).toFixed(2)} Bs. Cualquier consulta me avisas.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  })();
  const sharePdf = async () => {
    if (!savedInfo?.blob) return;
    try {
      const file = new File([savedInfo.blob], savedInfo.filename || 'cotizacion.pdf', { type: 'application/pdf' });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        toast.info('Este dispositivo no permite compartir archivos. El PDF ya está en tus descargas.');
        return;
      }
      await navigator.share({ files: [file], title: savedInfo.filename, text: `Cotización PCX${savedInfo.quoteNumber ? ` #${savedInfo.quoteNumber}` : ''}` });
    } catch (shareErr) {
      if (shareErr?.name !== 'AbortError') toast.info('No se pudo compartir. El PDF ya está en tus descargas.');
    }
  };

  const totalUnits = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  const discountPercentFieldValue = subtotal > 0 ? effectiveDiscountPercent.toFixed(2) : '0.00';
  const discountAmountFieldValue = discountAmountApplied.toFixed(2);
  const targetTotalFieldValue = total.toFixed(2);

  const parseDiscountText = (text) => {
    const cleaned = String(text || '').replace(',', '.').replace(/[^0-9.]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const handleDiscountPercentChange = (rawValue) => {
    const nextValue = clampNumber(parseDiscountText(rawValue), 0, 100);
    setDiscountMode('percent');
    setDiscountInput(nextValue);
  };

  const handleDiscountAmountChange = (rawValue) => {
    const nextValue = clampNumber(parseDiscountText(rawValue), 0, Math.max(0, subtotal));
    setDiscountMode('amount');
    setDiscountInput(nextValue);
  };

  const handleTargetTotalChange = (rawValue) => {
    const nextValue = clampNumber(parseDiscountText(rawValue), 0, Math.max(0, subtotal));
    setDiscountMode('target');
    setDiscountInput(nextValue);
  };

  const DISCOUNT_HANDLERS = { percent: handleDiscountPercentChange, amount: handleDiscountAmountChange, target: handleTargetTotalChange };
  const DISCOUNT_FIELD_VALUES = { percent: discountPercentFieldValue, amount: discountAmountFieldValue, target: targetTotalFieldValue };
  const discountFieldProps = (field) => ({
    type: 'text',
    inputMode: 'decimal',
    className: discountMode === field ? 'is-mode' : '',
    value: discountDraft.field === field ? discountDraft.text : DISCOUNT_FIELD_VALUES[field],
    onFocus: (e) => { setDiscountDraft({ field, text: DISCOUNT_FIELD_VALUES[field] }); e.target.select(); },
    onChange: (e) => {
      const text = e.target.value;
      if (!/^[0-9]*[.,]?[0-9]*$/.test(text)) return;
      setDiscountDraft({ field, text });
      DISCOUNT_HANDLERS[field](text);
    },
    onBlur: () => setDiscountDraft({ field: null, text: '' })
  });
  const clearDiscounts = () => {
    setDiscountMode('percent');
    setDiscountInput(0);
  };

  // ── Piezas de la pantalla ────────────────────────────────────────────────
  const hasDiscount = discountAmountApplied > 0.004;
  const hasAnyContent = rows.length > 0 || Boolean(customerName.trim() || customerPhone.trim());
  const showBlockers = !canSave && hasAnyContent;
  const totalLabel = deliveryFee > 0 ? 'Total con envío' : 'Total';
  const countLabel = rows.length === 0
    ? 'sin productos'
    : `${rows.length} producto${rows.length === 1 ? '' : 's'} · ${totalUnits} unid.`;

  const shippingBits = [];
  if (shippingNotes.trim()) shippingBits.push('con notas');
  if (useAlternativeName) shippingBits.push(alternativeName.trim() ? `recibe ${alternativeName.trim()}` : 'recibe otra persona');
  if (deliveryFee > 0) shippingBits.push(`envío local ${deliveryFee.toFixed(2)} Bs`);
  else if (deliveryQuote && !deliveryQuote.in_range) shippingBits.push('envío local fuera de cobertura');
  const shippingSummary = [almacen ? `Sale de ${almacen}` : 'Elige el almacén', ...shippingBits].join(' · ');

  const quickDestinations = !destino && !destFallback && !destQuery.trim() ? shortcuts.destinations.slice(0, isMobile ? 2 : 3) : [];

  const scrollToTicket = () => {
    if (ticketRef.current && typeof ticketRef.current.scrollIntoView === 'function') {
      ticketRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Total + botón principal. En pantalla ancha va al pie de la cotización; en
  // angosta, en la barra pegada abajo (y el total lleva a ver el detalle).
  const totalAndSave = (
    <>
      <div className="qt-total-row">
        {isWide ? (
          <div className="qt-total">
            <small>{totalLabel} · {countLabel}</small>
            <strong>{grandTotal.toFixed(2)} Bs</strong>
          </div>
        ) : (
          <button type="button" className="qt-total" onClick={scrollToTicket} title="Ver el detalle de la cotización">
            <small>{totalLabel} · {countLabel}</small>
            <strong>{grandTotal.toFixed(2)} Bs</strong>
          </button>
        )}
        <button
          type="button"
          className={`btn btn-primary qt-save ${canSave ? '' : 'is-blocked'}`}
          disabled={isSaving}
          onClick={() => saveAndGeneratePDF()}
          title="Guardar y generar PDF (Ctrl + Enter)"
        >
          {isSaving ? 'Guardando…' : 'Guardar y generar PDF'}
        </button>
      </div>
      {showBlockers && !isWide && (
        <div className="qt-blocker-hint">
          Falta: {saveBlockers[0]}{saveBlockers.length > 1 ? ` (+${saveBlockers.length - 1} más)` : ''}
        </div>
      )}
    </>
  );

  const pageStyle = scrollportHeight > 0 ? { '--qt-vh': `${scrollportHeight}px` } : undefined;

  return (
    <div
      className={`container qt-page ${pickerView === 'catalogo' ? 'is-photos' : 'is-list'}`}
      ref={pageRef}
      style={pageStyle}
      onKeyDown={(e) => {
        // Ctrl/⌘ + Enter guarda desde cualquier campo de la cotización.
        if (crmOpen || !(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
        e.preventDefault();
        saveAndGeneratePDF();
      }}
    >
      {savedInfo && (
        <div className="quote-saved-card" role="status">
          <div>
            <strong>✅ {savedInfo.paid ? 'Venta' : 'Cotización'}{savedInfo.quoteNumber ? ` #${savedInfo.quoteNumber}` : ''} guardada{savedInfo.paid ? ' como pagada' : ''}</strong>
            <span>{savedInfo.customerName} · {Number(savedInfo.total || 0).toFixed(2)} Bs · el PDF ya se descargó</span>
          </div>
          <div className="quote-saved-actions">
            {savedInfo.blob && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <button type="button" className="btn btn-primary" onClick={sharePdf}>📤 Compartir PDF</button>
            )}
            {savedWaUrl && (
              <a className="btn btn-secondary" href={savedWaUrl} target="_blank" rel="noopener noreferrer">💬 WhatsApp al cliente</a>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setSavedInfo(null)}>Cerrar</button>
          </div>
        </div>
      )}
      {whatsappConversationId && (
        <div className="qt-note is-wa">
          <span>Cotizando desde WhatsApp: al guardar, el PDF se enviará al chat del cliente.</span>
          <button
            type="button"
            className="qt-note-close"
            onClick={() => setWhatsappConversationId(null)}
            aria-label="No enviar al chat"
            title="No enviar al chat"
          >
            ✕
          </button>
        </div>
      )}
      {draftNotice && (
        <div className="qt-note is-draft">
          <span>{draftNotice}</span>
          <button type="button" className="qt-link-btn" onClick={discardDraft}>Descartar y empezar de cero</button>
          <button type="button" className="qt-note-close" onClick={() => setDraftNotice('')} aria-label="Cerrar aviso">✕</button>
        </div>
      )}

      <div className="qt-layout">
        <div className="qt-main">
          {/* ── Cliente y envío ─────────────────────────────────────────── */}
          <section className="card qt-card qt-client" aria-label="Cliente y envío">
            <div className="qt-card-head">
              <h3 className="qt-title">Cliente</h3>
              {knownCustomer && (
                <span className="qt-known">
                  ✓ Cliente guardado{knownCustomer.quotes_count > 0 ? ` · ${knownCustomer.quotes_count} cotiz.` : ''}
                </span>
              )}
              <button type="button" className="qt-crm-btn" onClick={() => setCrmOpen(true)}>
                Clientes
                {crmFollowUpsDue > 0 && <span className="crm-due-badge">{crmFollowUpsDue}</span>}
              </button>
            </div>

            <div className="qt-client-grid">
              <div className="qt-field">
                <label className="qt-label is-plain" htmlFor="qt-customer-name">Nombre</label>
                <CustomerSearchField
                  token={token}
                  value={customerName}
                  onChange={setCustomerName}
                  onPick={applyCustomer}
                  placeholder="Nombre del cliente"
                  maxLength={80}
                  className="form-input"
                  inputRef={nameInputRef}
                  onEnter={() => phoneInputRef.current?.focus()}
                  ariaLabel="Nombre del cliente"
                  inputId="qt-customer-name"
                />
                {customerName.length >= 70 && (
                  <div className="form-counter limit">{customerName.length}/80</div>
                )}
              </div>

              <div className="qt-field">
                <label className="qt-label is-plain" htmlFor="qt-customer-phone">Teléfono</label>
                <input
                  id="qt-customer-phone"
                  ref={phoneInputRef}
                  type="tel"
                  maxLength={40}
                  placeholder={isMobile ? 'Teléfono, ej. 77778888' : 'Teléfono'}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
                    e.preventDefault();
                    if (!destino && !destFallback) destInputRef.current?.focus();
                    else pickerInputRef.current?.focus();
                  }}
                  className="form-input"
                  aria-label="Teléfono del cliente"
                  autoComplete="off"
                />
                {customerPhone.length >= 36 && (
                  <div className="form-counter limit">{customerPhone.length}/40</div>
                )}
              </div>

              <div className="qt-field qt-field-dest">
                <label className="qt-label is-plain" htmlFor="qt-dest">Destino de envío</label>
                {destFallback ? (
                  <div className="quote-dest-fallback qt-dest-fallback">
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="Ciudad / localidad"
                      value={fallbackCiudad}
                      onChange={(e) => setFallbackCiudad(e.target.value)}
                      className="form-input"
                      aria-label="Ciudad o localidad de destino"
                    />
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="form-select"
                      aria-label="Departamento de destino"
                    >
                      <option value="" disabled>Departamento</option>
                      {DEPARTAMENTOS.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </div>
                ) : destino ? (
                  <div className="quote-dest-chip">
                    <span title={`${destino.municipio} · Prov. ${destino.provincia} · ${destino.departamento}`}>
                      📍 <strong>{destino.municipio}</strong>
                      {destino.provincia && !sameText(destino.provincia, destino.municipio) ? ` · Prov. ${destino.provincia}` : ''}
                      {' · '}{destino.departamento}
                    </span>
                    <button
                      type="button"
                      className="quote-dest-clear"
                      title="Cambiar destino"
                      aria-label="Cambiar destino"
                      onClick={() => {
                        setDestino(null);
                        setDestQuery('');
                        window.setTimeout(() => destInputRef.current?.focus(), 0);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="quote-dest-search">
                    <input
                      id="qt-dest"
                      ref={destInputRef}
                      type="text"
                      placeholder="Ciudad de destino…"
                      value={destQuery}
                      onChange={(e) => { setDestQuery(e.target.value); setDestOpen(true); }}
                      onFocus={() => setDestOpen(true)}
                      onBlur={() => setTimeout(() => setDestOpen(false), 150)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
                        e.preventDefault();
                        if (destResults.length > 0) chooseDestino(destResults[0]);
                      }}
                      className="form-input"
                      aria-label="Destino de envío"
                      autoComplete="off"
                    />
                    {destOpen && destResults.length > 0 && (
                      <ul className="quote-dest-results">
                        {destResults.map((result) => (
                          <li key={result.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => chooseDestino(result)}
                            >
                              <strong>{result.municipio}</strong>
                              <span>{result.provincia} · {result.departamento}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {destOpen && destQuery.trim().length >= 2 && destResults.length === 0 && (
                      <div className="quote-dest-empty">Sin resultados. Usa «Otro destino».</div>
                    )}
                  </div>
                )}
              </div>

              {!destino && (
                <div className="qt-dest-extra">
                  {quickDestinations.map((dest) => (
                    <button
                      key={dest.id}
                      type="button"
                      className="qt-dest-chip"
                      onClick={() => chooseDestino(dest)}
                      title={`${dest.municipio} · Prov. ${dest.provincia} · ${dest.departamento}`}
                    >
                      {dest.municipio}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="quote-dest-toggle"
                    onClick={() => {
                      setDestFallback((prev) => !prev);
                      setDestino(null);
                      setDestQuery('');
                      setDestOpen(false);
                    }}
                  >
                    {destFallback ? '← Buscar en la lista' : 'Otro destino'}
                  </button>
                </div>
              )}

              {needsOrigen && (
                <div className="qt-field">
                  <label className="qt-label is-compact" htmlFor="qt-origen">¿Cómo nos conoció?</label>
                  <select
                    id="qt-origen"
                    className="form-select"
                    value={origen}
                    onChange={(e) => setOrigen(e.target.value)}
                    aria-label="Cómo nos conoció"
                    title="Se pregunta solo la primera vez que cotizas a este cliente"
                  >
                    <option value="">{isMobile ? '¿Cómo nos conoció?' : 'Elegir…'}</option>
                    {ORIGENES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  {origenAuto && <div className="qt-hint">Detectado automáticamente; puedes corregirlo.</div>}
                </div>
              )}

              {requiresSellerAssignment && (
                <div className="qt-field">
                  <label className="qt-label" htmlFor="qt-seller">Vendedor asignado (comisión)</label>
                  <select
                    id="qt-seller"
                    value={assignedSellerId}
                    onChange={(e) => setAssignedSellerId(e.target.value)}
                    className="form-select"
                  >
                    <option value="" disabled>Seleccionar vendedor</option>
                    {salesUsers.map((seller) => (
                      <option key={seller.id} value={seller.id}>
                        {(seller.display_name || String(seller.email || '').split('@')[0] || 'Vendedor')} ({seller.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Envío: plegado en una línea; lo de todos los días (destino) queda arriba. */}
            <div className="qt-ship">
              <button
                type="button"
                className="qt-ship-toggle"
                onClick={() => setShowShipping((prev) => !prev)}
                aria-expanded={showShipping}
                aria-controls="qt-ship-panel"
              >
                <span className="qt-ship-icon" aria-hidden="true">🚚</span>
                <span className="qt-ship-text"><strong>Envío</strong>{shippingSummary}</span>
                <span className="qt-ship-more">{showShipping ? 'Ocultar ▴' : 'Opciones ▾'}</span>
              </button>

              {showShipping && (
                <div className="qt-ship-panel" id="qt-ship-panel">
                  <div className="qt-field">
                    <label className="qt-label" htmlFor="qt-almacen">Almacén de salida</label>
                    <select
                      id="qt-almacen"
                      value={almacen}
                      onChange={(e) => setAlmacen(e.target.value)}
                      className="form-select"
                    >
                      <option value="" disabled>Almacén</option>
                      {ALMACEN_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div className="qt-field">
                    <label className="qt-label" htmlFor="qt-notes">Notas de envío (opcional)</label>
                    <input
                      id="qt-notes"
                      type="text"
                      maxLength={120}
                      placeholder="Instrucciones, referencias..."
                      value={shippingNotes}
                      onChange={(e) => setShippingNotes(e.target.value)}
                      className="form-input"
                    />
                    {shippingNotes.length >= 110 && (
                      <div className="form-counter limit">{shippingNotes.length}/120</div>
                    )}
                  </div>

                  <div className="qt-ship-alt">
                    <label className="form-check-label">
                      <input type="checkbox" checked={useAlternativeName} onChange={(e) => setUseAlternativeName(e.target.checked)} />
                      Enviar a nombre diferente
                    </label>
                    {useAlternativeName && (
                      <div className="quote-altname-inputs">
                        <input
                          type="text"
                          maxLength={80}
                          placeholder="Nombre alternativo para envío"
                          value={alternativeName}
                          onChange={(e) => setAlternativeName(e.target.value)}
                          className="form-input"
                        />
                        <input
                          type="tel"
                          maxLength={40}
                          placeholder="Teléfono alternativo para envío"
                          value={alternativePhone}
                          onChange={(e) => setAlternativePhone(e.target.value)}
                          className="form-input"
                        />
                      </div>
                    )}
                  </div>

                  <div className="quote-delivery-cell">
                    <div className="quote-delivery-head">
                      <span className="quote-delivery-title">🛵 Envío local (GPS del cliente)</span>
                      <span className="quote-delivery-hint">✅ Lo seguro: pega «lat, lng» — ej. -17.4066, -66.1450</span>
                    </div>
                    <div className="quote-delivery-row">
                      <input
                        type="text"
                        maxLength={200}
                        placeholder="-17.4066, -66.1450 (o un link de Maps)"
                        value={deliveryInput}
                        onChange={(e) => setDeliveryInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); requestDeliveryQuote(deliveryInput); }
                        }}
                        className="form-input"
                        aria-label="Ubicación GPS del cliente"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary quote-delivery-btn"
                        disabled={deliveryLoading || !deliveryInput.trim()}
                        onClick={() => requestDeliveryQuote(deliveryInput)}
                      >
                        {deliveryLoading ? 'Calculando…' : 'Cotizar envío'}
                      </button>
                    </div>
                    {deliveryQuote && (
                      deliveryQuote.in_range ? (
                        <div className="quote-delivery-result is-ok">
                          <span>
                            ✅ {deliveryQuote.city} · {deliveryQuote.distance_km} km del almacén →{' '}
                            <strong>{Number(deliveryQuote.price_bs).toFixed(2)} Bs</strong>
                          </span>
                          {deliveryQuote.maps_url && (
                            <a href={deliveryQuote.maps_url} target="_blank" rel="noopener noreferrer" className="quote-delivery-verify">
                              📍 verificar punto ↗
                            </a>
                          )}
                          <label className="quote-delivery-include">
                            <input
                              type="checkbox"
                              checked={deliveryIncluded}
                              onChange={(e) => setDeliveryIncluded(e.target.checked)}
                            />
                            Sumar al total
                          </label>
                        </div>
                      ) : (
                        <div className="quote-delivery-result is-out">
                          <span>⚠️ {deliveryQuote.message || 'Fuera de cobertura: cotizar manual'}</span>
                          {deliveryQuote.maps_url && (
                            <a href={deliveryQuote.maps_url} target="_blank" rel="noopener noreferrer" className="quote-delivery-verify">
                              📍 ver el punto leído ↗
                            </a>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Buscador de productos ───────────────────────────────────── */}
          <section className="card qt-card qt-picker-card" aria-label="Agregar productos">
            <QuotePicker
              items={allItems}
              rows={rows}
              priceFor={unitPriceFor}
              stockFor={stockFor}
              onSetQty={setItemQty}
              onAdd={addItem}
              topSkus={shortcuts.products}
              view={pickerView}
              onViewChange={switchPickerView}
              isMobile={isMobile}
              inputRef={pickerInputRef}
            />
          </section>
        </div>

        {/* ── La cotización ───────────────────────────────────────────── */}
        <aside className="qt-side">
          <section className="card qt-card qt-ticket" ref={ticketRef} aria-label="Cotización">
            <div className="qt-card-head">
              <h3 className="qt-title">Cotización</h3>
              <div className="qt-seg" role="group" aria-label="Tipo de venta">
                <button type="button" className={ventaType === 'sf' ? 'active' : ''} onClick={() => setVentaType('sf')}>Sin factura</button>
                <button type="button" className={ventaType === 'cf' ? 'active' : ''} onClick={() => setVentaType('cf')}>Con factura</button>
              </div>
            </div>

            <div className="qt-ticket-body">
              {rows.length === 0 ? (
                <div className="qt-empty">
                  <span>Aún no hay productos. Búscalos o toca uno de los más cotizados.</span>
                  {lastOrder && (
                    <button type="button" className="quote-repeat-btn" onClick={() => loadRowsFromItems(lastOrder.items)}>
                      ↻ Repetir su último pedido · {lastOrder.items.length} producto{lastOrder.items.length === 1 ? '' : 's'} · {Number(lastOrder.total || 0).toFixed(0)} Bs
                    </button>
                  )}
                </div>
              ) : (
                <ul className="qt-lines">
                  {rows.map((row) => {
                    const stock = stockFor(row);
                    const over = stock !== null && Number(row.qty || 0) > stock;
                    const label = row.skuDisplay || row.sku;
                    return (
                      <li key={row.id} className={`qt-line ${over ? 'is-over' : ''}`}>
                        <div className="qt-line-main">
                          <span className="qt-line-name" title={label}>{label}</span>
                          <span className="qt-line-meta">
                            {row.isCombo ? 'Combo · ' : ''}{(row.unitPrice || 0).toFixed(2)} Bs c/u
                            {stock !== null && !over ? ` · disp. ${stock}` : ''}
                          </span>
                          {over && (
                            <span className="qt-line-warn">
                              {stock <= 0 ? `Sin stock en ${almacen}` : `Solo hay ${stock} en ${almacen}`}
                            </span>
                          )}
                        </div>
                        <QtyStepper qty={row.qty} onChange={(next) => setItemQty(row.sku, next)} label={label} size="sm" />
                        <span className="qt-line-total">{(row.lineTotal || 0).toFixed(2)}</span>
                        <button type="button" className="qt-line-del" onClick={() => removeRow(row.id)} aria-label={`Quitar ${label}`} title="Quitar">✕</button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {activePromos.length > 0 && (
                <div className="quote-promo-chips qt-promos">
                  {activePromos.length > 1 && (
                    <div
                      className="quote-promo-picker-hint"
                      title="Las promos del mismo grupo no se combinan: marcar una desmarca la otra."
                    >
                      {activePromos.length} promos vigentes: marca las que se lleva esta venta.
                    </div>
                  )}
                  {activePromos.map((promo) => {
                    const config = promo.config || {};
                    const minTotal = Number(config.min_total || 0);
                    const reachesMin = minTotal <= 0 || total >= minTotal;
                    const isSelected = selectedPromoIds.includes(promo.id);
                    const applyControl = (label) => (
                      <label
                        className="quote-promo-apply"
                        title="Solo las promos marcadas se imprimen en la proforma y aplican a esta venta"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => togglePromo(promo, e.target.checked)}
                        />
                        {label}
                      </label>
                    );
                    if (promo.tool === 'envio_gratis') {
                      return (
                        <div key={promo.id} className={`quote-promo-chip ${isSelected ? 'is-selected' : ''} ${isSelected && reachesMin ? 'is-earned' : ''}`}>
                          🚚 <strong>{promo.name}</strong>
                          {minTotal > 0 && ` · desde ${minTotal} Bs`}
                          {promo.ends_on && ` · hasta ${promo.ends_on.split('-').reverse().join('/')}`}
                          {minTotal > 0 && !reachesMin && total > 0 && ` — faltan ${(minTotal - total).toFixed(0)} Bs`}
                          {applyControl('Aplicar')}
                          {isSelected && reachesMin && total > 0 && ' ✓'}
                        </div>
                      );
                    }
                    if (promo.tool === 'cupon') {
                      return (
                        <div key={promo.id} className={`quote-promo-chip is-cupon ${isSelected ? 'is-selected' : ''} ${isSelected && reachesMin && total > 0 ? 'is-earned' : ''}`}>
                          🎫 <strong>{promo.name}</strong>
                          {` · esta compra gana un cupón del ${Number(config.discount_percent || 0)}% para la próxima`}
                          {minTotal > 0 && ` (desde ${minTotal} Bs)`}
                          {minTotal > 0 && !reachesMin && total > 0 && ` — faltan ${(minTotal - total).toFixed(0)} Bs`}
                          {applyControl('Aplicar')}
                          {isSelected && reachesMin && total > 0 && ' ✓'}
                        </div>
                      );
                    }
                    if (promo.tool === 'regalo') {
                      const gifts = Array.isArray(promo.gift_products) ? promo.gift_products : [];
                      const earned = reachesMin && total > 0;
                      const isChoiceMode = config.gift_mode === 'eleccion';
                      const chosenSku = giftChoiceByPromo[promo.id] || gifts[0]?.sku || '';
                      const bundleLabel = isChoiceMode
                        ? `el cliente elige 1 de ${gifts.length} regalos`
                        : gifts.map((gift) => `${gift.qty}× ${gift.name}`).join(' + ');
                      return (
                        <div key={promo.id} className={`quote-promo-chip is-regalo ${isSelected ? 'is-selected' : ''} ${isSelected && earned ? 'is-earned' : ''}`}>
                          🎁 <strong>{promo.name}</strong>
                          {bundleLabel && ` · ${isChoiceMode ? '' : 'incluye '}${bundleLabel}`}
                          {minTotal > 0 && ` · desde ${minTotal} Bs`}
                          {promo.ends_on && ` · hasta ${promo.ends_on.split('-').reverse().join('/')}`}
                          {minTotal > 0 && !reachesMin && total > 0 && ` — faltan ${(minTotal - total).toFixed(0)} Bs`}
                          {gifts.length > 0 && applyControl('Incluir regalo')}
                          {isChoiceMode && isSelected && gifts.length > 0 && (
                            <select
                              className="quote-gift-select"
                              value={chosenSku}
                              onChange={(e) => setGiftChoiceByPromo((prev) => ({ ...prev, [promo.id]: e.target.value }))}
                              title="Regalo que se lleva este cliente"
                            >
                              {gifts.map((gift) => (
                                <option key={gift.sku} value={gift.sku}>
                                  {gift.qty > 1 ? `${gift.qty}× ` : ''}{gift.name}
                                </option>
                              ))}
                            </select>
                          )}
                          {isSelected && earned && gifts.length > 0 && ' ✓'}
                        </div>
                      );
                    }
                    if (promo.tool === 'descuento_accesorios') {
                      const pct = Number(config.discount_percent || 0);
                      const chipDiscount = Math.round(accessoriesSubtotal * pct) / 100;
                      const earned = isSelected && reachesMin && accessoriesSubtotal > 0;
                      return (
                        <div key={promo.id} className={`quote-promo-chip is-dcto-acc ${isSelected ? 'is-selected' : ''} ${earned ? 'is-earned' : ''}`}>
                          🔩 <strong>{promo.name}</strong>
                          {` · ${pct}% de descuento en todos los accesorios`}
                          {minTotal > 0 && ` · desde ${minTotal} Bs`}
                          {promo.ends_on && ` · hasta ${promo.ends_on.split('-').reverse().join('/')}`}
                          {minTotal > 0 && !reachesMin && total > 0 && ` — faltan ${(minTotal - total).toFixed(0)} Bs`}
                          {reachesMin && total > 0 && accessoriesSubtotal <= 0 && ' — la orden aún no tiene accesorios'}
                          {reachesMin && chipDiscount > 0 && ` — descuenta ${chipDiscount.toFixed(2)} Bs`}
                          {applyControl('Aplicar')}
                          {earned && ' ✓'}
                        </div>
                      );
                    }
                    if (promo.tool === 'sorteo') {
                      const perTicket = Number(config.bs_per_ticket || 0);
                      const cap = Math.max(1, Number(config.max_tickets || 5));
                      const earned = !reachesMin || total <= 0
                        ? 0
                        : (perTicket > 0 ? Math.max(1, Math.min(cap, Math.floor(total / perTicket))) : 1);
                      return (
                        <div key={promo.id} className={`quote-promo-chip is-sorteo ${isSelected ? 'is-selected' : ''} ${isSelected && earned > 0 ? 'is-earned' : ''}`}>
                          🎟️ <strong>{promo.name}</strong>
                          {minTotal > 0 && ` · participa desde ${minTotal} Bs`}
                          {perTicket > 0 && ` · 1 ticket por cada ${perTicket} Bs`}
                          {earned > 0 && isSelected
                            ? ` — este pedido gana ${earned} ticket${earned > 1 ? 's' : ''} 🎉`
                            : (minTotal > 0 && total > 0 && !reachesMin ? ` — faltan ${(minTotal - total).toFixed(0)} Bs` : '')}
                          {applyControl('Aplicar')}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}

            </div>

            <div className="qt-ticket-foot">
              {(customerCoupon || selectedCouponCode) && (
                selectedCouponCode ? (
                  <div className="quote-coupon-chip is-applied qt-coupon">
                    🎫 <strong>{selectedCouponCode}</strong> aplicado
                    {customerCoupon?.code === selectedCouponCode && customerCoupon?.discount_percent
                      ? ` (${customerCoupon.discount_percent}% dcto)` : ''}
                    <button
                      type="button"
                      className="quote-coupon-btn"
                      onClick={() => {
                        setSelectedCouponCode('');
                        setDiscountMode('percent');
                        setDiscountInput(0);
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <div className="quote-coupon-chip qt-coupon">
                    🎫 Este cliente tiene el cupón <strong>{customerCoupon.code}</strong> ({customerCoupon.discount_percent}% dcto
                    {customerCoupon.expires_on ? ` · vence ${customerCoupon.expires_on.split('-').reverse().join('/')}` : ''})
                    <button
                      type="button"
                      className="quote-coupon-btn"
                      onClick={() => {
                        setSelectedCouponCode(customerCoupon.code);
                        setDiscountMode('percent');
                        setDiscountInput(Number(customerCoupon.discount_percent || 0));
                      }}
                    >
                      Aplicar
                    </button>
                  </div>
                )
              )}

              <div className="qt-totals">
                {(hasDiscount || accessoryDiscountBs > 0 || deliveryFee > 0) && (
                  <div className="qt-total-line">
                    <span>Subtotal</span>
                    <strong>{subtotal.toFixed(2)} Bs</strong>
                  </div>
                )}
                <div className={`qt-total-line ${hasDiscount ? 'is-discount' : ''}`}>
                  <button
                    type="button"
                    className="qt-link-btn"
                    onClick={() => setShowDiscount((prev) => !prev)}
                    aria-expanded={showDiscount}
                    aria-controls="qt-discount-editor"
                  >
                    {hasDiscount ? 'Descuento' : '+ Descuento'} {showDiscount ? '▴' : '▾'}
                  </button>
                  {hasDiscount && (
                    <strong>−{discountAmountApplied.toFixed(2)} Bs ({effectiveDiscountPercent.toFixed(1)}%)</strong>
                  )}
                </div>
                {showDiscount && (
                  <div className="qt-discount-editor" id="qt-discount-editor">
                    <label>Descuento %<input {...discountFieldProps('percent')} aria-label="Descuento en porcentaje" /></label>
                    <label>Descuento Bs<input {...discountFieldProps('amount')} aria-label="Descuento en bolivianos" /></label>
                    <label>Total objetivo Bs<input {...discountFieldProps('target')} aria-label="Total objetivo en bolivianos" /></label>
                    {hasDiscount && (
                      <button type="button" className="qt-link-btn qt-discount-clear" onClick={clearDiscounts}>Quitar descuento</button>
                    )}
                  </div>
                )}
                {accessoryDiscountBs > 0 && (
                  <div className="qt-total-line is-promo">
                    <span>Promo accesorios ({accessoryPromoPercent}%)</span>
                    <strong>−{accessoryDiscountBs.toFixed(2)} Bs</strong>
                  </div>
                )}
                {deliveryFee > 0 && (
                  <div className="qt-total-line">
                    <span>Envío local</span>
                    <strong>+{deliveryFee.toFixed(2)} Bs</strong>
                  </div>
                )}
              </div>
              {isWide && totalAndSave}
              {/* Venta de mostrador: guardar ya cobrada, sin pasar por Historial. */}
              <div className="qt-paid-row">
                <button
                  type="button"
                  className={`btn qt-paid-btn ${canSave ? '' : 'is-blocked'}`}
                  disabled={isSaving}
                  onClick={() => saveAndGeneratePDF({ paid: true })}
                >
                  💵 Guardar como pagado
                </button>
                <select className="form-select qt-paid-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} aria-label="Método de pago">
                  <option value="QR">QR</option>
                  <option value="Efectivo">Efectivo</option>
                </select>
              </div>
              {showBlockers && (
                <div className="quote-save-blockers">
                  <strong>Para guardar falta:</strong>
                  <ul>
                    {saveBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      {!isWide && <div className="qt-savebar">{totalAndSave}</div>}

      <CustomerHub
        token={token}
        open={crmOpen}
        onClose={() => setCrmOpen(false)}
        onUseCustomer={applyCustomer}
      />
    </div>
  );
}
