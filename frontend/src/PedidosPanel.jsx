import { useState, useEffect, useMemo } from 'react';
import jsPDF from 'jspdf';
import logo from './assets/logo.png';
import { buildAccessForUser, canAccessPanel, normalizeRole } from './roleAccess';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';

function PedidosPanel({ token, role, access, onStatusUpdated }) {
  const [pedidos, setPedidos] = useState([]);
  const [filteredPedidos, setFilteredPedidos] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [checklistModal, setChecklistModal] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

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

  const fetchPedidos = async () => {
    setLoading(true);
    try {
      const useTeamView = canViewPedidosGlobal;
      const data = await apiRequest(`/api/quotes${useTeamView ? '?team=true' : ''}`, { token });
      const filtered = data.filter((q) =>
        q.status === 'Confirmado' ||
        q.status === 'Pagado' ||
        q.status === 'Embalado' ||
        q.status === 'Enviado'
      );
      
      setPedidos(filtered);
      setFilteredPedidos(filtered);
      setCurrentPage(1);
    } catch (err) {
      setError(err.message);
      console.error(err);
    } finally {
      setLoading(false);
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
        alert('Sin conexión: estado en cola para sincronizar.');
        return;
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
      alert('Estado actualizado correctamente');
    } catch (err) {
      alert('Error al actualizar estado: ' + err.message);
      console.error(err);
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

  const loadChecklistItems = async (quote) => {
    try {
      const payload = await apiRequest(`/api/quotes/${quote.id}/checklist`, { token });
      const normalized = normalizeChecklistItems(payload?.items || []);
      if (normalized.length > 0) return normalized;
    } catch (err) {
      console.warn('No se pudo cargar checklist expandido, usando fallback local:', err);
    }
    return normalizeChecklistItems(buildChecklistItemsFromQuote(quote));
  };

  const openChecklist = async (quote) => {
    const items = await loadChecklistItems(quote);
    if (items.length === 0) {
      alert('Este pedido no tiene productos.');
      return;
    }
    const checked = items.map((item) => (item.isCheckable ? false : true));
    setChecklistModal({
      quoteId: quote.id,
      items,
      checked,
      giftName: quote.customer_gift || null,
      couponCode: quote.coupon_code || null
    });
  };

  const toggleItem = (index) => {
    setChecklistModal(prev => {
      if (!prev?.items?.[index]?.isCheckable) return prev;
      const newChecked = [...prev.checked];
      newChecked[index] = !newChecked[index];
      return { ...prev, checked: newChecked };
    });
  };

  const confirmPacking = async () => {
    const { quoteId } = checklistModal;
    if (!window.confirm('¿Confirmar que todos los productos fueron empaquetados correctamente?')) return;

    await handleStatusChange(quoteId, 'Embalado');
    setChecklistModal(null);
  };

  const printLabel = (quote) => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [70, 40]
    });

    const pageWidth = 70;
    const pageHeight = 40;
    const margin = 2.5;
    const contentX = margin;
    const contentW = pageWidth - margin * 2;
    const lineH = 3.8;
    const maxCenterWidth = contentW - 3;

    const recipientName = (quote.alternative_name && String(quote.alternative_name).trim())
      ? quote.alternative_name.trim()
      : (quote.customer_name || '—');
    const recipientPhone = (quote.alternative_phone && String(quote.alternative_phone).trim())
      ? quote.alternative_phone.trim()
      : (quote.customer_phone || '—');
    const locationText = quote.provincia || quote.department || '—';
    const notesText = quote.shipping_notes ? String(quote.shipping_notes).trim() : '';

    // Border and header separator for cleaner thermal print look
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(contentX, margin, contentW, pageHeight - margin * 2);

    const logoW = 18;
    const logoH = 7;
    const logoX = (pageWidth - logoW) / 2;
    const logoY = margin + 1;
    doc.addImage(logo, 'PNG', logoX, logoY, logoW, logoH);
    const separatorY = logoY + logoH + 1.2;
    doc.line(contentX + 1.5, separatorY, contentX + contentW - 1.5, separatorY);

    let y = separatorY + 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    const namePrint = fitTextByWidth(doc, recipientName, maxCenterWidth);
    doc.text(namePrint, pageWidth / 2, y, { align: 'center' });
    y += lineH + 0.2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const phonePrint = fitTextByWidth(doc, `Cel: ${recipientPhone}`, maxCenterWidth);
    doc.text(phonePrint, pageWidth / 2, y, { align: 'center' });
    y += lineH;

    const locationPrint = fitTextByWidth(doc, locationText, maxCenterWidth);
    doc.text(locationPrint, pageWidth / 2, y, { align: 'center' });

    if (notesText) {
      y += lineH;
      doc.setFontSize(7.7);
      const noteLines = doc.splitTextToSize(`Nota: ${notesText}`, contentW - 4).slice(0, 2);
      noteLines.forEach((line, idx) => {
        const fitted = fitTextByWidth(doc, line, maxCenterWidth);
        doc.text(fitted, pageWidth / 2, y + (idx * 3.2), { align: 'center' });
      });
      y += Math.max(3.2, noteLines.length * 3.2);
    }

    doc.save(`etiqueta_${quote.id}_${recipientName.replace(/\s+/g, '_') || 'cliente'}.pdf`);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>Cargando pedidos...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

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
    <div
      className="pedidos-action-buttons"
      style={{
        gap: compact ? '8px' : '6px',
        justifyContent: 'center'
      }}
    >
      <button
        type="button"
        className="btn pedidos-action-btn empaque"
        onClick={() => openChecklist(quote)}
        title="Lista de empaque"
        style={{
          minHeight: compact ? '36px' : '34px',
          minWidth: compact ? '96px' : '84px',
          padding: compact ? '8px 12px' : '6px 10px',
          fontSize: compact ? '0.85rem' : '0.8rem',
          borderRadius: '8px',
          border: '1px solid rgba(16, 185, 129, 0.45)',
          background: 'rgba(16, 185, 129, 0.15)',
          color: '#a7f3d0',
          fontWeight: 700
        }}
      >
        Empaque
      </button>
      <button
        type="button"
        className="btn pedidos-action-btn etiqueta"
        onClick={() => printLabel(quote)}
        style={{
          minHeight: compact ? '36px' : '34px',
          minWidth: compact ? '96px' : '84px',
          padding: compact ? '8px 12px' : '6px 10px',
          fontSize: compact ? '0.85rem' : '0.8rem',
          borderRadius: '8px',
          border: '1px solid rgba(59, 130, 246, 0.45)',
          background: 'rgba(59, 130, 246, 0.15)',
          color: '#bfdbfe',
          fontWeight: 700
        }}
      >
        Etiqueta
      </button>
    </div>
  );

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Pedidos
      </h2>

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
        <p style={{ textAlign: 'center', color: '#94a3b8' }}>No hay pedidos pendientes que coincidan con la búsqueda.</p>
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
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '15%' }} />
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
                            background: quote.status === 'Enviado' ? '#10b981' :
                                        quote.status === 'Embalado' ? '#8b5cf6' :
                                        quote.status === 'Pagado' ? '#3b82f6' :
                                        quote.status === 'Confirmado' ? '#f59e0b' :
                                        '#64748b',
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

      {/* Lista de Empaque Modal */}
      {checklistModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(2, 6, 23, 0.86), rgba(15, 23, 42, 0.88))',
          backdropFilter: 'blur(2px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'radial-gradient(120% 140% at 20% 0%, rgba(30, 58, 138, 0.2), rgba(15, 23, 42, 0.95) 50%), #0f172a',
            padding: '26px',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '760px',
            maxHeight: '88vh',
            overflowY: 'auto',
            color: '#f1f5f9',
            boxShadow: '0 24px 48px rgba(2, 6, 23, 0.65)',
            border: '1px solid rgba(71, 85, 105, 0.8)'
          }}>
            <div style={{ marginBottom: '16px', textAlign: 'center' }}>
              <h3 style={{
                margin: '0 0 6px',
                color: '#f43f5e',
                fontSize: '1.75rem',
                fontWeight: '800',
                letterSpacing: '0.2px'
              }}>
                Lista de Empaque
              </h3>
              <div style={{ color: '#bfdbfe', fontSize: '0.95rem', fontWeight: 600 }}>
                Pedido #{checklistModal.quoteId}
              </div>
            </div>

            {(checklistModal.couponCode || checklistModal.giftName) && (
              <div style={{
                marginBottom: '16px',
                display: 'grid',
                gap: '8px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
              }}>
                {checklistModal.couponCode && (
                  <div style={{
                    background: 'rgba(37, 99, 235, 0.16)',
                    border: '1px solid rgba(96, 165, 250, 0.5)',
                    borderRadius: '10px',
                    padding: '10px 12px'
                  }}>
                    <div style={{ color: '#93c5fd', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                      Cupón aplicado
                    </div>
                    <strong style={{ color: '#e0f2fe', fontSize: '1rem' }}>{checklistModal.couponCode}</strong>
                  </div>
                )}
                {checklistModal.giftName && (
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.16)',
                    border: '1px solid rgba(52, 211, 153, 0.5)',
                    borderRadius: '10px',
                    padding: '10px 12px'
                  }}>
                    <div style={{ color: '#6ee7b7', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                      Regalo para cliente
                    </div>
                    <strong style={{ color: '#d1fae5', fontSize: '1rem' }}>{checklistModal.giftName}</strong>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: '24px' }}>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {checklistModal.items.map((item, index) => (
                  <li key={index} style={{
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    fontSize: item.isIndented ? '0.98rem' : '1.12rem',
                    padding: '11px 12px',
                    marginLeft: item.isIndented ? '24px' : 0,
                    background: item.isComboHeader ? 'rgba(225, 29, 72, 0.12)' : 'rgba(30, 41, 59, 0.6)',
                    borderRadius: '10px',
                    border: item.isComboHeader ? '1px solid rgba(225, 29, 72, 0.35)' : '1px solid #374151'
                  }}>
                    {item.isCheckable ? (
                      <input
                        type="checkbox"
                        checked={checklistModal.checked[index]}
                        onChange={() => toggleItem(index)}
                        style={{
                          width: '28px',
                          height: '28px',
                          accentColor: '#10b981'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: 'rgba(225, 29, 72, 0.25)',
                        border: '1px solid rgba(225, 29, 72, 0.45)'
                      }} />
                    )}
                    <span style={{ flex: 1 }}>
                      <strong>{item.qty}</strong> × {formatChecklistItemLabel(item)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              marginTop: '22px'
            }}>
              <button
                onClick={() => setChecklistModal(null)}
                style={{
                  padding: '11px 28px',
                  background: 'linear-gradient(180deg, #64748b, #475569)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '700'
                }}
              >
                Cancelar
              </button>

              <button
                onClick={confirmPacking}
                disabled={!checklistModal.checked.every(Boolean)}
                style={{
                  padding: '11px 28px',
                  background: checklistModal.checked.every(Boolean)
                    ? 'linear-gradient(180deg, #10b981, #059669)'
                    : '#4b5563',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: checklistModal.checked.every(Boolean) ? 'pointer' : 'not-allowed',
                  fontSize: '1rem',
                  fontWeight: '800'
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PedidosPanel;