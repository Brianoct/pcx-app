import { useMemo, useState, useEffect, useRef } from 'react';
import logo from './assets/logo.png';
import { generateModernQuotePdf } from './quotePdf';
import { canAccessPanel } from './roleAccess';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';
const QUOTE_STATUS_OPTIONS = ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado'];
const STORE_OPTIONS = ['Cochabamba', 'Santa Cruz', 'Lima'];
const DEPARTMENT_OPTIONS = ['Beni', 'Chuquisaca', 'Cochabamba', 'La Paz', 'Oruro', 'Pando', 'Potosí', 'Santa Cruz', 'Tarija'];
const PAYMENT_METHOD_OPTIONS = [
  { value: '', label: 'Sin definir' },
  { value: 'QR', label: 'QR' },
  { value: 'Efectivo', label: 'Efectivo' },
  { value: 'Mixto', label: 'Mixto' }
];
const PAYMENT_METHOD_QUICK_OPTIONS = PAYMENT_METHOD_OPTIONS.filter((option) => option.value);

function QuoteHistory({ token, access, onStatusUpdated }) {
  const { enqueueWrite, isWriteIntentError } = useOutbox();
  const [quotes, setQuotes] = useState([]);
  const [filteredQuotes, setFilteredQuotes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingQuote, setEditingQuote] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [openActionsMenuId, setOpenActionsMenuId] = useState(null);
  const [productCatalog, setProductCatalog] = useState([]);
  const [salesUsers, setSalesUsers] = useState([]);
  const actionsMenuRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  const canViewGlobalHistory = canAccessPanel(access, 'historialGlobal');
  const canViewHistory = canAccessPanel(access, 'historialIndividual');
  const canMutateQuotes = canViewHistory || canViewGlobalHistory;
  const availableProducts = Array.isArray(productCatalog) ? productCatalog : [];
  const getPaymentMethodColor = (paymentMethod = '') => {
    if (paymentMethod === 'QR') return '#0ea5e9';
    if (paymentMethod === 'Efectivo') return '#16a34a';
    if (paymentMethod === 'Mixto') return '#a855f7';
    return '#64748b';
  };
  const paymentMethodSelectStyle = (paymentMethod = '') => ({
    background: getPaymentMethodColor(paymentMethod),
    color: 'white',
    cursor: 'pointer'
  });
  const getProductNameBySku = (skuValue = '') => {
    const normalizedSku = String(skuValue || '').trim().toUpperCase();
    if (!normalizedSku) return '';
    const product = availableProducts.find((item) => String(item?.sku || '').trim().toUpperCase() === normalizedSku);
    return String(product?.name || '').trim();
  };

  // Pagination
  const quotesPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchQuotes = async () => {
      setLoading(true);
      try {
        const isTeamAllowed = canViewGlobalHistory;
        const url = `/api/quotes${isTeamAllowed ? '?team=true' : ''}`;
        const data = await apiRequest(url, { token });

        const fixedQuotes = data.map(quote => ({
          ...quote,
          subtotal: Number(quote.subtotal) || 0,
          total: Number(quote.total) || 0,
          discount_percent: Number(quote.discount_percent) || 0,
          payment_method: quote.payment_method === 'QR' || quote.payment_method === 'Efectivo' || quote.payment_method === 'Mixto'
            ? quote.payment_method
            : '',
          line_items: Array.isArray(quote.line_items) ? quote.line_items : []
        }));

        setQuotes(fixedQuotes);
        setFilteredQuotes(fixedQuotes);
      } catch (err) {
        setError(err.message);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchQuotes();
  }, [token, canViewGlobalHistory]);

  useEffect(() => {
    const fetchProductCatalog = async () => {
      try {
        const data = await apiRequest('/api/product-catalog', { token });
        setProductCatalog(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('No se pudo cargar catálogo de productos para edición:', err);
      }
    };
    fetchProductCatalog();
  }, [token]);

  useEffect(() => {
    const fetchSalesUsers = async () => {
      try {
        const data = await apiRequest('/api/sellers/assignable', { token });
        setSalesUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('No se pudo cargar lista de vendedores para edición:', err);
      }
    };
    fetchSalesUsers();
  }, [token]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!actionsMenuRef.current) return;
      if (!actionsMenuRef.current.contains(event.target)) {
        setOpenActionsMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Apply filters
  useEffect(() => {
    let filtered = quotes;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(q =>
        q.customer_name?.toLowerCase().includes(term) ||
        q.customer_phone?.toLowerCase().includes(term)
      );
    }

    if (vendorFilter) {
      filtered = filtered.filter((q) => (q.vendor || '') === vendorFilter);
    }

    if (statusFilter) {
      filtered = filtered.filter(q => q.status === statusFilter);
    }

    setFilteredQuotes(filtered);
    setCurrentPage(1);
  }, [searchTerm, vendorFilter, statusFilter, quotes]);

  const vendorOptions = useMemo(() => {
    const unique = Array.from(new Set(
      quotes
        .map((q) => String(q.vendor || '').trim())
        .filter(Boolean)
    ));
    unique.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return unique;
  }, [quotes]);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setVendorFilter('');
  };

  const updateStatus = async (quoteId, newStatus) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const quote = quotes.find((q) => q.id === quoteId);
      enqueueWrite({
        label: `Estado cotización #${quoteId} → ${newStatus}`,
        path: `/api/quotes/${quoteId}/status`,
        options: {
          method: 'PATCH',
          token,
          body: { status: newStatus },
          retries: 0
        },
        meta: {
          quoteId,
          customerName: quote?.customer_name || '',
          newStatus
        }
      });
      setQuotes((prev) => prev.map((q) => (
        q.id === quoteId ? { ...q, status: newStatus } : q
      )));
      if (typeof onStatusUpdated === 'function') {
        onStatusUpdated();
      }
      alert('Sin conexión: cambio guardado en cola y se enviará automáticamente.');
      return;
    }
    try {
      await apiRequest(`/api/quotes/${quoteId}/status`, {
        method: 'PATCH',
        token,
        body: { status: newStatus }
      });

      setQuotes(quotes.map(q =>
        q.id === quoteId ? { ...q, status: newStatus } : q
      ));

      if (typeof onStatusUpdated === 'function') {
        onStatusUpdated();
      }

      alert('Estado actualizado a: ' + newStatus);
    } catch (err) {
      alert('Error: ' + err.message);
      console.error(err);
    }
  };

  const updatePaymentMethod = async (quoteId, nextPaymentMethodValue) => {
    const normalizedMethod = nextPaymentMethodValue === 'QR' || nextPaymentMethodValue === 'Efectivo' || nextPaymentMethodValue === 'Mixto'
      ? nextPaymentMethodValue
      : null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const quote = quotes.find((q) => q.id === quoteId);
      enqueueWrite({
        label: `Pago cotización #${quoteId} → ${normalizedMethod || 'Sin definir'}`,
        path: `/api/quotes/${quoteId}/payment-method`,
        options: {
          method: 'PATCH',
          token,
          body: { payment_method: normalizedMethod },
          retries: 0
        },
        meta: {
          quoteId,
          customerName: quote?.customer_name || '',
          paymentMethod: normalizedMethod || ''
        }
      });
      setQuotes((prev) => prev.map((q) => (
        q.id === quoteId ? { ...q, payment_method: normalizedMethod || '' } : q
      )));
      if (typeof onStatusUpdated === 'function') {
        onStatusUpdated();
      }
      alert('Sin conexión: método de pago guardado en cola y se enviará automáticamente.');
      return;
    }
    try {
      await apiRequest(`/api/quotes/${quoteId}/payment-method`, {
        method: 'PATCH',
        token,
        body: { payment_method: normalizedMethod }
      });
      setQuotes((prev) => prev.map((q) => (
        q.id === quoteId ? { ...q, payment_method: normalizedMethod || '' } : q
      )));
      if (typeof onStatusUpdated === 'function') {
        onStatusUpdated();
      }
      alert(`Método de pago actualizado: ${normalizedMethod || 'Sin definir'}`);
    } catch (err) {
      alert('Error: ' + err.message);
      console.error(err);
    }
  };

  const formatSkuNameLabel = (skuValue, nameValue) => {
    const sku = String(skuValue || '').trim().toUpperCase();
    const name = String(nameValue || '').trim();
    if (sku && sku.startsWith('COMBO_')) return name || 'Combo';
    if (sku && name) return `${sku} - ${name}`;
    return sku || name || 'Producto';
  };

  const normalizeLabelToken = (value = '') => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const buildChecklistComboBlocks = (items = []) => {
    const blocks = [];
    let currentBlock = null;
    for (const rawItem of Array.isArray(items) ? items : []) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const isHeader = Boolean(item.isComboHeader);
      if (isHeader) {
        const headerText = formatSkuNameLabel(item.sku, item.displayName || item.sku || 'Combo');
        currentBlock = {
          header: headerText,
          headerNorm: normalizeLabelToken(headerText),
          components: []
        };
        blocks.push(currentBlock);
        continue;
      }
      if (currentBlock && Boolean(item.isIndented)) {
        currentBlock.components.push({
          sku: String(item.sku || '').trim().toUpperCase(),
          name: String(item.displayName || item.sku || 'Componente').trim(),
          absoluteQty: Number(item.qty || 0)
        });
      }
    }
    return blocks;
  };

  const isComboSku = (skuValue = '') => /^COMBO_\d+$/i.test(String(skuValue || '').trim());

  const regeneratePDF = async (quote) => {
    const subtotal = Number(quote.subtotal || 0);
    const discountPercent = Number(quote.discount_percent || 0);
    const discountAmount = subtotal * (discountPercent / 100);
    const rawRows = Array.isArray(quote.line_items) ? quote.line_items : [];
    let checklistComboBlocks = [];
    try {
      const checklistPayload = await apiRequest(`/api/quotes/${quote.id}/checklist`, { token });
      checklistComboBlocks = buildChecklistComboBlocks(checklistPayload?.items || []);
    } catch (_err) {
      checklistComboBlocks = [];
    }

    const rows = [];
    let comboBlockCursor = 0;
    for (const row of rawRows) {
      const rowSku = String(row?.sku || '').trim().toUpperCase();
      const rowIsCombo = Boolean(row?.isCombo) || isComboSku(rowSku);
      const rowDisplayName = String(
        row?.skuDisplay || row?.displayName || row?.name || rowSku || '—'
      ).trim();
      const normalized = {
        sku: rowSku,
        skuDisplay: formatSkuNameLabel(rowSku, rowDisplayName),
        qty: Number(row.qty || 0),
        unitPrice: Number(row.unitPrice || row.unit_price || 0),
        lineTotal: Number(row.lineTotal || row.line_total || 0),
        isComboHeader: Boolean(row.isComboHeader) || rowIsCombo,
        isIndented: Boolean(row.isIndented)
      };
      rows.push(normalized);

      if (rowIsCombo) {
        let effectiveComboItems = Array.isArray(row.comboItems)
          ? row.comboItems
            .map((comboItem) => ({
              sku: String(comboItem?.sku || '').trim().toUpperCase(),
              name: String(comboItem?.name || comboItem?.displayName || '').trim(),
              quantity: Number(comboItem?.quantity || 0),
              absoluteQty: null
            }))
            .filter((comboItem) => comboItem.sku && comboItem.quantity > 0)
          : [];

        // Prefer checklist expansion when available. It reflects the current
        // combo definition in DB and avoids partial legacy combo snapshots.
        if (checklistComboBlocks.length > 0) {
          const rowLabelNorm = normalizeLabelToken(formatSkuNameLabel(
            rowSku,
            rowDisplayName
          ));
          let selectedBlockIndex = checklistComboBlocks.findIndex((block, idx) => (
            idx >= comboBlockCursor
            && block?.headerNorm
            && rowLabelNorm
            && (block.headerNorm === rowLabelNorm || block.headerNorm.includes(rowLabelNorm) || rowLabelNorm.includes(block.headerNorm))
          ));
          if (selectedBlockIndex < 0) {
            selectedBlockIndex = checklistComboBlocks.findIndex((_, idx) => idx >= comboBlockCursor);
          }
          if (selectedBlockIndex >= 0) {
            comboBlockCursor = selectedBlockIndex + 1;
            const checklistComponents = (checklistComboBlocks[selectedBlockIndex]?.components || [])
              .map((component) => ({
                sku: String(component?.sku || '').trim().toUpperCase(),
                name: String(component?.name || component?.displayName || '').trim(),
                quantity: 0,
                absoluteQty: Number(component?.absoluteQty || component?.qty || 0)
              }))
              .filter((component) => component.sku && component.absoluteQty > 0);
            if (checklistComponents.length > 0) {
              effectiveComboItems = checklistComponents;
            }
          }
        }

        for (const comboItem of effectiveComboItems) {
          const componentQty = comboItem.absoluteQty > 0
            ? comboItem.absoluteQty
            : (Number(comboItem?.quantity || 0) * Number(row?.qty || 1));
          const componentSku = String(comboItem?.sku || '').trim().toUpperCase();
          const componentName = String(
            comboItem?.name
            || comboItem?.displayName
            || getProductNameBySku(componentSku)
            || ''
          ).trim();
          rows.push({
            sku: componentSku,
            skuDisplay: formatSkuNameLabel(componentSku, componentName || 'Componente'),
            qty: componentQty,
            unitPrice: 0,
            lineTotal: 0,
            isComboHeader: false,
            isIndented: true
          });
        }
      }
    }

    generateModernQuotePdf({
      logo,
      filename: `cotizacion_${quote.id}_${quote.customer_name?.replace(/\s+/g, '_') || 'anon'}.pdf`,
      quoteNumber: quote.id,
      customerName: quote.customer_name,
      customerPhone: quote.customer_phone,
      vendorName: quote.vendor,
      storeLocation: quote.store_location,
      dateText: new Date(quote.created_at).toLocaleString('es-BO'),
      sourceText: quote.store_location ? `Despacho: ${quote.store_location}` : 'Origen no especificado',
      department: quote.department,
      provincia: quote.provincia,
      shippingNotes: quote.shipping_notes,
      alternativeName: quote.alternative_name,
      alternativePhone: quote.alternative_phone,
      rows,
      subtotal,
      discountPercent,
      discountAmount,
      total: Number(quote.total || 0)
    });
  };

  const quoteItemsSummary = useMemo(() => {
    if (!editingQuote) return [];
    const rawRows = Array.isArray(editingQuote.line_items) ? editingQuote.line_items : [];
    return rawRows.map((row, index) => {
      const qty = Number(row?.qty || 0);
      const unitPrice = Number(row?.unitPrice ?? row?.unit_price ?? 0);
      const rawLineTotal = Number(row?.lineTotal ?? row?.line_total);
      const lineTotal = Number.isFinite(rawLineTotal) ? rawLineTotal : (unitPrice * qty);
      return {
        key: `${index}-${row?.sku || 'sku'}`,
        label: row?.displayName || row?.skuDisplay || row?.sku || 'Producto',
        qty,
        unitPrice,
        lineTotal
      };
    });
  }, [editingQuote]);

  const recalcEditTotals = (nextRows, nextDiscountPercent = null) => {
    const safeRows = Array.isArray(nextRows) ? nextRows : [];
    const subtotal = safeRows.reduce((sum, row) => sum + Number(row?.lineTotal || 0), 0);
    const discountPercent = Number(
      nextDiscountPercent === null ? editingQuote?.discount_percent || 0 : nextDiscountPercent
    );
    const discountAmount = subtotal * (Math.max(0, Math.min(100, discountPercent)) / 100);
    const total = Math.max(0, subtotal - discountAmount);
    return { subtotal, total };
  };

  const updateEditRows = (nextRows, nextDiscountPercent = null) => {
    const { subtotal, total } = recalcEditTotals(nextRows, nextDiscountPercent);
    setEditingQuote((prev) => (
      prev
        ? {
            ...prev,
            line_items: nextRows,
            subtotal,
            total
          }
        : prev
    ));
  };

  const createDefaultEditRow = (sku = availableProducts[0]?.sku || '', ventaType = 'sf') => {
    const product = availableProducts.find((item) => item.sku === sku) || availableProducts[0];
    const safeQty = 1;
    const safeUnit = Number(
      ventaType === 'cf'
        ? (product?.cf ?? product?.sf ?? 0)
        : (product?.sf ?? product?.cf ?? 0)
    );
    return {
      sku: product?.sku || sku,
      displayName: product?.name || sku || 'Producto',
      qty: safeQty,
      unitPrice: safeUnit,
      lineTotal: safeUnit * safeQty,
      isCombo: false,
      comboItems: []
    };
  };

  const onEditDiscountPercent = (value) => {
    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    setEditingQuote((prev) => {
      if (!prev) return prev;
      const { subtotal, total } = recalcEditTotals(prev.line_items, normalized);
      return {
        ...prev,
        discount_percent: normalized,
        subtotal,
        total
      };
    });
  };

  const updateEditRowSku = (index, skuValue) => {
    setEditingQuote((prev) => {
      if (!prev) return prev;
      const rows = Array.isArray(prev.line_items) ? [...prev.line_items] : [];
      const current = rows[index];
      if (!current) return prev;
      const product = availableProducts.find((item) => item.sku === skuValue);
      if (!product) return prev;
      const qty = Number.parseInt(current.qty, 10);
      const safeQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
      const unitPrice = Number(
        prev.venta_type === 'cf'
          ? (product.cf ?? product.sf ?? 0)
          : (product.sf ?? product.cf ?? 0)
      );
      rows[index] = {
        ...current,
        sku: product.sku,
        displayName: product.name,
        qty: safeQty,
        isCombo: false,
        comboItems: [],
        unitPrice,
        lineTotal: unitPrice * safeQty
      };
      const { subtotal, total } = recalcEditTotals(rows, prev.discount_percent);
      return {
        ...prev,
        line_items: rows,
        subtotal,
        total
      };
    });
  };

  const updateEditRowQty = (index, qtyValue) => {
    setEditingQuote((prev) => {
      if (!prev) return prev;
      const rows = Array.isArray(prev.line_items) ? [...prev.line_items] : [];
      const current = rows[index];
      if (!current) return prev;
      const parsed = Number.parseInt(qtyValue, 10);
      const qty = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
      const unitPrice = Number(current.unitPrice || 0);
      rows[index] = {
        ...current,
        qty,
        lineTotal: unitPrice * qty
      };
      const { subtotal, total } = recalcEditTotals(rows, prev.discount_percent);
      return {
        ...prev,
        line_items: rows,
        subtotal,
        total
      };
    });
  };

  const updateEditRowUnitPrice = (index, unitPriceValue) => {
    setEditingQuote((prev) => {
      if (!prev) return prev;
      const rows = Array.isArray(prev.line_items) ? [...prev.line_items] : [];
      const current = rows[index];
      if (!current) return prev;
      const parsed = Number(unitPriceValue);
      const unitPrice = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      const qty = Number.parseInt(current.qty, 10);
      const safeQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
      rows[index] = {
        ...current,
        unitPrice,
        qty: safeQty,
        lineTotal: unitPrice * safeQty
      };
      const { subtotal, total } = recalcEditTotals(rows, prev.discount_percent);
      return {
        ...prev,
        line_items: rows,
        subtotal,
        total
      };
    });
  };

  const addEditRow = () => {
    setEditingQuote((prev) => {
      if (!prev) return prev;
      const rows = Array.isArray(prev.line_items) ? [...prev.line_items] : [];
      rows.push(createDefaultEditRow(availableProducts[0]?.sku, prev.venta_type || 'sf'));
      const { subtotal, total } = recalcEditTotals(rows, prev.discount_percent);
      return {
        ...prev,
        line_items: rows,
        subtotal,
        total
      };
    });
  };

  const removeEditRow = (index) => {
    setEditingQuote((prev) => {
      if (!prev) return prev;
      const rows = Array.isArray(prev.line_items) ? [...prev.line_items] : [];
      if (rows.length <= 1) return prev;
      rows.splice(index, 1);
      const { subtotal, total } = recalcEditTotals(rows, prev.discount_percent);
      return {
        ...prev,
        line_items: rows,
        subtotal,
        total
      };
    });
  };

  const openEditModal = (quote) => {
    const quoteVendor = String(quote.vendor || '').trim().toLowerCase();
    const matchedSeller = salesUsers.find((seller) => {
      const byDisplay = String(seller.display_name || '').trim().toLowerCase();
      const byEmailUser = String(seller.email || '').split('@')[0].trim().toLowerCase();
      return quoteVendor && (quoteVendor === byDisplay || quoteVendor === byEmailUser);
    });
    const draft = {
      id: quote.id,
      customer_name: quote.customer_name || '',
      customer_phone: quote.customer_phone || '',
      vendor: quote.vendor || '',
      seller_user_id: matchedSeller ? String(matchedSeller.id) : '',
      department: quote.department || '',
      provincia: quote.provincia || '',
      shipping_notes: quote.shipping_notes || '',
      alternative_name: quote.alternative_name || '',
      alternative_phone: quote.alternative_phone || '',
      store_location: quote.store_location || '',
      venta_type: quote.venta_type || 'sf',
      discount_percent: Number(quote.discount_percent || 0),
      subtotal: Number(quote.subtotal || 0),
      total: Number(quote.total || 0),
      status: quote.status || 'Cotizado',
      line_items: Array.isArray(quote.line_items) ? quote.line_items : []
    };

    const normalizedRows = (Array.isArray(draft.line_items) ? draft.line_items : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const sku = String(row.sku || '').toUpperCase();
        const product = availableProducts.find((item) => item.sku === sku);
        const qty = Number.parseInt(row.qty, 10);
        const safeQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
        const fallbackUnit = Number(
          draft.venta_type === 'cf'
            ? (product?.cf ?? product?.sf ?? 0)
            : (product?.sf ?? product?.cf ?? 0)
        );
        const existingUnit = Number(row.unitPrice ?? row.unit_price);
        const unitPrice = Number.isFinite(existingUnit) && existingUnit >= 0 ? existingUnit : fallbackUnit;
        return {
          ...row,
          sku: product?.sku || sku,
          displayName: product?.name || row.displayName || row.skuDisplay || sku || 'Producto',
          qty: safeQty,
          unitPrice,
          lineTotal: unitPrice * safeQty,
          isCombo: false,
          comboItems: []
        };
      });

    const finalRows = normalizedRows.length > 0
      ? normalizedRows
      : [createDefaultEditRow(availableProducts[0]?.sku, draft.venta_type || 'sf')];
    const { subtotal, total } = recalcEditTotals(finalRows, draft.discount_percent);
    setEditingQuote({
      ...draft,
      line_items: finalRows,
      subtotal,
      total
    });
  };

  const closeEditModal = () => {
    if (savingEdit) return;
    setEditingQuote(null);
  };

  const onEditField = (field, value) => {
    if (field === 'discount_percent') {
      onEditDiscountPercent(value);
      return;
    }
    if (field === 'venta_type') {
      setEditingQuote((prev) => {
        if (!prev) return prev;
        const nextType = value || 'sf';
        const nextRows = (Array.isArray(prev.line_items) ? prev.line_items : []).map((row) => {
          const product = availableProducts.find((item) => item.sku === row.sku);
          const fallbackUnit = Number(
            nextType === 'cf'
              ? (product?.cf ?? product?.sf ?? 0)
              : (product?.sf ?? product?.cf ?? 0)
          );
          const qty = Number.parseInt(row.qty, 10);
          const safeQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
          return {
            ...row,
            unitPrice: fallbackUnit,
            lineTotal: fallbackUnit * safeQty
          };
        });
        const { subtotal, total } = recalcEditTotals(nextRows, prev.discount_percent);
        return {
          ...prev,
          venta_type: nextType,
          line_items: nextRows,
          subtotal,
          total
        };
      });
      return;
    }
    setEditingQuote((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const submitEdit = async () => {
    if (!editingQuote) return;
    if (!Array.isArray(productCatalog) || productCatalog.length === 0) {
      alert('Aún no se cargó el catálogo de productos. Intenta nuevamente en unos segundos.');
      return;
    }
    if (!editingQuote.customer_name.trim() || !editingQuote.customer_phone.trim() || !editingQuote.store_location.trim()) {
      alert('Completa cliente, teléfono y almacén para guardar los cambios.');
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        customer_name: editingQuote.customer_name.trim(),
        customer_phone: editingQuote.customer_phone.trim(),
        vendor: editingQuote.vendor ? editingQuote.vendor.trim() : null,
        department: editingQuote.department ? editingQuote.department.trim() : null,
        provincia: editingQuote.provincia ? editingQuote.provincia.trim() : null,
        shipping_notes: editingQuote.shipping_notes ? editingQuote.shipping_notes.trim() : null,
        alternative_name: editingQuote.alternative_name ? editingQuote.alternative_name.trim() : null,
        alternative_phone: editingQuote.alternative_phone ? editingQuote.alternative_phone.trim() : null,
        store_location: editingQuote.store_location,
        seller_user_id: editingQuote.seller_user_id ? Number(editingQuote.seller_user_id) : null,
        venta_type: editingQuote.venta_type || 'sf',
        discount_percent: Number(editingQuote.discount_percent || 0),
        rows: (Array.isArray(editingQuote.line_items) ? editingQuote.line_items : []).map((row) => ({
          sku: String(row.sku || '').toUpperCase(),
          qty: Number.parseInt(row.qty, 10) || 1,
          unitPrice: Number(row.unitPrice || 0),
          lineTotal: Number(row.lineTotal || 0),
          displayName: row.displayName || row.skuDisplay || row.sku,
          isCombo: Boolean(row.isCombo) || isComboSku(row.sku),
          comboItems: Array.isArray(row.comboItems)
            ? row.comboItems.map((comboItem) => ({
              sku: String(comboItem?.sku || '').toUpperCase(),
              quantity: Number.parseInt(comboItem?.quantity, 10) || 1
            }))
            : []
        })),
        subtotal: Number(editingQuote.subtotal || 0),
        total: Number(editingQuote.total || 0),
        status: editingQuote.status || 'Cotizado'
      };
      const editPath = `/api/quotes/${editingQuote.id}`;
      const applyLocalEdit = () => {
        setQuotes((prev) => prev.map((quote) => (
          quote.id === editingQuote.id
            ? {
                ...quote,
                customer_name: payload.customer_name,
                customer_phone: payload.customer_phone,
                vendor: payload.vendor,
                department: payload.department,
                provincia: payload.provincia,
                shipping_notes: payload.shipping_notes,
                alternative_name: payload.alternative_name,
                alternative_phone: payload.alternative_phone,
                store_location: payload.store_location,
                venta_type: payload.venta_type,
                discount_percent: payload.discount_percent,
                line_items: payload.rows,
                subtotal: payload.subtotal,
                total: payload.total,
                status: payload.status
              }
            : quote
        )));
      };

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline) {
        enqueueWrite({
          label: `Editar cotización #${editingQuote.id}`,
          path: editPath,
          options: {
            method: 'PUT',
            token,
            body: payload,
            retries: 0
          },
          meta: {
            quoteId: editingQuote.id,
            customerName: payload.customer_name
          }
        });
        applyLocalEdit();
        setEditingQuote(null);
        if (typeof onStatusUpdated === 'function') onStatusUpdated();
        alert('Sin conexión: edición guardada en cola y se sincronizará automáticamente.');
        return;
      }

      await apiRequest(editPath, {
        method: 'PUT',
        token,
        body: payload
      });

      applyLocalEdit();
      setEditingQuote(null);
      if (typeof onStatusUpdated === 'function') onStatusUpdated();
      alert('Cotización actualizada correctamente');
    } catch (err) {
      if (isWriteIntentError(err)) {
        const payload = {
          customer_name: editingQuote.customer_name.trim(),
          customer_phone: editingQuote.customer_phone.trim(),
          vendor: editingQuote.vendor ? editingQuote.vendor.trim() : null,
          department: editingQuote.department ? editingQuote.department.trim() : null,
          provincia: editingQuote.provincia ? editingQuote.provincia.trim() : null,
          shipping_notes: editingQuote.shipping_notes ? editingQuote.shipping_notes.trim() : null,
          alternative_name: editingQuote.alternative_name ? editingQuote.alternative_name.trim() : null,
          alternative_phone: editingQuote.alternative_phone ? editingQuote.alternative_phone.trim() : null,
          store_location: editingQuote.store_location,
          seller_user_id: editingQuote.seller_user_id ? Number(editingQuote.seller_user_id) : null,
          venta_type: editingQuote.venta_type || 'sf',
          discount_percent: Number(editingQuote.discount_percent || 0),
          rows: (Array.isArray(editingQuote.line_items) ? editingQuote.line_items : []).map((row) => ({
            sku: String(row.sku || '').toUpperCase(),
            qty: Number.parseInt(row.qty, 10) || 1,
            unitPrice: Number(row.unitPrice || 0),
            lineTotal: Number(row.lineTotal || 0),
            displayName: row.displayName || row.skuDisplay || row.sku,
            isCombo: Boolean(row.isCombo) || isComboSku(row.sku),
            comboItems: Array.isArray(row.comboItems)
              ? row.comboItems.map((comboItem) => ({
                sku: String(comboItem?.sku || '').toUpperCase(),
                quantity: Number.parseInt(comboItem?.quantity, 10) || 1
              }))
              : []
          })),
          subtotal: Number(editingQuote.subtotal || 0),
          total: Number(editingQuote.total || 0),
          status: editingQuote.status || 'Cotizado'
        };
        enqueueWrite({
          label: `Editar cotización #${editingQuote.id}`,
          path: `/api/quotes/${editingQuote.id}`,
          options: {
            method: 'PUT',
            token,
            body: payload,
            retries: 0
          },
          meta: {
            quoteId: editingQuote.id,
            customerName: payload.customer_name
          }
        });
        setQuotes((prev) => prev.map((quote) => (
          quote.id === editingQuote.id
            ? {
                ...quote,
                customer_name: payload.customer_name,
                customer_phone: payload.customer_phone,
                vendor: payload.vendor,
                department: payload.department,
                provincia: payload.provincia,
                shipping_notes: payload.shipping_notes,
                alternative_name: payload.alternative_name,
                alternative_phone: payload.alternative_phone,
                store_location: payload.store_location,
                venta_type: payload.venta_type,
                discount_percent: payload.discount_percent,
                line_items: payload.rows,
                subtotal: payload.subtotal,
                total: payload.total,
                status: payload.status
              }
            : quote
        )));
        setEditingQuote(null);
        if (typeof onStatusUpdated === 'function') onStatusUpdated();
        alert('Conexión inestable: edición guardada en cola y se enviará automáticamente.');
        return;
      }
      alert('Error: ' + err.message);
      console.error(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteQuote = async (quote) => {
    if (!canMutateQuotes || deletingId) return;
    const confirmDelete = window.confirm(`¿Eliminar la cotización #${quote.id}? Esta acción no se puede deshacer.`);
    if (!confirmDelete) return;
    setDeletingId(quote.id);
    try {
      const deletePath = `/api/quotes/${quote.id}`;
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline) {
        enqueueWrite({
          label: `Eliminar cotización #${quote.id}`,
          path: deletePath,
          options: {
            method: 'DELETE',
            token,
            retries: 0
          },
          meta: {
            quoteId: quote.id,
            customerName: quote.customer_name || ''
          }
        });
        setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
        if (typeof onStatusUpdated === 'function') onStatusUpdated();
        alert(`Sin conexión: eliminación #${quote.id} quedó en cola.`);
        return;
      }

      await apiRequest(`/api/quotes/${quote.id}`, {
        method: 'DELETE',
        token
      });
      setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
      if (typeof onStatusUpdated === 'function') onStatusUpdated();
      alert(`Cotización #${quote.id} eliminada`);
    } catch (err) {
      if (isWriteIntentError(err)) {
        enqueueWrite({
          label: `Eliminar cotización #${quote.id}`,
          path: `/api/quotes/${quote.id}`,
          options: {
            method: 'DELETE',
            token,
            retries: 0
          },
          meta: {
            quoteId: quote.id,
            customerName: quote.customer_name || ''
          }
        });
        setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
        if (typeof onStatusUpdated === 'function') onStatusUpdated();
        alert(`Conexión inestable: eliminación #${quote.id} quedó en cola.`);
        return;
      }
      alert('Error: ' + err.message);
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  const toggleActionsMenu = (quoteId) => {
    setOpenActionsMenuId((prev) => (prev === quoteId ? null : quoteId));
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>Cargando historial...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

  const totalQuotes = filteredQuotes.length;
  const totalPages = Math.ceil(totalQuotes / quotesPerPage);
  const startIndex = (currentPage - 1) * quotesPerPage;
  const endIndex = Math.min(startIndex + quotesPerPage, totalQuotes);
  const currentQuotes = filteredQuotes.slice(startIndex, endIndex);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const formatHistoryDate = (value) => {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '—';
    }
  };

  const isLeader = canViewGlobalHistory;

  if (!canViewHistory && !canViewGlobalHistory) {
    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center', color: '#fca5a5' }}>
          No tienes acceso al historial.
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Historial de Cotizaciones
      </h2>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          className="filter-input"
          type="text"
          placeholder="Buscar por cliente o teléfono..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select
          className="filter-select"
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
        >
          <option value="">Todos los vendedores</option>
          {vendorOptions.map((vendorName) => (
            <option key={vendorName} value={vendorName}>
              {vendorName}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="Cotizado">Cotizado</option>
          <option value="Confirmado">Confirmado</option>
          <option value="Pagado">Pagado</option>
          <option value="Embalado">Embalado</option>
          <option value="Enviado">Enviado</option>
        </select>

        <button
          className="btn btn-danger"
          onClick={clearFilters}
        >
          Limpiar filtros
        </button>
      </div>

      {totalQuotes === 0 ? (
        <p style={{ textAlign: 'center', color: '#94a3b8' }}>
          No hay cotizaciones que coincidan con los filtros.
        </p>
      ) : (
        <>
          {isMobile ? (
            <div className="mobile-cards-list">
              {currentQuotes.map((quote) => (
                <div key={quote.id} className="mobile-card">
                  <div className="mobile-card-header">
                    <span className="mobile-card-id">#{quote.id}</span>
                    <span className="mobile-card-total">{Number(quote.total).toFixed(2)} Bs</span>
                  </div>

                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Cliente</span>
                      <span>{quote.customer_name || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Teléfono</span>
                      {quote.customer_phone ? (
                        <a
                          href={`https://wa.me/${quote.customer_phone}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#25D366', textDecoration: 'none', fontWeight: '600' }}
                        >
                          {quote.customer_phone}
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                    {isLeader && (
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Vendedor</span>
                        <span>{quote.vendor || '—'}</span>
                      </div>
                    )}
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Fecha</span>
                      <span>{formatHistoryDate(quote.created_at)}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Método de pago</span>
                      <span>{quote.payment_method || 'Sin definir'}</span>
                    </div>
                  </div>

                  <div className="mobile-card-actions">
                    <select
                      className="mobile-select"
                      value={quote.status}
                      onChange={(e) => updateStatus(quote.id, e.target.value)}
                    >
                      <option value="Cotizado">Cotizado</option>
                      <option value="Confirmado">Confirmado</option>
                      <option value="Pagado">Pagado</option>
                      <option value="Embalado">Embalado</option>
                      <option value="Enviado">Enviado</option>
                    </select>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 700 }}>Pago rápido</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                        {PAYMENT_METHOD_QUICK_OPTIONS.map((option) => {
                          const isActive = (quote.payment_method || '') === option.value;
                          return (
                            <button
                              key={`${quote.id}-${option.value}`}
                              type="button"
                              className="btn"
                              onClick={() => updatePaymentMethod(quote.id, option.value)}
                              style={{
                                minHeight: '36px',
                                padding: '6px 8px',
                                border: `1px solid ${isActive ? 'rgba(255,255,255,0.35)' : '#334155'}`,
                                background: isActive ? getPaymentMethodColor(option.value) : '#0f172a',
                                color: '#e2e8f0',
                                fontSize: '0.82rem',
                                fontWeight: isActive ? 700 : 600
                              }}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => updatePaymentMethod(quote.id, '')}
                        style={{
                          minHeight: '34px',
                          background: quote.payment_method ? '#1f2937' : '#334155',
                          color: '#e2e8f0',
                          border: '1px solid #475569',
                          fontSize: '0.8rem',
                          fontWeight: 600
                        }}
                      >
                        Sin definir
                      </button>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => regeneratePDF(quote)}
                    >
                      Ver PDF
                    </button>
                    {canMutateQuotes && (
                      <div className="quote-actions-menu" ref={openActionsMenuId === quote.id ? actionsMenuRef : null}>
                        <button
                          className="quote-actions-toggle"
                          type="button"
                          onClick={() => toggleActionsMenu(quote.id)}
                        >
                          <span aria-hidden="true" style={{ fontSize: '0.95rem' }}>⋯</span>
                          <span>Más</span>
                        </button>
                        {openActionsMenuId === quote.id && (
                          <div className="quote-actions-list">
                            <button
                              type="button"
                              className="quote-actions-item quote-actions-item--edit"
                              onClick={() => {
                                setOpenActionsMenuId(null);
                                openEditModal(quote);
                              }}
                            >
                              <span aria-hidden="true">✏️</span>
                              <span>Editar</span>
                            </button>
                            <button
                              type="button"
                              className="quote-actions-item quote-actions-item--delete"
                              disabled={deletingId === quote.id}
                              onClick={() => {
                                setOpenActionsMenuId(null);
                                deleteQuote(quote);
                              }}
                            >
                              <span aria-hidden="true">{deletingId === quote.id ? '⏳' : '🗑️'}</span>
                              <span>{deletingId === quote.id ? 'Eliminando...' : 'Eliminar'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="history-table-wrap">
              <table className="history-table">
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: isLeader ? '16%' : '20%' }} />
                  <col style={{ width: isLeader ? '13%' : '15%' }} />
                  {isLeader && <col style={{ width: '12%' }} />}
                  <col style={{ width: isLeader ? '10%' : '11%' }} />
                  <col style={{ width: isLeader ? '11%' : '12%' }} />
                  <col style={{ width: isLeader ? '11%' : '12%' }} />
                  <col style={{ width: isLeader ? '11%' : '10%' }} />
                  <col style={{ width: isLeader ? '10%' : '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="history-th center">ID</th>
                    <th className="history-th center">Cliente</th>
                    <th className="history-th center">Teléfono (WhatsApp)</th>
                    {isLeader && <th className="history-th center">Vendedor</th>}
                    <th className="history-th center">Total</th>
                    <th className="history-th center">Estado</th>
                    <th className="history-th center">Pago</th>
                    <th className="history-th center">Fecha</th>
                    <th className="history-th center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {currentQuotes.map(quote => (
                    <tr key={quote.id} className="history-row">
                      <td className="history-td center nowrap">{quote.id}</td>
                      <td className="history-td center" title={quote.customer_name || '—'}>
                        <span className="history-cell-truncate">{quote.customer_name || '—'}</span>
                      </td>
                      <td className="history-td center nowrap">
                        {quote.customer_phone ? (
                          <a
                            href={`https://wa.me/${quote.customer_phone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="history-phone-link"
                          >
                            {quote.customer_phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      {isLeader && (
                        <td className="history-td center" title={quote.vendor || '—'}>
                          <span className="history-cell-truncate">{quote.vendor || '—'}</span>
                        </td>
                      )}
                      <td className="history-td center nowrap" style={{ fontWeight: '600' }}>
                        {Number(quote.total).toFixed(2)} Bs
                      </td>
                      <td className="history-td center">
                        <select
                          value={quote.status}
                          onChange={(e) => updateStatus(quote.id, e.target.value)}
                          className="history-status-select"
                          style={{
                            background: 
                              quote.status === 'Enviado' ? '#10b981' :
                              quote.status === 'Embalado' ? '#8b5cf6' :
                              quote.status === 'Pagado' ? '#3b82f6' :
                              quote.status === 'Confirmado' ? '#f59e0b' :
                              '#64748b',
                            color: 'white',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="Cotizado">Cotizado</option>
                          <option value="Confirmado">Confirmado</option>
                          <option value="Pagado">Pagado</option>
                          <option value="Embalado">Embalado</option>
                          <option value="Enviado">Enviado</option>
                        </select>
                      </td>
                      <td className="history-td center">
                        <select
                          value={quote.payment_method || ''}
                          onChange={(e) => updatePaymentMethod(quote.id, e.target.value)}
                          className="history-status-select"
                          style={paymentMethodSelectStyle(quote.payment_method || '')}
                        >
                          {PAYMENT_METHOD_OPTIONS.map((option) => (
                            <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="history-td center nowrap">
                        {formatHistoryDate(quote.created_at)}
                      </td>
                      <td className="history-td center">
                        <div className="history-actions-wrap">
                          <button
                            onClick={() => regeneratePDF(quote)}
                            className="btn history-pdf-btn"
                          >
                            Ver PDF
                          </button>
                          {canMutateQuotes && (
                            <div className="quote-actions-menu" ref={openActionsMenuId === quote.id ? actionsMenuRef : null}>
                              <button
                                className="quote-actions-toggle"
                                type="button"
                                onClick={() => toggleActionsMenu(quote.id)}
                              >
                                <span aria-hidden="true" style={{ fontSize: '0.95rem' }}>⋯</span>
                                <span>Más</span>
                              </button>
                              {openActionsMenuId === quote.id && (
                                <div className="quote-actions-list">
                                  <button
                                    type="button"
                                    className="quote-actions-item quote-actions-item--edit"
                                    onClick={() => {
                                      setOpenActionsMenuId(null);
                                      openEditModal(quote);
                                    }}
                                  >
                                    <span aria-hidden="true">✏️</span>
                                    <span>Editar</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="quote-actions-item quote-actions-item--delete"
                                    disabled={deletingId === quote.id}
                                    onClick={() => {
                                      setOpenActionsMenuId(null);
                                      deleteQuote(quote);
                                    }}
                                  >
                                    <span aria-hidden="true">{deletingId === quote.id ? '⏳' : '🗑️'}</span>
                                    <span>{deletingId === quote.id ? 'Eliminando...' : 'Eliminar'}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '16px',
              marginTop: '24px',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                style={{
                  padding: '10px 16px',
                  background: currentPage === 1 ? '#334155' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                }}
              >
                Anterior
              </button>

              <span style={{ color: '#94a3b8' }}>
                Página {currentPage} de {totalPages}
              </span>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                style={{
                  padding: '10px 16px',
                  background: currentPage === totalPages ? '#334155' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                }}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
      {editingQuote && (
        <div className="quote-edit-overlay" onClick={closeEditModal}>
          <div className="quote-edit-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '12px' }}>Editar cotización #{editingQuote.id}</h3>
            <div className="quote-edit-grid">
              <label>
                Cliente
                <input
                  value={editingQuote.customer_name}
                  onChange={(e) => onEditField('customer_name', e.target.value)}
                />
              </label>
              <label>
                Teléfono
                <input
                  value={editingQuote.customer_phone}
                  onChange={(e) => onEditField('customer_phone', e.target.value)}
                />
              </label>
              <label>
                Vendedor asignado
                <select
                  value={editingQuote.seller_user_id || ''}
                  onChange={(e) => {
                    const sellerId = e.target.value;
                    const seller = salesUsers.find((s) => String(s.id) === String(sellerId));
                    onEditField('seller_user_id', sellerId);
                    onEditField(
                      'vendor',
                      seller
                        ? (seller.display_name || String(seller.email || '').split('@')[0] || '')
                        : ''
                    );
                  }}
                >
                  <option value="">Seleccionar vendedor</option>
                  {salesUsers.map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {(seller.display_name || String(seller.email || '').split('@')[0] || 'Vendedor')} ({seller.role})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Departamento
                <select
                  value={editingQuote.department || ''}
                  onChange={(e) => onEditField('department', e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  {DEPARTMENT_OPTIONS.map((dep) => (
                    <option key={dep} value={dep}>{dep}</option>
                  ))}
                </select>
              </label>
              <label>
                Provincia
                <input
                  value={editingQuote.provincia || ''}
                  onChange={(e) => onEditField('provincia', e.target.value)}
                />
              </label>
              <label>
                Almacén
                <select
                  value={editingQuote.store_location}
                  onChange={(e) => onEditField('store_location', e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  {STORE_OPTIONS.map((store) => (
                    <option key={store} value={store}>{store}</option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select
                  value={editingQuote.status}
                  onChange={(e) => onEditField('status', e.target.value)}
                >
                  {QUOTE_STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de venta
                <select
                  value={editingQuote.venta_type || 'sf'}
                  onChange={(e) => onEditField('venta_type', e.target.value)}
                >
                  <option value="sf">Sin Factura</option>
                  <option value="cf">Con Factura</option>
                </select>
              </label>
              <label>
                Descuento %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editingQuote.discount_percent}
                  onChange={(e) => onEditField('discount_percent', e.target.value)}
                />
              </label>
              <label style={{ display: 'none' }}>
                Subtotal
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingQuote.subtotal}
                  onChange={(e) => onEditField('subtotal', Number(e.target.value || 0))}
                />
              </label>
              <label style={{ display: 'none' }}>
                Total
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingQuote.total}
                  onChange={(e) => onEditField('total', Number(e.target.value || 0))}
                />
              </label>
              <label>
                Nombre alternativo
                <input
                  value={editingQuote.alternative_name || ''}
                  onChange={(e) => onEditField('alternative_name', e.target.value)}
                />
              </label>
              <label>
                Teléfono alternativo
                <input
                  value={editingQuote.alternative_phone || ''}
                  onChange={(e) => onEditField('alternative_phone', e.target.value)}
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Notas de envío
                <textarea
                  rows={2}
                  value={editingQuote.shipping_notes || ''}
                  onChange={(e) => onEditField('shipping_notes', e.target.value)}
                />
              </label>
            </div>

            <div className="quote-edit-lines">
              <div className="quote-edit-line-editor">
                <div className="quote-edit-line-editor-header">
                  <h4>Productos</h4>
                  <button type="button" className="btn btn-secondary" onClick={addEditRow}>
                    + Agregar línea
                  </button>
                </div>

                <div className="quote-edit-line-table-wrap">
                  <table className="quote-edit-line-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th style={{ width: '92px' }}>Cant.</th>
                        <th style={{ width: '130px' }}>Unitario</th>
                        <th style={{ width: '130px' }}>Subtotal</th>
                        <th style={{ width: '78px' }}>Quitar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(editingQuote.line_items) ? editingQuote.line_items : []).map((row, index) => (
                        <tr key={`${row.sku || 'sku'}-${index}`}>
                          <td data-label="Producto">
                            <select
                              value={row.sku || ''}
                              onChange={(e) => updateEditRowSku(index, e.target.value)}
                            >
                              {productCatalog.map((item) => (
                                <option key={item.sku} value={item.sku}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td data-label="Cantidad">
                            <input
                              type="number"
                              min="1"
                              value={row.qty}
                              onChange={(e) => updateEditRowQty(index, e.target.value)}
                            />
                          </td>
                          <td data-label="Unitario (Bs)">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={Number(row.unitPrice || 0)}
                              onChange={(e) => updateEditRowUnitPrice(index, e.target.value)}
                            />
                          </td>
                          <td data-label="Subtotal (Bs)">
                            <strong>{Number(row.lineTotal || 0).toFixed(2)}</strong>
                          </td>
                          <td data-label="Quitar">
                            <button
                              type="button"
                              className="quote-edit-line-remove-btn"
                              onClick={() => removeEditRow(index)}
                              disabled={(editingQuote.line_items || []).length <= 1}
                            >
                              X
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '10px', color: '#cbd5e1', display: 'flex', justifyContent: 'flex-end', gap: '16px', fontWeight: 600 }}>
              <span>Subtotal: {Number(editingQuote.subtotal || 0).toFixed(2)} Bs</span>
              <span>Total: {Number(editingQuote.total || 0).toFixed(2)} Bs</span>
            </div>

            <div className="quote-edit-actions">
              <button className="btn" onClick={closeEditModal} disabled={savingEdit}>Cancelar</button>
              <button className="btn btn-primary" onClick={submitEdit} disabled={savingEdit}>
                {savingEdit ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default QuoteHistory;