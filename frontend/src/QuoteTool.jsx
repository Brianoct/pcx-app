// QuoteTool.jsx
import { useState, useEffect, useRef } from 'react';
import logo from './assets/logo.png';
import { generateModernQuotePdf } from './quotePdf';
import { apiRequest } from './apiClient';
import { clearDraftState, useDraftState } from './useDraftState';
import { useOutbox } from './OutboxProvider';

const clampNumber = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
};

const GIFT_OPTIONS = [
  'Llaverito de cortesía',
  'Gancho 5cm (docena)',
  'Gancho 10cm (docena)',
  'Porta llave grande',
  'Set de tornillos',
  'Sticker PCX'
];

export default function QuoteTool({ token, user }) {
  const [combos, setCombos] = useState([]);
  const [products, setProducts] = useState([]);
  const legacyDraftStorageKey = 'pcx.quoteDraft.v1';
  const userDraftSuffix = user?.id
    ? `id:${user.id}`
    : `email:${String(user?.email || 'anon').trim().toLowerCase()}`;
  const draftStorageKey = `pcx.quoteDraft.v2:${userDraftSuffix}`;
  const [draft, setDraft] = useDraftState(draftStorageKey, null);

  const [step, setStep] = useState(1);

  const [rows, setRows] = useState([]);
  const [ventaType, setVentaType] = useState('sf');
  const [discountMode, setDiscountMode] = useState('percent');
  const [discountInput, setDiscountInput] = useState(0);
  const [coupons, setCoupons] = useState([]);
  const [selectedCouponCode, setSelectedCouponCode] = useState('');
  const [selectedGiftLabel, setSelectedGiftLabel] = useState('');
  const [useAlternativeName, setUseAlternativeName] = useState(false);
  const [alternativeName, setAlternativeName] = useState('');
  const [alternativePhone, setAlternativePhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [provincia, setProvincia] = useState('');
  const [isProvincia, setIsProvincia] = useState(false);
  const [almacen, setAlmacen] = useState('');
  const [shippingNotes, setShippingNotes] = useState('');
  const [currentDateTime, setCurrentDateTime] = useState('');
  const [salesUsers, setSalesUsers] = useState([]);
  const [assignedSellerId, setAssignedSellerId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const restoredDraftKeyRef = useRef('');
  const [draftNotice, setDraftNotice] = useState('');
  const { enqueue } = useOutbox();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const normalizedRole = String(user?.role || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const isSalesRole = normalizedRole === 'ventas'
    || normalizedRole === 'ventas lider'
    || normalizedRole === 'sales'
    || normalizedRole === 'vendedor';
  const requiresSellerAssignment = !isSalesRole;

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
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (step === 2) {
      const fetchCatalog = async () => {
        try {
          const data = await apiRequest('/api/product-catalog', { token });
          setProducts(Array.isArray(data) ? data : []);
        } catch (err) {
          console.error('Error fetching product catalog:', err);
        }
      };
      const fetchCombos = async () => {
        try {
          const data = await apiRequest('/api/combos', { token });
          setCombos(Array.isArray(data) ? data : []);
        } catch (err) {
          console.error('Error fetching combos:', err);
        }
      };
      fetchCatalog();
      fetchCombos();
    }
  }, [step, token]);

  useEffect(() => {
    if (step === 2 && rows.length === 0) {
      addRow();
    }
  }, [step]);

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
      const formatter = new Intl.DateTimeFormat('es-BO', options);
      const formatted = formatter.format(now);
      setCurrentDateTime(formatted.charAt(0).toUpperCase() + formatted.slice(1));
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 60000);
    return () => clearInterval(interval);
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

  useEffect(() => {
    if (!token) return;
    const fetchCoupons = async () => {
      try {
        const data = await apiRequest('/api/cupones', { token });
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const activeCoupons = (Array.isArray(data) ? data : [])
          .filter((coupon) => {
            const rawDate = String(coupon?.valid_until || '');
            const validUntilDate = new Date(`${rawDate}T00:00:00`);
            return !Number.isNaN(validUntilDate.getTime()) && validUntilDate >= now;
          })
          .sort((a, b) => String(a.valid_until || '').localeCompare(String(b.valid_until || '')));
        setCoupons(activeCoupons);
      } catch (err) {
        console.error('Error fetching cupones activos:', err);
        setCoupons([]);
      }
    };
    fetchCoupons();
  }, [token]);

  const allItems = [
    ...products.map((p) => ({ ...p, displayName: p.name })),
    ...combos.map(combo => ({
      sku: `COMBO_${combo.id}`,
      displayName: `${combo.name} (Combo)`,
      name: combo.name,
      sf: Number(combo.sf_price) || 0,
      cf: Number(combo.cf_price) || 0,
      isCombo: true,
      comboId: combo.id,
      items: combo.items || []
    }))
  ];

  const findItem = (sku) => allItems.find(item => item.sku === sku);
  const getProductNameBySku = (skuValue = '') => {
    const normalizedSku = String(skuValue || '').trim().toUpperCase();
    if (!normalizedSku) return '';
    const product = products.find((p) => String(p?.sku || '').trim().toUpperCase() === normalizedSku);
    return String(product?.name || '').trim();
  };

  const fetchStock = async (sku, store) => {
    if (!sku || !store || sku.startsWith('COMBO_')) return null;
    try {
      const data = await apiRequest(
        `/api/stock?sku=${encodeURIComponent(sku)}&store_location=${encodeURIComponent(store)}`,
        { token }
      );
      return data.stock;
    } catch (err) {
      console.error('Error fetching stock:', err);
      return null;
    }
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

  const fetchComboAvailableStock = async (entry, store) => {
    if (!store) return null;
    const comboItems = getNormalizedComboItems(entry);
    if (comboItems.length === 0) return null;
    const stockBySku = await Promise.all(
      comboItems.map(async (comboItem) => {
        const stock = await fetchStock(comboItem.sku, store);
        return { comboItem, stock };
      })
    );
    let minAvailable = Number.POSITIVE_INFINITY;
    for (const { comboItem, stock } of stockBySku) {
      if (!Number.isFinite(Number(stock))) return null;
      const possibleCombos = Math.floor(Number(stock) / comboItem.quantity);
      minAvailable = Math.min(minAvailable, possibleCombos);
    }
    return Number.isFinite(minAvailable) ? Math.max(0, minAvailable) : null;
  };

  const handleProductSelect = async (rowId, selectedSku) => {
    const item = findItem(selectedSku);
    let availableStock = null;
    if (item && almacen) {
      availableStock = item.isCombo
        ? await fetchComboAvailableStock(item, almacen)
        : await fetchStock(selectedSku, almacen);
    }

    setRows(rows.map(row =>
      row.id === rowId ? {
        ...row,
        sku: selectedSku,
        skuDisplay: item ? item.displayName : selectedSku,
        unitPrice: item ? Number(item.sf || item.cf || 0) : 0,
        lineTotal: item ? Number(item.sf || item.cf || 0) * (row.qty || 0) : 0,
        availableStock,
        isCombo: item?.isCombo || false,
        comboItems: item?.isCombo ? item.items : undefined
      } : row
    ));
  };

  const handleQtyChange = (rowId, newQty) => {
    const qty = newQty === '' ? '' : Math.max(1, parseInt(newQty) || 1);
    setRows(rows.map(row =>
      row.id === rowId ? { ...row, qty, lineTotal: (row.unitPrice || 0) * (qty || 0) } : row
    ));
  };

  const addRow = () => {
    const newRow = { id: Date.now(), sku: '', skuDisplay: '', qty: '', unitPrice: 0, lineTotal: 0, availableStock: null, isCombo: false };
    setRows([...rows, newRow]);
  };

  const confirmAndDeleteRow = (id) => {
    if (window.confirm('¿Eliminar esta línea?')) {
      setRows(rows.filter(r => r.id !== id));
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

  useEffect(() => {
    setRows(prev => prev.map(row => {
      if (!row.sku) return row;
      const item = findItem(row.sku);
      if (!item) return row;
      const newPrice = ventaType === 'sf' ? Number(item.sf || 0) : Number(item.cf || 0);
      return { ...row, unitPrice: newPrice, lineTotal: newPrice * (row.qty || 0) };
    }));
  }, [ventaType]);

  useEffect(() => {
    if (!almacen || step !== 2) return;
    const refreshStock = async () => {
      for (const row of rows) {
        if (row.sku) {
          const stock = row.isCombo
            ? await fetchComboAvailableStock(row, almacen)
            : await fetchStock(row.sku, almacen);
          setRows(prev => prev.map(r =>
            r.id === row.id ? { ...r, availableStock: stock } : r
          ));
        }
      }
    };
    refreshStock();
  }, [almacen, step]);

  useEffect(() => {
    if (restoredDraftKeyRef.current === draftStorageKey) return;
    restoredDraftKeyRef.current = draftStorageKey;
    if (!draft || !draft.values || !draft.hasContent) return;
    const values = draft.values;
    if (values.step) setStep(values.step);
    if (Array.isArray(values.rows)) setRows(values.rows);
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
    if (typeof values.provincia === 'string') setProvincia(values.provincia);
    if (typeof values.isProvincia === 'boolean') setIsProvincia(values.isProvincia);
    if (typeof values.almacen === 'string') setAlmacen(values.almacen);
    if (typeof values.shippingNotes === 'string') setShippingNotes(values.shippingNotes);
    if (typeof values.assignedSellerId === 'string') setAssignedSellerId(values.assignedSellerId);
    if (typeof values.selectedCouponCode === 'string') setSelectedCouponCode(values.selectedCouponCode);
    if (typeof values.selectedGiftLabel === 'string') setSelectedGiftLabel(values.selectedGiftLabel);
    setDraftNotice('Se recuperó un borrador local.');
  }, [draftStorageKey, draft]);

  useEffect(() => {
    // Remove legacy shared draft key so drafts never bleed across accounts again.
    clearDraftState(legacyDraftStorageKey);
  }, []);

  useEffect(() => {
    const hasContent =
      Boolean(customerName || customerPhone || department || provincia || shippingNotes || alternativeName || alternativePhone)
      || rows.some((r) => r?.sku || Number(r?.qty || 0) > 0);

    setDraft({
      hasContent,
      values: {
        step,
        rows,
        ventaType,
        discountMode,
        discountInput,
        selectedCouponCode,
        selectedGiftLabel,
        useAlternativeName,
        alternativeName,
        alternativePhone,
        customerName,
        customerPhone,
        department,
        provincia,
        isProvincia,
        almacen,
        shippingNotes,
        assignedSellerId
      }
    });
  }, [
    step,
    rows,
    ventaType,
    discountMode,
    discountInput,
    selectedCouponCode,
    selectedGiftLabel,
    useAlternativeName,
    alternativeName,
    alternativePhone,
    customerName,
    customerPhone,
    department,
    provincia,
    isProvincia,
    almacen,
    shippingNotes,
    assignedSellerId
  ]);

  const canSave =
    customerName.trim() &&
    customerPhone.trim() &&
    almacen &&
    rows.length > 0 &&
    rows.every(r => r.sku && r.unitPrice > 0 && r.qty > 0) &&
    rows.every((r) => {
      const availableStock = Number(r.availableStock);
      if (!Number.isFinite(availableStock)) return true;
      return Number(r.qty || 0) <= availableStock;
    }) &&
    (!isProvincia || provincia.trim()) &&
    (isProvincia || department) &&
    (!useAlternativeName || (alternativeName.trim() && alternativePhone.trim())) &&
    (!requiresSellerAssignment || assignedSellerId);

  const resetQuoteForm = () => {
    setStep(1);
    setRows([]);
    setVentaType('sf');
    setDiscountMode('percent');
    setDiscountInput(0);
    setSelectedCouponCode('');
    setSelectedGiftLabel('');
    setUseAlternativeName(false);
    setAlternativeName('');
    setAlternativePhone('');
    setCustomerName('');
    setCustomerPhone('');
    setDepartment('');
    setProvincia('');
    setIsProvincia(false);
    setAlmacen('');
    setShippingNotes('');
    if (requiresSellerAssignment && Array.isArray(salesUsers) && salesUsers.length > 0) {
      setAssignedSellerId(String(salesUsers[0].id));
    } else {
      setAssignedSellerId('');
    }
    clearDraftState(draftStorageKey);
  };

  const saveAndGeneratePDF = async () => {
    if (isSavingRef.current) return;
    if (!canSave) {
      alert('Completa todos los campos obligatorios del cliente y verifica que todas las líneas tengan producto y cantidad.');
      return;
    }
    const insufficientStockRows = rows.filter((row) => {
      const availableStock = Number(row.availableStock);
      if (!Number.isFinite(availableStock)) return false;
      return Number(row.qty || 0) > availableStock;
    });
    if (insufficientStockRows.length > 0) {
      const first = insufficientStockRows[0];
      const label = first.skuDisplay || first.sku || 'producto';
      alert(`Stock insuficiente para ${label}. Disponible: ${Number(first.availableStock || 0)}.`);
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
    const payload = {
      customer_name: customerName,
      customer_phone: customerPhone,
      department: isProvincia ? null : department,
      provincia: isProvincia ? provincia : null,
      shipping_notes: shippingNotes,
      alternative_name: useAlternativeName ? alternativeName.trim() : null,
      alternative_phone: useAlternativeName ? alternativePhone.trim() : null,
      store_location: almacen,
      vendor: requiresSellerAssignment ? assignedSellerName : vendedorName,
      venta_type: ventaType,
      discount_percent: discountPercentForStorage,
      coupon_code: selectedCouponCode || null,
      gift_label: selectedGiftLabel || null,
      seller_user_id: requiresSellerAssignment ? Number(assignedSellerId) : null,
      rows: rowsWithDisplay,
      subtotal,
      total
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
        alert(`Sin conexión. La cotización quedó en cola (pendiente de envío): ${queueId.slice(0, 8)}.`);
        return;
      }

      const quoteNumber = savedData?.id || savedData?.quote?.id || null;
      const dateParts = currentDateTime?.split(', ') || [];
      const dateText = dateParts.length > 1 ? dateParts.slice(1).join(', ') : currentDateTime;
      const safeCustomerName = String(customerName || 'sin_nombre').trim().replace(/\s+/g, '_');
      const pdfFilename = quoteNumber
        ? `cotizacion_${quoteNumber}_${safeCustomerName}.pdf`
        : `cotizacion_${safeCustomerName}.pdf`;

      generateModernQuotePdf({
        logo,
        filename: pdfFilename,
        quoteNumber,
        customerName,
        customerPhone,
        vendorName: requiresSellerAssignment ? assignedSellerName : vendedorName,
        storeLocation: almacen,
        dateText,
        department: isProvincia ? null : department,
        provincia: isProvincia ? provincia : null,
        shippingNotes,
        alternativeName: useAlternativeName ? alternativeName.trim() : null,
        alternativePhone: useAlternativeName ? alternativePhone.trim() : null,
        rows: expandedRows,
        subtotal,
        discountPercent: effectiveDiscountPercent,
        discountAmount: discountAmountApplied,
        total
      });

      resetQuoteForm();
      alert('Cotización guardada y PDF generado');
    } catch (err) {
      console.error('Error completo al guardar:', err);
      alert('Error al guardar: ' + (err.message || 'Error desconocido'));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const selectedItemsCount = rows.filter((row) => row.sku).length;
  const totalUnits = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  const discountPercentFieldValue = subtotal > 0 ? effectiveDiscountPercent.toFixed(2) : '0.00';
  const discountAmountFieldValue = discountAmountApplied.toFixed(2);
  const targetTotalFieldValue = total.toFixed(2);

  const handleDiscountPercentChange = (rawValue) => {
    const nextValue = clampNumber(Number.parseFloat(rawValue), 0, 100);
    setDiscountMode('percent');
    setDiscountInput(nextValue);
  };

  const handleDiscountAmountChange = (rawValue) => {
    const nextValue = clampNumber(Number.parseFloat(rawValue), 0, Math.max(0, subtotal));
    setDiscountMode('amount');
    setDiscountInput(nextValue);
  };

  const handleTargetTotalChange = (rawValue) => {
    const nextValue = clampNumber(Number.parseFloat(rawValue), 0, Math.max(0, subtotal));
    setDiscountMode('target');
    setDiscountInput(nextValue);
  };
  const clearDiscounts = () => {
    setDiscountMode('percent');
    setDiscountInput(0);
  };

  return (
    <div className="container" style={{ paddingTop: '78px' }}>
      {draftNotice && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid #0ea5e9',
          background: 'rgba(2, 132, 199, 0.2)',
          color: '#bae6fd'
        }}>
          {draftNotice}
        </div>
      )}
      <header style={{ textAlign: 'center', marginBottom: '14px' }}>
        {currentDateTime && (
          <div style={{ color: '#9ca3af', fontSize: '1.1rem', fontWeight: '500' }}>
            {currentDateTime}
          </div>
        )}
      </header>

      <div className="quote-stepper">
        <button
          onClick={() => setStep(1)}
          className={`quote-step-btn ${step === 1 ? 'active' : ''}`}
        >
          1. Cliente
        </button>
        <button
          onClick={() => setStep(2)}
          className={`quote-step-btn ${step === 2 ? 'active' : ''}`}
        >
          2. Productos
        </button>
      </div>

      {step === 1 && (
        <div className="card quote-client-card">
          <div className="quote-client-grid">
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Cliente</label>
              <input
                type="text"
                maxLength={26}
                placeholder="Nombre (máx 26)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
              />
              <div style={{ fontSize: '0.75rem', textAlign: 'right', color: customerName.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
                {customerName.length}/26
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Teléfono</label>
              <input
                type="tel"
                maxLength={26}
                placeholder="Ej: 77778888 (máx 26)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
              />
              <div style={{ fontSize: '0.75rem', textAlign: 'right', color: customerPhone.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
                {customerPhone.length}/26
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={isProvincia} onChange={(e) => setIsProvincia(e.target.checked)} />
                Provincia (no departamento)
              </label>
            </div>

            {isProvincia ? (
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Provincia</label>
                <input
                  type="text"
                  maxLength={26}
                  placeholder="Provincia (máx 26)"
                  value={provincia}
                  onChange={(e) => setProvincia(e.target.value)}
                  style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                />
                <div style={{ fontSize: '0.75rem', textAlign: 'right', color: provincia.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
                  {provincia.length}/26
                </div>
              </div>
            ) : (
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Departamento</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '12px 36px 12px 12px',
                    fontSize: '1rem',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    background: '#0f172a',
                    color: 'white',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    backgroundSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <option value="" disabled>Departamento</option>
                  <option value="Beni">Beni</option>
                  <option value="Chuquisaca">Chuquisaca</option>
                  <option value="Cochabamba">Cochabamba</option>
                  <option value="La Paz">La Paz</option>
                  <option value="Oruro">Oruro</option>
                  <option value="Pando">Pando</option>
                  <option value="Potosí">Potosí</option>
                  <option value="Santa Cruz">Santa Cruz</option>
                  <option value="Tarija">Tarija</option>
                </select>
              </div>
            )}

            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Almacén</label>
              <select
                value={almacen}
                onChange={(e) => setAlmacen(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '12px 36px 12px 12px',
                  fontSize: '1rem',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  background: '#0f172a',
                  color: 'white',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  backgroundSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <option value="" disabled>Almacén</option>
                <option value="Cochabamba">Cochabamba</option>
                <option value="Lima">Lima</option>
                <option value="Santa Cruz">Santa Cruz</option>
              </select>
            </div>

            {requiresSellerAssignment && (
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                  Vendedor asignado (comisión)
                </label>
                <select
                  value={assignedSellerId}
                  onChange={(e) => setAssignedSellerId(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '12px 36px 12px 12px',
                    fontSize: '1rem',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    background: '#0f172a',
                    color: 'white',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    backgroundSize: '12px',
                    cursor: 'pointer'
                  }}
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

            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                Cupón marketing activo
              </label>
              <select
                value={selectedCouponCode}
                onChange={(e) => setSelectedCouponCode(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '12px 36px 12px 12px',
                  fontSize: '0.95rem',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  background: '#0f172a',
                  color: 'white',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  backgroundSize: '12px'
                }}
              >
                <option value="">Sin cupón</option>
                {coupons.map((coupon) => (
                  <option key={coupon.id} value={coupon.code}>
                    {coupon.code} ({coupon.discount_percent}% · hasta {coupon.valid_until})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                Regalo para cliente
              </label>
              <select
                value={selectedGiftLabel}
                onChange={(e) => setSelectedGiftLabel(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '12px 36px 12px 12px',
                  fontSize: '0.95rem',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  background: '#0f172a',
                  color: 'white',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  backgroundSize: '12px'
                }}
              >
                <option value="">Sin regalo</option>
                {GIFT_OPTIONS.map((giftLabel) => (
                  <option key={giftLabel} value={giftLabel}>{giftLabel}</option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={useAlternativeName} onChange={(e) => setUseAlternativeName(e.target.checked)} />
                Enviar a nombre diferente
              </label>
              {useAlternativeName && (
                <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <input
                    type="text"
                    maxLength={26}
                    placeholder="Nombre alternativo para envío"
                    value={alternativeName}
                    onChange={(e) => setAlternativeName(e.target.value)}
                    style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                  />
                  <input
                    type="tel"
                    maxLength={26}
                    placeholder="Teléfono alternativo para envío"
                    value={alternativePhone}
                    onChange={(e) => setAlternativePhone(e.target.value)}
                    style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                  />
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
              Notas de envío (opcional, máx 26)
            </label>
            <textarea
              maxLength={26}
              placeholder="Instrucciones, referencias..."
              value={shippingNotes}
              onChange={(e) => setShippingNotes(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '1rem',
                borderRadius: '8px',
                border: '1px solid #374151',
                background: '#0f172a',
                color: 'white',
                resize: 'vertical'
              }}
            />
            <div style={{ fontSize: '0.75rem', textAlign: 'right', color: shippingNotes.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
              {shippingNotes.length}/26
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            style={{
              width: '100%',
              padding: '14px',
              background: '#e11d48',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1.1rem',
              cursor: 'pointer'
            }}
          >
            Siguiente: Productos →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card quote-products-card">
          <div className="quote-products-toolbar">
            <div className="quote-sale-type-group">
              <button
                type="button"
                className={`quote-sale-type-btn ${ventaType === 'sf' ? 'active' : ''}`}
                onClick={() => setVentaType('sf')}
              >
                Sin Factura
              </button>
              <button
                type="button"
                className={`quote-sale-type-btn ${ventaType === 'cf' ? 'active' : ''}`}
                onClick={() => setVentaType('cf')}
              >
                Con Factura
              </button>
            </div>
          </div>

          <div className="quote-products-meta">
            <span>Líneas: <strong>{rows.length}</strong></span>
            <span>Productos: <strong>{selectedItemsCount}</strong></span>
            <span>Unidades: <strong>{totalUnits}</strong></span>
          </div>

          {isMobile ? (
            <div className="mobile-cards-list" style={{ marginBottom: '20px' }}>
              {rows.map((row) => {
                const stock = row.availableStock;
                const stockNumber = Number(stock);
                const stockDisplay = stock === null || stock === undefined
                  ? 'Cargando...'
                  : Number.isFinite(stockNumber) ? stockNumber : 'N/D';
                const stockColor = stock === null || stock === undefined
                  ? '#9ca3af'
                  : (Number.isFinite(stockNumber) && stockNumber > 0 ? '#10b981' : '#ef4444');

                return (
                  <div key={row.id} className="mobile-card">
                    <div className="mobile-card-header">
                      <span className="mobile-card-id">Línea #{rows.indexOf(row) + 1}</span>
                      <span className="mobile-card-total">{(row.lineTotal || 0).toFixed(2)} Bs</span>
                    </div>

                    <div className="mobile-card-body">
                      <div>
                        <label className="mobile-card-label">Producto / Combo</label>
                        <select
                          value={row.sku || ''}
                          onChange={(e) => handleProductSelect(row.id, e.target.value)}
                          className="mobile-select"
                          style={{ width: '100%', marginTop: '6px' }}
                        >
                          <option value="">Seleccionar producto / combo...</option>
                          {allItems.map((item) => (
                            <option key={item.sku} value={item.sku}>
                              {item.displayName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Cantidad</span>
                        <input
                          type="number"
                          min="1"
                          value={row.qty}
                          onChange={(e) => handleQtyChange(row.id, e.target.value)}
                          className="mobile-select"
                          style={{ width: '90px', textAlign: 'center', flex: '0 0 90px' }}
                        />
                      </div>

                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Disponibilidad</span>
                        <span style={{ color: stockColor, fontWeight: 700 }}>{stockDisplay}</span>
                      </div>

                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Precio unitario</span>
                        <span>{(row.unitPrice || 0).toFixed(2)} Bs</span>
                      </div>
                    </div>

                    <div className="mobile-card-actions">
                      <button className="btn btn-danger" onClick={() => confirmAndDeleteRow(row.id)}>
                        Eliminar línea
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                <thead>
                  <tr style={{ background: '#111827' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Producto / Combo</th>
                    <th style={{ padding: '12px', width: '80px' }}>Cant.</th>
                    <th style={{ padding: '12px', width: '80px', textAlign: 'center' }}>Disp.</th>
                    <th style={{ padding: '12px', width: '100px', textAlign: 'right' }}>Unit.</th>
                    <th style={{ padding: '12px', width: '120px', textAlign: 'right' }}>Subt.</th>
                    <th style={{ padding: '12px', width: '60px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                        Agrega líneas arriba
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const stock = row.availableStock;
                      const stockNumber = Number(stock);
                      const stockDisplay = stock === null || stock === undefined
                        ? 'Cargando...'
                        : Number.isFinite(stockNumber) ? stockNumber : 'N/D';
                      const stockColor = stock === null || stock === undefined
                        ? '#9ca3af'
                        : (Number.isFinite(stockNumber) && stockNumber > 0 ? '#10b981' : '#ef4444');

                      return (
                        <tr key={row.id} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={{ padding: '12px' }}>
                            <select
                              value={row.sku || ''}
                              onChange={(e) => handleProductSelect(row.id, e.target.value)}
                              style={{ width: '100%', padding: '10px', fontSize: '0.95rem', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                            >
                              <option value="">Seleccionar producto / combo...</option>
                              {allItems.map(item => (
                                <option key={item.sku} value={item.sku}>
                                  {item.displayName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <input
                              type="number"
                              min="1"
                              value={row.qty}
                              onChange={(e) => handleQtyChange(row.id, e.target.value)}
                              style={{ width: '100%', padding: '10px', fontSize: '0.95rem', textAlign: 'center', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                            />
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', color: stockColor, fontWeight: '600' }}>
                            {stockDisplay}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            {(row.unitPrice || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                            {(row.lineTotal || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button
                              onClick={() => confirmAndDeleteRow(row.id)}
                              style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '1.4rem', cursor: 'pointer' }}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-6px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={addRow}
              className="btn btn-secondary"
            >
              + Agregar línea
            </button>
          </div>

          {/* Summary - negotiation friendly discount controls */}
          <div className="quote-summary-panel" style={{
            position: 'sticky',
            bottom: 0,
            left: 0,
            right: 0,
            background: '#0f172a',
            padding: '16px',
            borderTop: '1px solid #374151',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.4)',
            zIndex: 10
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <small style={{ color: '#9ca3af' }}>Subtotal</small>
                <div style={{ fontSize: '1.4rem', fontWeight: '600' }}>{subtotal.toFixed(2)} Bs</div>
              </div>

              <div style={{ display: 'grid', gap: '8px', flex: '1 1 320px', minWidth: '280px' }}>
                <small style={{ color: '#9ca3af' }}>Negociación de descuento</small>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: '8px' }}>
                  <label style={{ display: 'grid', gap: '4px' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Descuento %</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={discountPercentFieldValue}
                      onChange={(e) => handleDiscountPercentChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: '#0f172a',
                        color: 'white',
                        border: `1px solid ${discountMode === 'percent' ? '#e11d48' : '#374151'}`,
                        borderRadius: '6px'
                      }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '4px' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Descuento Bs</span>
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, subtotal)}
                      step="0.01"
                      value={discountAmountFieldValue}
                      onChange={(e) => handleDiscountAmountChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: '#0f172a',
                        color: 'white',
                        border: `1px solid ${discountMode === 'amount' ? '#e11d48' : '#374151'}`,
                        borderRadius: '6px'
                      }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '4px' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Total objetivo Bs</span>
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, subtotal)}
                      step="0.01"
                      value={targetTotalFieldValue}
                      onChange={(e) => handleTargetTotalChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: '#0f172a',
                        color: 'white',
                        border: `1px solid ${discountMode === 'target' ? '#e11d48' : '#374151'}`,
                        borderRadius: '6px'
                      }}
                    />
                  </label>
                </div>
                <span style={{ color: '#e11d48', fontWeight: '600', fontSize: '0.88rem' }}>
                  Descuento aplicado: {discountAmountApplied.toFixed(2)} Bs ({effectiveDiscountPercent.toFixed(2)}%)
                </span>
                <div>
                  <button
                    type="button"
                    onClick={clearDiscounts}
                    className="btn btn-secondary"
                    style={{ minHeight: '34px', padding: '6px 12px', fontSize: '0.84rem' }}
                  >
                    Limpiar descuento
                  </button>
                </div>
              </div>

              <div>
                <small style={{ color: '#9ca3af' }}>Total negociado</small>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#e11d48' }}>
                  {total.toFixed(2)} Bs
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!canSave || isSaving}
              onClick={saveAndGeneratePDF}
              className="btn btn-primary"
              style={{
                width: '100%',
                marginTop: '16px',
                fontSize: '1.1rem',
                fontWeight: '600',
                opacity: canSave && !isSaving ? 1 : 0.6,
                cursor: canSave && !isSaving ? 'pointer' : 'not-allowed'
              }}
            >
              {isSaving ? 'Guardando...' : 'Guardar y generar PDF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}