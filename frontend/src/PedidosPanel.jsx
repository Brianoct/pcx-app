import { useState, useEffect, useMemo } from 'react';
import jsPDF from 'jspdf';
import logo from './assets/logo.png';
import { buildAccessForUser, canAccessPanel } from './roleAccess';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function PedidosPanel({ token, role, access, onStatusUpdated }) {
  const [pedidos, setPedidos] = useState([]);
  const [filteredPedidos, setFilteredPedidos] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
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
  const canViewPedidosGlobal = canAccessPanel(panelAccess, 'pedidosGlobal');
  const canManageStatus = canAccessPanel(panelAccess, 'pedidosIndividual') || canViewPedidosGlobal;

  const normalizePhone = (phone = '') => String(phone).replace(/\D/g, '');
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
      
      const url = `${API_BASE}/api/quotes${useTeamView ? '?team=true' : ''}`;
      
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error((await res.json()).error || 'No se pudieron cargar los pedidos');
      
      const data = await res.json();
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

  // Apply filters (search + estado)
  useEffect(() => {
    let filtered = pedidos;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(q => 
        q.customer_name?.toLowerCase().includes(term) ||
        q.customer_phone?.toLowerCase().includes(term) ||
        (q.provincia || q.department || '').toLowerCase().includes(term) ||
        q.vendor?.toLowerCase().includes(term)
      );
    }

    if (statusFilter) {
      filtered = filtered.filter(q => q.status === statusFilter);
    }

    setFilteredPedidos(filtered);
    setCurrentPage(1);
  }, [searchTerm, statusFilter, pedidos]);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
  };

  const handleStatusChange = async (quoteId, newStatus) => {
    setUpdatingId(quoteId);
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

  const openChecklist = (quote) => {
    let items = quote.line_items || [];

    if (Array.isArray(items)) {
      // Already an array → use directly
    } else if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch (e) {
        console.error('Error parsing line_items:', e);
        alert('No se pudieron cargar los productos del pedido. Datos inválidos.');
        return;
      }
    } else {
      items = [];
    }

    if (items.length === 0) {
      alert('Este pedido no tiene productos.');
      return;
    }

    const checked = new Array(items.length).fill(false);
    setChecklistModal({ quoteId: quote.id, items, checked });
  };

  const toggleItem = (index) => {
    setChecklistModal(prev => {
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
          placeholder="Buscar por cliente, teléfono, provincia/departamento, vendedor o estado..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

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
                      <span>{new Date(quote.created_at).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span>
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
                    <button className="btn" style={{ background: '#10b981', color: 'white' }} onClick={() => openChecklist(quote)}>
                      Empaque
                    </button>
                    <button className="btn" style={{ background: '#f59e0b', color: 'white' }} onClick={() => printLabel(quote)}>
                      Etiqueta
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                minWidth: '900px',
                tableLayout: 'fixed'
              }}>
                <thead>
                  <tr style={{ background: '#0f172a' }}>
                    <th style={{ padding: '12px 8px', width: '60px', textAlign: 'center' }}>ID</th>
                    <th style={{ padding: '12px 8px', width: '120px', textAlign: 'center' }}>Vendedor</th>
                    <th style={{ padding: '12px 8px', width: '180px', textAlign: 'center' }}>Cliente</th>
                    <th style={{ padding: '12px 8px', width: '130px', textAlign: 'center' }}>Teléfono</th>
                    <th style={{ padding: '12px 8px', width: '160px', textAlign: 'center' }}>Provincia / Depto</th>
                    <th style={{ padding: '12px 8px', width: '160px', textAlign: 'center' }}>Almacén</th>
                    <th style={{ padding: '12px 8px', width: '120px', textAlign: 'center' }}>Estado</th>
                    <th style={{ padding: '12px 8px', width: '150px', textAlign: 'center' }}>Fecha</th>
                    <th style={{ padding: '12px 8px', width: '140px', textAlign: 'center' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPedidos.map(quote => (
                    <tr key={quote.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>{quote.id}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
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
                          quote.vendor || '—'
                        )}
                      </td>
                      <td style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word'
                      }}>
                        {quote.customer_name || '—'}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        {quote.customer_phone || '—'}
                      </td>
                      <td style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word'
                      }}>
                        {quote.provincia || quote.department || '—'}
                      </td>
                      <td style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word'
                      }}>
                        {quote.store_location || '—'}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <select
                          value={quote.status}
                          onChange={(e) => handleStatusChange(quote.id, e.target.value)}
                          disabled={updatingId === quote.id}
                          style={{
                            padding: '6px 10px',
                            background: quote.status === 'Enviado' ? '#10b981' :
                                        quote.status === 'Embalado' ? '#8b5cf6' :
                                        quote.status === 'Pagado' ? '#3b82f6' :
                                        quote.status === 'Confirmado' ? '#f59e0b' :
                                        '#64748b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: updatingId === quote.id ? 'not-allowed' : 'pointer',
                            fontSize: '0.85rem',
                            minWidth: '100px'
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
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        {new Date(quote.created_at).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => openChecklist(quote)}
                            title="Lista de Empaque"
                            style={{
                              padding: '6px 12px',
                              background: '#10b981',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '1.1rem',
                              minWidth: '40px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#059669'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}
                          >
                            ✅
                          </button>
                          <button
                            onClick={() => printLabel(quote)}
                            style={{
                              padding: '6px 12px',
                              background: '#f59e0b',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              minWidth: '90px',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#d97706'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#f59e0b'}
                          >
                            Etiqueta
                          </button>
                        </div>
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
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#1e293b',
            padding: '32px',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '700px',
            maxHeight: '85vh',
            overflowY: 'auto',
            color: '#f1f5f9',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            border: '1px solid #374151'
          }}>
            <h3 style={{
              margin: '0 0 24px',
              color: '#e11d48',
              fontSize: '1.5rem',
              fontWeight: '700',
              textAlign: 'center'
            }}>
              Lista de Empaque - Pedido #{checklistModal.quoteId}
            </h3>

            <div style={{ marginBottom: '32px' }}>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {checklistModal.items.map((item, index) => (
                  <li key={index} style={{
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    fontSize: '1.15rem',
                    padding: '12px',
                    background: 'rgba(30, 41, 59, 0.6)',
                    borderRadius: '8px',
                    border: '1px solid #374151'
                  }}>
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
                    <span style={{ flex: 1 }}>
                      <strong>{item.qty}</strong> × {item.displayName || item.sku || 'Producto desconocido'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '24px',
              marginTop: '32px'
            }}>
              <button
                onClick={() => setChecklistModal(null)}
                style={{
                  padding: '12px 32px',
                  background: '#64748b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  fontWeight: '600'
                }}
              >
                Cancelar
              </button>

              <button
                onClick={confirmPacking}
                disabled={!checklistModal.checked.every(Boolean)}
                style={{
                  padding: '12px 32px',
                  background: checklistModal.checked.every(Boolean) ? '#10b981' : '#4b5563',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: checklistModal.checked.every(Boolean) ? 'pointer' : 'not-allowed',
                  fontSize: '1.1rem',
                  fontWeight: '600'
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