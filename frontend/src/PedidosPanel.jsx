import { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import logo from './assets/logo.png';
import { buildAccessForUser, canAccessPanel, normalizeRole } from './roleAccess';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';
import { useToast } from './ui/toastContext';

const ALERT_SOUND_PREF_KEY = 'pcx.pedidosAlertSound';
const PEDIDOS_POLL_MS = 30000;

function PedidosPanel({ token, role, access, onStatusUpdated }) {
  const toast = useToast();
  const [pedidos, setPedidos] = useState([]);
  const [filteredPedidos, setFilteredPedidos] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [prepModal, setPrepModal] = useState(null);
  const [labelCopies, setLabelCopies] = useState(1);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  // Live alert when a pedido turns Pagado: sound + toast (+ system
  // notification if the tab is in background and permission was granted).
  const [alertSoundOn, setAlertSoundOn] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(ALERT_SOUND_PREF_KEY) !== 'off' : true
  );
  const knownPagadoIdsRef = useRef(null); // null until the first load sets the baseline
  const audioCtxRef = useRef(null);
  const baseTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');

  // Pagination
  const pedidosPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const panelAccess = useMemo(() => buildAccessForUser(role, access), [role, access]);
  const { isOnline, enqueueWrite } = useOutbox();
  const canViewPedidosGlobal = canAccessPanel(panelAccess, 'pedidosGlobal');
  const normalizedRole = normalizeRole(role);
  const isAlmacenLider = normalizedRole === 'almacen lider';
  const isAdmin = normalizedRole === 'admin';
  const canFilterByWarehouse = isAlmacenLider || isAdmin;
  const canManageStatus = canAccessPanel(panelAccess, 'pedidosIndividual') || canViewPedidosGlobal;
  const vendorOptions = useMemo(() => {
    const uniqueVendors = new Set();
    for (const quote of pedidos) {
      const vendorName = String(quote?.vendor || '').trim();
      if (vendorName) uniqueVendors.add(vendorName);
    }
    return Array.from(uniqueVendors).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [pedidos]);

  const normalizePhone = (phone = '') => String(phone).replace(/\D/g, '');
  const normalizeText = (value = '') =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  const canonicalWarehouse = (value = '') => {
    const normalized = normalizeText(value);
    if (normalized.includes('santacruz') || normalized.includes('scz')) return 'Santa Cruz';
    if (normalized.includes('cochabamba') || normalized.includes('cbba')) return 'Cochabamba';
    if (normalized.includes('lima')) return 'Lima';
    return String(value || '').trim();
  };
  const fitTextByWidth = (doc, text = '', maxWidth = 0, suffix = '...') => {
    const safe = String(text || '').trim();
    if (!safe) return '—';
    if (doc.getTextWidth(safe) <= maxWidth) return safe;
    const suffixW = doc.getTextWidth(suffix);
    let out = safe;
    while (out.length > 0 && (doc.getTextWidth(out) + suffixW) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}${suffix}`;
  };
  const formatChecklistItemLabel = (item) => {
    if (item?.isGift) return String(item?.displayName || 'REGALO').trim();
    const sku = String(item?.sku || '').trim().toUpperCase();
    const rawName = String(item?.displayName || '').trim() || 'Producto desconocido';
    if (sku && /^COMBO_\d+$/i.test(sku)) return rawName;
    if (!sku) return rawName;

    // Avoid rendering duplicated SKU prefix like "SKU - SKU - Nombre".
    const duplicatePrefixPattern = new RegExp(`^${sku}\\s*-\\s*`, 'i');
    const normalizedName = rawName.replace(duplicatePrefixPattern, '').trim() || rawName;
    if (normalizedName.toUpperCase() === sku) return `${sku} - Componente`;
    return `${sku} - ${normalizedName}`;
  };
  const buildWhatsAppLink = (phone = '') => {
    const digits = normalizePhone(phone);
    if (!digits) return null;
    const withCountry = digits.startsWith('591') ? digits : `591${digits}`;
    return `https://wa.me/${withCountry}`;
  };

  useEffect(() => {
    fetchPedidos();
  }, [token, role]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Web Audio ding — no asset file, and reusing one context avoids the
  // browser's per-page context limit.
  const playAlertDing = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      [[880, 0], [1318.5, 0.18]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.65);
      });
    } catch { /* sound is best-effort */ }
  };

  const notifyNewPagados = (freshQuotes) => {
    if (alertSoundOn) playAlertDing();
    for (const quote of freshQuotes.slice(0, 3)) {
      toast.info(`🔔 Pedido pagado: ${quote.customer_name || 'Cliente'} — ${canonicalWarehouse(quote.store_location) || 'sin almacén'}`);
    }
    if (freshQuotes.length > 3) {
      toast.info(`…y ${freshQuotes.length - 3} pedidos pagados más`);
    }
    if (document.hidden) {
      document.title = `(${freshQuotes.length}) 🔔 Pedido pagado`;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('Nuevo pedido pagado', {
            body: freshQuotes.map((q) => `${q.customer_name || 'Cliente'} — ${canonicalWarehouse(q.store_location)}`).join('\n')
          });
        } catch { /* notification is best-effort */ }
      }
    }
  };

  const fetchPedidos = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const useTeamView = canViewPedidosGlobal;
      const data = await apiRequest(`/api/quotes${useTeamView ? '?team=true' : ''}`, { token });
      const filtered = data.filter((q) =>
        q.status === 'Confirmado' ||
        q.status === 'Pagado' ||
        q.status === 'Embalado' ||
        q.status === 'Enviado'
      );

      const pagadoIds = new Set(filtered.filter((q) => q.status === 'Pagado').map((q) => q.id));
      if (knownPagadoIdsRef.current) {
        const fresh = filtered.filter((q) => q.status === 'Pagado' && !knownPagadoIdsRef.current.has(q.id));
        if (fresh.length > 0) notifyNewPagados(fresh);
      }
      knownPagadoIdsRef.current = pagadoIds;

      setPedidos(filtered);
      setFilteredPedidos(filtered);
      if (!silent) setCurrentPage(1);
    } catch (err) {
      if (!silent) {
        setError(err.message);
      }
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Background poll so the warehouse hears about new pagados without
  // refreshing. Ref indirection keeps the interval on the latest closure.
  const fetchPedidosRef = useRef(fetchPedidos);
  fetchPedidosRef.current = fetchPedidos;
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchPedidosRef.current({ silent: true });
    }, PEDIDOS_POLL_MS);
    return () => clearInterval(intervalId);
  }, []);

  // Restore the tab title once the user looks at the page again.
  useEffect(() => {
    const baseTitle = baseTitleRef.current;
    const onVisible = () => {
      if (!document.hidden) document.title = baseTitle;
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.title = baseTitle;
    };
  }, []);

  const toggleAlertSound = () => {
    const next = !alertSoundOn;
    setAlertSoundOn(next);
    try { localStorage.setItem(ALERT_SOUND_PREF_KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
    if (next) {
      playAlertDing();
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  };

  // Apply filters (cliente/teléfono + vendedor + estado + almacén)
  useEffect(() => {
    let filtered = pedidos;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(q => 
        q.customer_name?.toLowerCase().includes(term) ||
        q.customer_phone?.toLowerCase().includes(term)
      );
    }

    if (vendorFilter) {
      filtered = filtered.filter((q) => String(q.vendor || '').trim() === vendorFilter);
    }

    if (statusFilter) {
      filtered = filtered.filter(q => q.status === statusFilter);
    }

    if (warehouseFilter) {
      filtered = filtered.filter((q) => canonicalWarehouse(q.store_location) === warehouseFilter);
    }

    setFilteredPedidos(filtered);
    setCurrentPage(1);
  }, [searchTerm, statusFilter, vendorFilter, warehouseFilter, pedidos]);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setVendorFilter('');
    setWarehouseFilter('');
  };

  const handleStatusChange = async (quoteId, newStatus) => {
    setUpdatingId(quoteId);
    // Don't alert over a change this same user just made.
    if (newStatus === 'Pagado' && knownPagadoIdsRef.current) {
      knownPagadoIdsRef.current.add(quoteId);
    }
    try {
      if (!isOnline) {
        const actionId = enqueueWrite({
          label: `Estado pedido #${quoteId} → ${newStatus}`,
          path: `/api/quotes/${quoteId}/status`,
          options: {
            method: 'PATCH',
            token,
            body: { status: newStatus },
            retries: 0
          }
        });
        setPedidos((prev) => prev.map((q) => (
          q.id === quoteId
            ? { ...q, status: newStatus, sync_status: 'queued', sync_action_id: actionId }
            : q
        )));
        setFilteredPedidos((prev) => prev.map((q) => (
          q.id === quoteId
            ? { ...q, status: newStatus, sync_status: 'queued', sync_action_id: actionId }
            : q
        )));
        toast.info('Sin conexión: estado en cola para sincronizar.');
        return true;
      }

      await apiRequest(`/api/quotes/${quoteId}/status`, {
        method: 'PATCH',
        token,
        body: { status: newStatus }
      });

      if (typeof onStatusUpdated === 'function') {
        onStatusUpdated();
      }
      await fetchPedidos();
      toast.success('Estado actualizado correctamente');
      return true;
    } catch (err) {
      toast.error('Error al actualizar estado: ' + err.message);
      console.error(err);
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  const normalizeChecklistItems = (items = []) => (
    (Array.isArray(items) ? items : [])
      .map((item) => ({
        ...item,
        displayName: String(item?.displayName || item?.sku || 'Producto desconocido').trim() || 'Producto desconocido',
        qty: Math.max(1, Number.parseInt(item?.qty, 10) || 1),
        sku: String(item?.sku || '').trim().toUpperCase() || null,
        isComboHeader: Boolean(item?.isComboHeader),
        isIndented: Boolean(item?.isIndented),
        isCheckable: item?.isCheckable === false ? false : true
      }))
  );

  const buildChecklistItemsFromQuote = (quote) => {
    let rawRows = quote?.line_items || [];
    if (!Array.isArray(rawRows) && typeof rawRows === 'string') {
      try {
        rawRows = JSON.parse(rawRows);
      } catch (e) {
        console.error('Error parsing line_items:', e);
        return [];
      }
    }
    if (!Array.isArray(rawRows)) return [];

    const expanded = [];
    for (const row of rawRows) {
      const rowQty = Math.max(1, Number.parseInt(row?.qty, 10) || 1);
      const rowLabel = String(row?.displayName || row?.skuDisplay || row?.sku || 'Producto desconocido').trim() || 'Producto desconocido';
      const comboItems = Array.isArray(row?.comboItems) ? row.comboItems : [];
      if (Boolean(row?.isCombo) && comboItems.length > 0) {
        expanded.push({
          displayName: rowLabel,
          qty: rowQty,
          isComboHeader: true,
          isIndented: false,
          isCheckable: false
        });
        for (const comboItem of comboItems) {
          expanded.push({
            displayName: String(comboItem?.name || comboItem?.displayName || comboItem?.sku || 'Componente').trim() || 'Componente',
            sku: comboItem?.sku,
            qty: Math.max(1, Number.parseInt(comboItem?.quantity, 10) || 1) * rowQty,
            isComboHeader: false,
            isIndented: true,
            isCheckable: true
          });
        }
        continue;
      }
      expanded.push({
        displayName: rowLabel,
        sku: row?.sku,
        qty: rowQty,
        isComboHeader: false,
        isIndented: false,
        isCheckable: true
      });
    }
    return expanded;
  };

  // Recipient/destination data shared by the printed label and the on-screen preview.
  const buildLabelData = (quote) => ({
    recipientName: (quote?.alternative_name && String(quote.alternative_name).trim())
      ? quote.alternative_name.trim()
      : (quote?.customer_name || '—'),
    recipientPhone: (quote?.alternative_phone && String(quote.alternative_phone).trim())
      ? quote.alternative_phone.trim()
      : (quote?.customer_phone || '—'),
    destination: String(quote?.provincia || quote?.department || '—').trim() || '—',
    notes: quote?.shipping_notes ? String(quote.shipping_notes).trim() : ''
  });

  const openPrep = async (quote) => {
    let checklistPayload = null;
    let items = [];
    try {
      checklistPayload = await apiRequest(`/api/quotes/${quote.id}/checklist`, { token });
      items = normalizeChecklistItems(checklistPayload?.items || []);
    } catch (err) {
      console.warn('No se pudo cargar checklist expandido, usando fallback local:', err);
      items = normalizeChecklistItems(buildChecklistItemsFromQuote(quote));
    }
    if (items.length === 0) {
      toast.error('Este pedido no tiene productos.');
      return;
    }
    const checked = items.map((item) => (item.isCheckable ? false : true));
    const promoSections = Array.isArray(checklistPayload?.promo_sections) ? checklistPayload.promo_sections : [];
    setLabelCopies(1);
    setPrepModal({
      quote,
      items,
      checked,
      promoSections,
      packed: quote.status === 'Embalado' || quote.status === 'Enviado'
    });
  };

  const toggleItem = (index) => {
    setPrepModal(prev => {
      if (!prev?.items?.[index]?.isCheckable) return prev;
      const newChecked = [...prev.checked];
      newChecked[index] = !newChecked[index];
      return { ...prev, checked: newChecked };
    });
  };

  const confirmPacking = async () => {
    const quoteId = prepModal?.quote?.id;
    if (!quoteId) return;
    const ok = await handleStatusChange(quoteId, 'Embalado');
    if (ok) {
      setPrepModal((prev) => (prev ? { ...prev, packed: true } : prev));
    }
  };

  // 70×40mm thermal label, one page per bulto with a "Bulto i/N" counter.
  const printLabel = (quote, copies = 1) => {
    const totalCopies = Math.min(Math.max(1, Number.parseInt(copies, 10) || 1), 20);
    const { recipientName, recipientPhone, destination, notes } = buildLabelData(quote);

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [70, 40] });
    const pageW = 70;
    const pageH = 40;
    const margin = 2.2;
    const contentW = pageW - margin * 2;

    for (let copy = 0; copy < totalCopies; copy++) {
      if (copy > 0) doc.addPage([70, 40], 'landscape');

      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, margin, contentW, pageH - margin * 2, 1.2, 1.2);

      // Header: logo left, order number + bulto counter right.
      doc.addImage(logo, 'PNG', margin + 2, margin + 1.6, 14.5, 5.6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.text(`PEDIDO #${quote.id}`, pageW - margin - 2, margin + 4, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.text(`Bulto ${copy + 1}/${totalCopies}`, pageW - margin - 2, margin + 6.8, { align: 'right' });

      const sepY = margin + 8.4;
      doc.setLineWidth(0.2);
      doc.line(margin + 1.5, sepY, pageW - margin - 1.5, sepY);

      // Recipient block.
      doc.setFontSize(5.8);
      doc.setTextColor(110, 110, 110);
      doc.text('D E S T I N A T A R I O', margin + 2, sepY + 3);
      doc.setTextColor(0, 0, 0);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.text(fitTextByWidth(doc, recipientName, contentW - 4), margin + 2, sepY + 7.6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.6);
      doc.text(fitTextByWidth(doc, `Cel: ${recipientPhone}`, contentW - 4), margin + 2, sepY + 11.6);

      // Destination in a high-contrast inverted bar (easy to sort at a glance).
      const barY = sepY + 13.5;
      const barH = 6.4;
      doc.setFillColor(0, 0, 0);
      doc.rect(margin + 1.5, barY, contentW - 3, barH, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text(fitTextByWidth(doc, destination.toUpperCase(), contentW - 9), pageW / 2, barY + barH / 2 + 1.4, { align: 'center' });
      doc.setTextColor(0, 0, 0);

      if (notes) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.6);
        const noteLines = doc.splitTextToSize(`Nota: ${notes}`, contentW - 4).slice(0, 2);
        noteLines.forEach((line, idx) => {
          doc.text(line, margin + 2, barY + barH + 3.2 + idx * 2.8);
        });
      }
    }

    doc.save(`etiqueta_${quote.id}_${recipientName.replace(/\s+/g, '_') || 'cliente'}.pdf`);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#78716c' }}>Cargando pedidos...</div>;
  if (error) return <div style={{ color: '#dc2626', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

  // Pagination logic
  const totalPedidos = filteredPedidos.length;
  const totalPages = Math.ceil(totalPedidos / pedidosPerPage);
  const startIndex = (currentPage - 1) * pedidosPerPage;
  const endIndex = Math.min(startIndex + pedidosPerPage, totalPedidos);
  const currentPedidos = filteredPedidos.slice(startIndex, endIndex);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const formatPedidoDate = (value) => {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '—';
    }
  };

  const actionButtons = (quote, compact = false) => (
    <div className="pedidos-action-buttons">
      <button
        type="button"
        className={`btn pedidos-action-btn pedidos-action-btn--prep ${compact ? 'is-compact' : ''}`}
        onClick={() => openPrep(quote)}
        title="Lista de empaque y etiqueta de envío"
      >
        Preparar
      </button>
    </div>
  );

  return (
    <div className="container">
      <div className="pedidos-title-row">
        <h2>Pedidos</h2>
        <button
          type="button"
          className={`pedidos-sound-toggle ${alertSoundOn ? 'is-on' : ''}`}
          onClick={toggleAlertSound}
          title="Sonido y aviso cuando un pedido pasa a Pagado"
        >
          {alertSoundOn ? '🔔 Alerta de pagados: activa' : '🔕 Alerta de pagados: apagada'}
        </button>
      </div>

      {/* Filter Bar - exact same style as QuoteHistory */}
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
          <option value="Confirmado">Confirmado</option>
          <option value="Pagado">Pagado</option>
          <option value="Embalado">Embalado</option>
          <option value="Enviado">Enviado</option>
        </select>

        {canFilterByWarehouse && (
          <select
            className="filter-select"
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
          >
            <option value="">Todos los almacenes</option>
            <option value="Santa Cruz">Santa Cruz</option>
            <option value="Cochabamba">Cochabamba</option>
            <option value="Lima">Lima</option>
          </select>
        )}

        <button
          className="btn btn-danger"
          onClick={clearFilters}
        >
          Limpiar filtros
        </button>
      </div>

      {totalPedidos === 0 ? (
        <p style={{ textAlign: 'center', color: '#78716c' }}>No hay pedidos pendientes que coincidan con la búsqueda.</p>
      ) : (
        <>
          {isMobile ? (
            <div className="mobile-cards-list" style={{ marginBottom: '16px' }}>
              {currentPedidos.map((quote) => (
                <div key={quote.id} className="mobile-card">
                  <div className="mobile-card-header">
                    <span className="mobile-card-id">Pedido #{quote.id}</span>
                    <span className="mobile-card-total">{quote.status}</span>
                  </div>

                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Vendedor</span>
                      {quote.vendor_phone ? (
                        <a
                          href={buildWhatsAppLink(quote.vendor_phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#25D366', textDecoration: 'none', fontWeight: '600' }}
                        >
                          {quote.vendor || '—'}
                        </a>
                      ) : (
                        <span>{quote.vendor || '—'}</span>
                      )}
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Cliente</span>
                      <span>{quote.customer_name || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Teléfono</span>
                      <span>{quote.customer_phone || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Ubicación</span>
                      <span>{quote.provincia || quote.department || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Almacén</span>
                      <span>{quote.store_location || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Fecha</span>
                      <span>{formatPedidoDate(quote.created_at)}</span>
                    </div>
                  </div>

                  <div className="mobile-card-actions">
                    <select
                      className="mobile-select"
                      value={quote.status}
                      onChange={(e) => handleStatusChange(quote.id, e.target.value)}
                      disabled={updatingId === quote.id}
                    >
                      {canManageStatus ? (
                        <>
                          <option value="Confirmado">Confirmado</option>
                          <option value="Pagado">Pagado</option>
                          <option value="Embalado">Embalado</option>
                          <option value="Enviado">Enviado</option>
                        </>
                      ) : (
                        <>
                          <option value="Cotizado">Cotizado</option>
                          <option value="Confirmado">Confirmado</option>
                          <option value="Pagado">Pagado</option>
                          <option value="Embalado">Embalado</option>
                          <option value="Enviado">Enviado</option>
                        </>
                      )}
                    </select>
                    {actionButtons(quote, true)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pedidos-table-wrap">
              <table className="pedidos-table">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="pedidos-th center">ID</th>
                    <th className="pedidos-th center">Vendedor</th>
                    <th className="pedidos-th center">Cliente</th>
                    <th className="pedidos-th center">Teléfono</th>
                    <th className="pedidos-th center">Provincia / Depto</th>
                    <th className="pedidos-th center">Almacén</th>
                    <th className="pedidos-th center">Estado</th>
                    <th className="pedidos-th center">Fecha</th>
                    <th className="pedidos-th center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPedidos.map(quote => (
                    <tr key={quote.id} className="pedidos-row">
                      <td className="pedidos-td center nowrap">{quote.id}</td>
                      <td className="pedidos-td center" title={quote.vendor || '—'}>
                        {quote.vendor_phone ? (
                          <a
                            href={buildWhatsAppLink(quote.vendor_phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pedidos-vendor-link"
                          >
                            <span className="pedidos-cell-truncate">{quote.vendor || '—'}</span>
                          </a>
                        ) : (
                          <span className="pedidos-cell-truncate">{quote.vendor || '—'}</span>
                        )}
                      </td>
                      <td className="pedidos-td center" title={quote.customer_name || '—'}>
                        <span className="pedidos-cell-truncate">{quote.customer_name || '—'}</span>
                      </td>
                      <td className="pedidos-td center nowrap">
                        {quote.customer_phone || '—'}
                      </td>
                      <td className="pedidos-td center" title={quote.provincia || quote.department || '—'}>
                        <span className="pedidos-cell-truncate">{quote.provincia || quote.department || '—'}</span>
                      </td>
                      <td className="pedidos-td center" title={quote.store_location || '—'}>
                        <span className="pedidos-cell-truncate">{quote.store_location || '—'}</span>
                      </td>
                      <td className="pedidos-td center">
                        <select
                          value={quote.status}
                          onChange={(e) => handleStatusChange(quote.id, e.target.value)}
                          disabled={updatingId === quote.id}
                          className="pedidos-status-select"
                          style={{
                            background: quote.status === 'Enviado' ? '#047857' :
                                        quote.status === 'Embalado' ? '#8b5cf6' :
                                        quote.status === 'Pagado' ? '#3b82f6' :
                                        quote.status === 'Confirmado' ? '#f59e0b' :
                                        '#a8a29e',
                            color: 'white',
                            cursor: updatingId === quote.id ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {canManageStatus ? (
                            <>
                              <option value="Confirmado">Confirmado</option>
                              <option value="Pagado">Pagado</option>
                              <option value="Embalado">Embalado</option>
                              <option value="Enviado">Enviado</option>
                            </>
                          ) : (
                            <>
                              <option value="Cotizado">Cotizado</option>
                              <option value="Confirmado">Confirmado</option>
                              <option value="Pagado">Pagado</option>
                              <option value="Embalado">Embalado</option>
                              <option value="Enviado">Enviado</option>
                            </>
                          )}
                        </select>
                      </td>
                      <td className="pedidos-td center nowrap">
                        {formatPedidoDate(quote.created_at)}
                      </td>
                      <td className="pedidos-td center">
                        {actionButtons(quote, false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination - exact same as QuoteHistory */}
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
                  background: currentPage === 1 ? '#e7e0d8' : '#3b82f6',
                  color: currentPage === 1 ? '#a8a29e' : 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                }}
              >
                Anterior
              </button>

              <span style={{ color: '#78716c' }}>
                Página {currentPage} de {totalPages}
              </span>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                style={{
                  padding: '10px 16px',
                  background: currentPage === totalPages ? '#e7e0d8' : '#3b82f6',
                  color: currentPage === totalPages ? '#a8a29e' : 'white',
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

      {/* Preparar pedido: lista de chequeo + etiqueta en un solo diálogo */}
      {prepModal && (() => {
        const { quote } = prepModal;
        const labelData = buildLabelData(quote);
        const checkableTotal = prepModal.items.filter((item) => item.isCheckable).length;
        const checkedCount = prepModal.items.reduce(
          (sum, item, index) => sum + (item.isCheckable && prepModal.checked[index] ? 1 : 0),
          0
        );
        const allChecked = prepModal.checked.every(Boolean);
        const busy = updatingId === quote.id;
        return (
          <div className="pedidos-prep-overlay" onClick={() => setPrepModal(null)}>
            <div className="pedidos-prep-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="pedidos-prep-head">
                <div>
                  <h3 className="pedidos-prep-title">Preparar pedido #{quote.id}</h3>
                  <div className="pedidos-prep-sub">
                    {labelData.recipientName} · {labelData.destination}
                  </div>
                </div>
                <button
                  type="button"
                  className="pedidos-prep-close"
                  onClick={() => setPrepModal(null)}
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              <div className="pedidos-prep-grid">
                {/* ── Lista de chequeo ── */}
                <section className="pedidos-prep-col">
                  <div className="pedidos-prep-col-head">
                    <span className="pedidos-prep-col-title">Lista de chequeo</span>
                    <span className={`pedidos-prep-progress ${checkedCount === checkableTotal ? 'is-done' : ''}`}>
                      {checkedCount}/{checkableTotal}
                    </span>
                  </div>

                  {Array.isArray(prepModal.promoSections) && prepModal.promoSections.length > 0 && (
                    <div className="pedidos-promos">
                      {prepModal.promoSections.map((promo, index) => {
                        const isGift = promo?.type === 'gift';
                        return (
                          <div key={`${promo.type || 'promo'}-${index}`} className={`pedidos-promo ${isGift ? 'is-gift' : 'is-coupon'}`}>
                            <div className="pedidos-promo-type">{promo?.title || (isGift ? 'Regalo' : 'Cupón')}</div>
                            <strong>{promo?.name || promo?.code || promo?.label || '—'}</strong>
                            {(promo?.sku || Number(promo?.qty || 0) > 1) && (
                              <div className="pedidos-promo-meta">
                                {promo?.sku ? `SKU: ${promo.sku}` : ''}{promo?.sku && Number(promo?.qty || 0) > 1 ? ' · ' : ''}{Number(promo?.qty || 0) > 1 ? `Cant: ${promo.qty}` : ''}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <ul className="pedidos-check-list">
                    {prepModal.items.map((item, index) => (
                      <li
                        key={index}
                        className={`pedidos-check-item ${item.isComboHeader ? 'is-combo' : ''} ${item.isIndented ? 'is-indented' : ''} ${item.isGift ? 'is-gift-item' : ''} ${prepModal.checked[index] && item.isCheckable ? 'is-checked' : ''}`}
                      >
                        {item.isCheckable ? (
                          <input
                            type="checkbox"
                            className="pedidos-check-box"
                            checked={prepModal.checked[index]}
                            onChange={() => toggleItem(index)}
                          />
                        ) : (
                          <span className="pedidos-check-combo-mark" aria-hidden="true" />
                        )}
                        <span className="pedidos-check-label">
                          <strong>{item.qty}</strong> × {formatChecklistItemLabel(item)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {prepModal.packed ? (
                    <div className="pedidos-prep-packed">✓ Empaque confirmado — pedido embalado</div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary pedidos-prep-confirm"
                      onClick={confirmPacking}
                      disabled={!allChecked || busy}
                    >
                      {busy ? 'Guardando…' : 'Confirmar empaque'}
                    </button>
                  )}
                </section>

                {/* ── Etiqueta de envío ── */}
                <section className="pedidos-prep-col">
                  <div className="pedidos-prep-col-head">
                    <span className="pedidos-prep-col-title">Etiqueta de envío</span>
                  </div>

                  <div className="pedidos-label-preview" aria-label="Vista previa de etiqueta">
                    <div className="pedidos-label-head">
                      <img src={logo} alt="PCX" className="pedidos-label-logo" />
                      <div className="pedidos-label-order">
                        <strong>PEDIDO #{quote.id}</strong>
                        <span>Bulto 1/{labelCopies}</span>
                      </div>
                    </div>
                    <div className="pedidos-label-kicker">DESTINATARIO</div>
                    <div className="pedidos-label-name">{labelData.recipientName}</div>
                    <div className="pedidos-label-phone">Cel: {labelData.recipientPhone}</div>
                    <div className="pedidos-label-dest">{labelData.destination.toUpperCase()}</div>
                    {labelData.notes && <div className="pedidos-label-notes">Nota: {labelData.notes}</div>}
                  </div>

                  <div className="pedidos-copies">
                    <span className="pedidos-copies-label">Etiquetas (bultos)</span>
                    <div className="pedidos-copies-stepper">
                      <button
                        type="button"
                        onClick={() => setLabelCopies((prev) => Math.max(1, prev - 1))}
                        aria-label="Menos etiquetas"
                      >
                        −
                      </button>
                      <span className="pedidos-copies-value">{labelCopies}</span>
                      <button
                        type="button"
                        onClick={() => setLabelCopies((prev) => Math.min(20, prev + 1))}
                        aria-label="Más etiquetas"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary pedidos-prep-print"
                    onClick={() => printLabel(quote, labelCopies)}
                  >
                    Imprimir {labelCopies === 1 ? 'etiqueta' : `${labelCopies} etiquetas`}
                  </button>
                </section>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default PedidosPanel;