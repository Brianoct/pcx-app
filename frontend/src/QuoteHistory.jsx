import { useState, useEffect } from 'react';
import jsPDF from 'jspdf';

function QuoteHistory({ token, role }) {
  const [quotes, setQuotes] = useState([]);
  const [filteredQuotes, setFilteredQuotes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination
  const quotesPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchQuotes = async () => {
      setLoading(true);
      try {
        const isTeamAllowed = ['Ventas Lider', 'Admin', 'Almacén Lider'].some(r => 
          role?.toLowerCase().includes(r.toLowerCase())
        );
        const url = `http://localhost:4000/api/quotes${isTeamAllowed ? '?team=true' : ''}`;

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
  }, [token, role]);

  // Apply filters
  useEffect(() => {
    let filtered = quotes;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const isLeader = ['Ventas Lider', 'Admin', 'Almacén Lider'].some(r => 
        role?.toLowerCase().includes(r.toLowerCase())
      );

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
  }, [searchTerm, statusFilter, quotes, role]);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
  };

  const updateStatus = async (quoteId, newStatus) => {
    try {
      const res = await fetch(`http://localhost:4000/api/quotes/${quoteId}/status`, {
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

      alert('Estado actualizado a: ' + newStatus);
    } catch (err) {
      alert('Error: ' + err.message);
      console.error(err);
    }
  };

  const regeneratePDF = (quote) => {
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setTextColor(244, 63, 94);
    doc.text("PCX - Cotización", 105, 18, { align: "center" });

    doc.setFontSize(11);
    doc.setTextColor(80);
    doc.text(`Vendedor: ${quote.vendor || '—'}   •   Almacén: ${quote.store_location || '—'}`, 20, 30);
    doc.text(`Fecha: ${new Date(quote.created_at).toLocaleString('es-BO')}`, 20, 37);

    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Cliente: ${quote.customer_name || '—'}`, 20, 47);
    doc.text(`Teléfono: ${quote.customer_phone || '—'}`, 20, 54);
    const location = quote.provincia ? `Provincia: ${quote.provincia}` : `Departamento: ${quote.department || '—'}`;
    doc.text(location, 20, 61);

    if (quote.shipping_notes && quote.shipping_notes.trim()) {
      doc.setFontSize(10);
      doc.text('Notas de envío:', 20, 68);
      const splitNotes = doc.splitTextToSize(quote.shipping_notes, 170);
      doc.text(splitNotes, 20, 75);
    }

    doc.setFillColor(30, 41, 59);
    doc.rect(15, 85, 180, 10, 'F');
    doc.setTextColor(255);
    doc.setFontSize(11);
    doc.text("Descripción", 22, 92);
    doc.text("Cant.", 100, 92, { align: "center" });
    doc.text("P. Unit.", 138, 92, { align: "right" });
    doc.text("Subtotal", 178, 92, { align: "right" });

    doc.setTextColor(0);
    doc.setFontSize(10);
    let y = 102;

    (quote.line_items || []).forEach(row => {
      let desc = row.skuDisplay || row.sku || '—';
      if (desc.length > 48) desc = desc.substring(0, 45) + "...";

      doc.text(desc, 22, y);
      doc.text((row.qty || 0).toString(), 100, y, { align: "center" });
      doc.text(Number(row.unitPrice || 0).toFixed(2), 138, y, { align: "right" });
      doc.text(Number(row.lineTotal || 0).toFixed(2), 178, y, { align: "right" });

      y += 10;
    });

    y += 10;
    doc.setFontSize(12);
    doc.text(`Subtotal: ${Number(quote.subtotal || 0).toFixed(2)} Bs`, 150, y, { align: "right" });
    y += 8;

    if (quote.discount_percent > 0) {
      const discAmt = Number(quote.subtotal || 0) * (quote.discount_percent / 100);
      doc.text(`Descuento (${quote.discount_percent}%): ${discAmt.toFixed(2)} Bs`, 150, y, { align: "right" });
      y += 8;
    }

    doc.setFontSize(14);
    doc.setTextColor(244, 63, 94);
    doc.text(`TOTAL: ${Number(quote.total || 0).toFixed(2)} Bs`, 150, y, { align: "right" });

    y += 22;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Cotización válida por 7 días", 105, y, { align: "center" });
    y += 7;
    doc.text("PCX - ¡Esperamos servirle nuevamente!", 105, y, { align: "center" });

    doc.save(`cotizacion_${quote.id}_${quote.customer_name?.replace(/\s+/g, '_') || 'anon'}.pdf`);
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

  const isLeader = ['Ventas Lider', 'Admin', 'Almacén Lider'].some(r => 
    role?.toLowerCase().includes(r.toLowerCase())
  );

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Historial de Cotizaciones
      </h2>

      {/* Filter Bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '24px',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <input
          type="text"
          placeholder={isLeader 
            ? "Buscar por cliente, teléfono o vendedor..." 
            : "Buscar por cliente o teléfono..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: '250px',
            padding: '12px',
            fontSize: '1rem',
            border: '1px solid #334155',
            borderRadius: '8px',
            background: '#0f172a',
            color: 'white'
          }}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '12px',
            fontSize: '1rem',
            border: '1px solid #334155',
            borderRadius: '8px',
            background: '#0f172a',
            color: 'white',
            minWidth: '160px'
          }}
        >
          <option value="">Todos los estados</option>
          <option value="Cotizado">Cotizado</option>
          <option value="Confirmado">Confirmado</option>
          <option value="Pagado">Pagado</option>
          <option value="Embalado">Embalado</option>
          <option value="Enviado">Enviado</option>
        </select>

        <button
          onClick={clearFilters}
          style={{
            padding: '12px 20px',
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.95rem'
          }}
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
                  <th style={{ padding: '14px 12px', width: '130px', textAlign: 'center' }}>Acción</th>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
    </div>
  );
}

export default QuoteHistory;