import { useMemo, useState, useEffect } from 'react';
import logo from './assets/logo.png';
import { generateModernQuotePdf } from './quotePdf';
import { canAccessPanel } from './roleAccess';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function QuoteHistory({ token, access, onStatusUpdated }) {
  const [quotes, setQuotes] = useState([]);
  const [filteredQuotes, setFilteredQuotes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingQuote, setEditingQuote] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  const canViewGlobalHistory = canAccessPanel(access, 'historialGlobal');
  const canViewHistory = canAccessPanel(access, 'historialIndividual');
  const canMutateQuotes = canViewHistory || canViewGlobalHistory;

  // Pagination
  const quotesPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchQuotes = async () => {
      setLoading(true);
      try {
        const isTeamAllowed = canViewGlobalHistory;
        const url = `${API_BASE}/api/quotes${isTeamAllowed ? '?team=true' : ''}`;

        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'No se pudo cargar el historial');
        }

        const data = await res.json();

        const fixedQuotes = data.map(quote => ({
          ...quote,
          subtotal: Number(quote.subtotal) || 0,
          total: Number(quote.total) || 0,
          discount_percent: Number(quote.discount_percent) || 0,
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
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Apply filters
  useEffect(() => {
    let filtered = quotes;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const isLeader = canViewGlobalHistory;

      filtered = filtered.filter(q => 
        q.customer_name?.toLowerCase().includes(term) ||
        q.customer_phone?.toLowerCase().includes(term) ||
        (isLeader && q.vendor?.toLowerCase().includes(term))
      );
    }

    if (statusFilter) {
      filtered = filtered.filter(q => q.status === statusFilter);
    }

    setFilteredQuotes(filtered);
    setCurrentPage(1);
  }, [searchTerm, statusFilter, quotes, canViewGlobalHistory]);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
  };

  const updateStatus = async (quoteId, newStatus) => {
    try {
      const res = await fetch(`${API_BASE}/api/quotes/${quoteId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo actualizar el estado');
      }

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

  const regeneratePDF = (quote) => {
    const subtotal = Number(quote.subtotal || 0);
    const discountPercent = Number(quote.discount_percent || 0);
    const discountAmount = subtotal * (discountPercent / 100);
    const rawRows = Array.isArray(quote.line_items) ? quote.line_items : [];

    const rows = rawRows.map((row) => ({
      sku: row.sku,
      skuDisplay: row.skuDisplay || row.displayName || row.sku || '—',
      qty: Number(row.qty || 0),
      unitPrice: Number(row.unitPrice || row.unit_price || 0),
      lineTotal: Number(row.lineTotal || row.line_total || 0),
      isComboHeader: Boolean(row.isComboHeader),
      isIndented: Boolean(row.isIndented)
    }));

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
      roundTotal: Boolean(quote.round_total),
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

  const openEditModal = (quote) => {
    setEditingQuote({
      id: quote.id,
      customer_name: quote.customer_name || '',
      customer_phone: quote.customer_phone || '',
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
    });
  };

  const closeEditModal = () => {
    if (savingEdit) return;
    setEditingQuote(null);
  };

  const onEditField = (field, value) => {
    setEditingQuote((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const submitEdit = async () => {
    if (!editingQuote) return;
    if (!editingQuote.customer_name.trim() || !editingQuote.customer_phone.trim() || !editingQuote.store_location.trim()) {
      alert('Completa cliente, teléfono y almacén para guardar los cambios.');
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        customer_name: editingQuote.customer_name.trim(),
        customer_phone: editingQuote.customer_phone.trim(),
        department: editingQuote.department ? editingQuote.department.trim() : null,
        provincia: editingQuote.provincia ? editingQuote.provincia.trim() : null,
        shipping_notes: editingQuote.shipping_notes ? editingQuote.shipping_notes.trim() : null,
        alternative_name: editingQuote.alternative_name ? editingQuote.alternative_name.trim() : null,
        alternative_phone: editingQuote.alternative_phone ? editingQuote.alternative_phone.trim() : null,
        store_location: editingQuote.store_location,
        venta_type: editingQuote.venta_type || 'sf',
        discount_percent: Number(editingQuote.discount_percent || 0),
        rows: Array.isArray(editingQuote.line_items) ? editingQuote.line_items : [],
        subtotal: Number(editingQuote.subtotal || 0),
        total: Number(editingQuote.total || 0),
        status: editingQuote.status || 'Cotizado'
      };
      const res = await fetch(`${API_BASE}/api/quotes/${editingQuote.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo actualizar la cotización');
      }

      setQuotes((prev) => prev.map((quote) => (
        quote.id === editingQuote.id
          ? {
              ...quote,
              customer_name: payload.customer_name,
              customer_phone: payload.customer_phone,
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
      alert('Cotización actualizada correctamente');
    } catch (err) {
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
      const res = await fetch(`${API_BASE}/api/quotes/${quote.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo eliminar la cotización');
      }
      setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
      if (typeof onStatusUpdated === 'function') onStatusUpdated();
      alert(`Cotización #${quote.id} eliminada`);
    } catch (err) {
      alert('Error: ' + err.message);
      console.error(err);
    } finally {
      setDeletingId(null);
    }
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
          placeholder={isLeader 
            ? "Buscar por cliente, teléfono o vendedor..." 
            : "Buscar por cliente o teléfono..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

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
                      <span>{new Date(quote.created_at).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span>
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
                    <button
                      className="btn btn-secondary"
                      onClick={() => regeneratePDF(quote)}
                    >
                      Ver PDF
                    </button>
                    {canMutateQuotes && (
                      <>
                        <button
                          className="btn"
                          style={{ background: '#f59e0b', color: '#111827' }}
                          onClick={() => openEditModal(quote)}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={deletingId === quote.id}
                          onClick={() => deleteQuote(quote)}
                          style={{ opacity: deletingId === quote.id ? 0.7 : 1 }}
                        >
                          {deletingId === quote.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                minWidth: '1100px',
                tableLayout: 'fixed'
              }}>
                <thead>
                  <tr style={{ background: '#0f172a' }}>
                    <th style={{ padding: '14px 12px', width: '70px' }}>ID</th>
                    <th style={{ padding: '14px 12px', width: '220px', textAlign: 'center' }}>Cliente</th>
                    <th style={{ padding: '14px 12px', width: '160px', textAlign: 'center' }}>Teléfono (WhatsApp)</th>
                    {isLeader && <th style={{ padding: '14px 12px', width: '160px', textAlign: 'center' }}>Vendedor</th>}
                    <th style={{ padding: '14px 12px', width: '130px', textAlign: 'center' }}>Total</th>
                    <th style={{ padding: '14px 12px', width: '140px', textAlign: 'center' }}>Estado</th>
                    <th style={{ padding: '14px 12px', width: '180px', textAlign: 'center' }}>Fecha</th>
                    <th style={{ padding: '14px 12px', width: '220px', textAlign: 'center' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {currentQuotes.map(quote => (
                    <tr key={quote.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>{quote.id}</td>
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>{quote.customer_name || '—'}</td>
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                        {quote.customer_phone ? (
                          <a
                            href={`https://wa.me/${quote.customer_phone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#25D366', textDecoration: 'none', fontWeight: '500' }}
                          >
                            {quote.customer_phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      {isLeader && <td style={{ padding: '14px 12px', textAlign: 'center' }}>{quote.vendor || '—'}</td>}
                      <td style={{ padding: '14px 12px', textAlign: 'center', fontWeight: '600' }}>
                        {Number(quote.total).toFixed(2)} Bs
                      </td>
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                        <select
                          value={quote.status}
                          onChange={(e) => updateStatus(quote.id, e.target.value)}
                          style={{
                            padding: '6px 12px',
                            background: 
                              quote.status === 'Enviado' ? '#10b981' :
                              quote.status === 'Embalado' ? '#8b5cf6' :
                              quote.status === 'Pagado' ? '#3b82f6' :
                              quote.status === 'Confirmado' ? '#f59e0b' :
                              '#64748b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.9rem'
                          }}
                        >
                          <option value="Cotizado">Cotizado</option>
                          <option value="Confirmado">Confirmado</option>
                          <option value="Pagado">Pagado</option>
                          <option value="Embalado">Embalado</option>
                          <option value="Enviado">Enviado</option>
                        </select>
                      </td>
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                        {new Date(quote.created_at).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => regeneratePDF(quote)}
                            style={{
                              padding: '8px 14px',
                              background: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.9rem'
                            }}
                          >
                            Ver PDF
                          </button>
                          {canMutateQuotes && (
                            <>
                              <button
                                onClick={() => openEditModal(quote)}
                                style={{
                                  padding: '8px 14px',
                                  background: '#f59e0b',
                                  color: '#111827',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '0.9rem',
                                  fontWeight: 700
                                }}
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => deleteQuote(quote)}
                                disabled={deletingId === quote.id}
                                style={{
                                  padding: '8px 14px',
                                  background: '#ef4444',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: deletingId === quote.id ? 'not-allowed' : 'pointer',
                                  fontSize: '0.9rem',
                                  opacity: deletingId === quote.id ? 0.7 : 1
                                }}
                              >
                                {deletingId === quote.id ? 'Eliminando...' : 'Eliminar'}
                              </button>
                            </>
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
                Departamento
                <input
                  value={editingQuote.department || ''}
                  onChange={(e) => onEditField('department', e.target.value)}
                />
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
                  <option value="Cochabamba">Cochabamba</option>
                  <option value="Santa Cruz">Santa Cruz</option>
                  <option value="Lima">Lima</option>
                </select>
              </label>
              <label>
                Estado
                <select
                  value={editingQuote.status}
                  onChange={(e) => onEditField('status', e.target.value)}
                >
                  <option value="Cotizado">Cotizado</option>
                  <option value="Confirmado">Confirmado</option>
                  <option value="Pagado">Pagado</option>
                  <option value="Embalado">Embalado</option>
                  <option value="Enviado">Enviado</option>
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
                  onChange={(e) => onEditField('discount_percent', Number(e.target.value || 0))}
                />
              </label>
              <label>
                Subtotal
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingQuote.subtotal}
                  onChange={(e) => onEditField('subtotal', Number(e.target.value || 0))}
                />
              </label>
              <label>
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
              <h4>Productos (solo lectura)</h4>
              {quoteItemsSummary.length === 0 ? (
                <p style={{ color: '#94a3b8' }}>Sin líneas</p>
              ) : (
                <div className="quote-edit-lines-list">
                  {quoteItemsSummary.map((item) => (
                    <div key={item.key} className="quote-edit-line-item">
                      <span>{item.label}</span>
                      <span>x{item.qty}</span>
                      <span>{item.lineTotal.toFixed(2)} Bs</span>
                    </div>
                  ))}
                </div>
              )}
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