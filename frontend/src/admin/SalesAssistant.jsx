import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../apiClient';

const STORE_OPTIONS = ['Cochabamba', 'Santa Cruz', 'Lima'];
const VENTA_TYPE_OPTIONS = [
  { value: 'SF', label: 'SF (sin factura)' },
  { value: 'CF', label: 'CF (con factura)' }
];

const money = (n) => `Bs ${Number(n || 0).toFixed(2)}`;

function SalesAssistant({ token, user }) {
  const [conversations, setConversations] = useState([]);
  const [salesUsers, setSalesUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState('');

  // AI suggestion state
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  // Reply composer
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  // Quote draft
  const [quoteRows, setQuoteRows] = useState([]);
  const [storeLocation, setStoreLocation] = useState(STORE_OPTIONS[0]);
  const [ventaType, setVentaType] = useState('SF');
  const [sellerUserId, setSellerUserId] = useState('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [quoteResult, setQuoteResult] = useState(null);

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const res = await apiRequest(`/api/whatsapp/inbox/conversations?limit=80&search=${encodeURIComponent(search)}`, { token });
      setConversations(Array.isArray(res?.conversations) ? res.conversations : []);
      setSalesUsers(Array.isArray(res?.sales_users) ? res.sales_users : []);
    } catch (err) {
      setError(err?.message || 'No se pudieron cargar las conversaciones.');
    } finally {
      setLoadingList(false);
    }
  }, [token, search]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const openConversation = async (id) => {
    setSelectedId(id);
    setSuggestion(null);
    setReply('');
    setQuoteRows([]);
    setQuoteResult(null);
    setLoadingThread(true);
    setError('');
    try {
      const res = await apiRequest(`/api/whatsapp/inbox/conversations/${id}/messages`, { token });
      setConversation(res?.conversation || null);
      setMessages(Array.isArray(res?.messages) ? res.messages : []);
      const assigned = res?.conversation?.assigned_user_id;
      setSellerUserId(assigned ? String(assigned) : '');
    } catch (err) {
      setError(err?.message || 'No se pudo abrir la conversación.');
    } finally {
      setLoadingThread(false);
    }
  };

  const generateSuggestion = async () => {
    if (!selectedId) return;
    setSuggesting(true);
    setError('');
    try {
      const res = await apiRequest('/api/ai/sales/suggest', {
        method: 'POST',
        token,
        body: { conversation_id: selectedId },
        timeoutMs: 45000,
        retries: 0
      });
      setSuggestion(res);
      setReply(res?.reply_draft || '');
      setQuoteRows(Array.isArray(res?.quote_draft?.rows) ? res.quote_draft.rows : []);
    } catch (err) {
      setError(err?.message || 'No se pudo generar la sugerencia.');
    } finally {
      setSuggesting(false);
    }
  };

  const sendReply = async () => {
    const text = reply.trim();
    if (!selectedId || !text) return;
    if (!window.confirm('¿Enviar esta respuesta al cliente por WhatsApp?')) return;
    setSending(true);
    setError('');
    try {
      await apiRequest(`/api/whatsapp/inbox/conversations/${selectedId}/messages`, {
        method: 'POST',
        token,
        body: { type: 'text', text }
      });
      setReply('');
      await openConversation(selectedId);
    } catch (err) {
      setError(err?.message || 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const addSuggestedToQuote = (product) => {
    setQuoteRows((prev) => {
      if (prev.some((r) => r.sku === product.sku)) return prev;
      const unitPrice = ventaType === 'CF' ? Number(product.cf || product.sf || 0) : Number(product.sf || 0);
      return [...prev, {
        sku: product.sku,
        displayName: product.name,
        qty: 1,
        unitPrice,
        lineTotal: unitPrice,
        isCombo: false
      }];
    });
  };

  const updateRow = (index, patch) => {
    setQuoteRows((prev) => prev.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      const qty = Math.max(1, Number.parseInt(next.qty, 10) || 1);
      const unitPrice = Math.max(0, Number(next.unitPrice) || 0);
      return { ...next, qty, unitPrice, lineTotal: Number((qty * unitPrice).toFixed(2)) };
    }));
  };

  const removeRow = (index) => setQuoteRows((prev) => prev.filter((_, i) => i !== index));

  const subtotal = quoteRows.reduce((sum, r) => sum + Number(r.lineTotal || 0), 0);

  const createQuote = async () => {
    if (!conversation) return;
    if (quoteRows.length === 0) {
      setError('Agrega al menos un producto a la cotización.');
      return;
    }
    if (!sellerUserId) {
      setError('Selecciona el vendedor responsable de la cotización.');
      return;
    }
    const seller = salesUsers.find((u) => String(u.id) === String(sellerUserId));
    const vendor = seller?.name || seller?.email || user?.display_name || 'Asesor';
    const customerName = (conversation.contact_name || '').trim() || 'Cliente WhatsApp';
    const customerPhone = (conversation.contact_phone || '').trim();
    if (!window.confirm(`¿Crear cotización para ${customerName} por ${money(subtotal)}?`)) return;

    setCreatingQuote(true);
    setError('');
    setQuoteResult(null);
    try {
      const res = await apiRequest('/api/quotes', {
        method: 'POST',
        token,
        body: {
          customer_name: customerName,
          customer_phone: customerPhone,
          store_location: storeLocation,
          venta_type: ventaType,
          vendor,
          seller_user_id: Number(sellerUserId),
          rows: quoteRows.map((r) => ({
            sku: r.sku,
            qty: r.qty,
            unitPrice: r.unitPrice,
            displayName: r.displayName,
            isCombo: false,
            lineTotal: r.lineTotal
          })),
          subtotal: Number(subtotal.toFixed(2)),
          total: Number(subtotal.toFixed(2)),
          status: 'Cotizado'
        }
      });
      setQuoteResult({ id: res?.id });
    } catch (err) {
      setError(err?.message || 'No se pudo crear la cotización.');
    } finally {
      setCreatingQuote(false);
    }
  };

  return (
    <div className="sales-ia">
      <div className="admin-ai-result-head">
        <h3 style={{ margin: 0 }}>Ventas IA (beta privada)</h3>
        <span>Atiende el inbox de WhatsApp con borradores de IA. Tú confirmas antes de enviar o cotizar.</span>
      </div>

      {error && <div className="admin-ai-error">{error}</div>}

      <div className="sales-ia-grid">
        {/* Column 1: conversations */}
        <div className="sales-ia-col sales-ia-list">
          <div className="sales-ia-search">
            <input
              type="text"
              value={search}
              placeholder="Buscar conversación…"
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="admin-ai-pill" onClick={loadConversations} disabled={loadingList}>
              {loadingList ? '…' : 'Actualizar'}
            </button>
          </div>
          <div className="sales-ia-conv-scroll">
            {conversations.length === 0 && !loadingList && (
              <p className="sales-ia-muted">Sin conversaciones.</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`sales-ia-conv ${selectedId === c.id ? 'active' : ''}`}
                onClick={() => openConversation(c.id)}
              >
                <strong>{c.contact_name || c.contact_phone || `Conv ${c.id}`}</strong>
                <small>{c.last_message_preview || '—'}</small>
                <span className="sales-ia-conv-meta">
                  {c.pipeline_stage || 'new'}
                  {c.unread_count > 0 ? ` · ${c.unread_count} sin leer` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Column 2: thread + composer */}
        <div className="sales-ia-col sales-ia-thread">
          {!selectedId && <p className="sales-ia-muted">Selecciona una conversación para empezar.</p>}
          {selectedId && (
            <>
              <div className="sales-ia-thread-head">
                <strong>{conversation?.contact_name || conversation?.contact_phone || `Conversación ${selectedId}`}</strong>
                <button type="button" className="admin-ai-pill" onClick={generateSuggestion} disabled={suggesting || loadingThread}>
                  {suggesting ? 'Generando…' : 'Generar sugerencias IA'}
                </button>
              </div>
              <div className="sales-ia-messages">
                {loadingThread && <p className="sales-ia-muted">Cargando…</p>}
                {!loadingThread && messages.length === 0 && <p className="sales-ia-muted">Sin mensajes.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`sales-ia-bubble ${m.direction === 'inbound' ? 'in' : 'out'}`}>
                    {m.text_body || `[${m.message_type || 'mensaje'}]`}
                  </div>
                ))}
              </div>
              <div className="sales-ia-composer">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Escribe o usa el borrador de IA…"
                  disabled={sending}
                />
                <button type="button" className="btn" onClick={sendReply} disabled={sending || !reply.trim()}>
                  {sending ? 'Enviando…' : 'Enviar respuesta'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Column 3: AI panel */}
        <div className="sales-ia-col sales-ia-panel">
          {!suggestion && <p className="sales-ia-muted">Genera sugerencias para ver borrador, productos y cotización.</p>}
          {suggestion && (
            <>
              {suggestion.provider === 'fallback' && (
                <div className="admin-ai-error" style={{ color: '#92400e', background: 'rgba(251, 191, 36, 0.14)', borderColor: 'rgba(251, 191, 36, 0.5)' }}>
                  Sin IA generativa: sugerencias por palabras clave. Configura <strong>GROK_API_KEY</strong> para respuestas redactadas.
                </div>
              )}

              <div className="sales-ia-section">
                <h4>Borrador de respuesta</h4>
                <p className="sales-ia-draft">{suggestion.reply_draft || '—'}</p>
                <button type="button" className="admin-ai-pill" onClick={() => setReply(suggestion.reply_draft || '')}>
                  Usar como respuesta
                </button>
              </div>

              <div className="sales-ia-section">
                <h4>Productos sugeridos</h4>
                {(!suggestion.suggested_products || suggestion.suggested_products.length === 0) && (
                  <p className="sales-ia-muted">Sin sugerencias.</p>
                )}
                {(suggestion.suggested_products || []).map((p) => (
                  <div key={p.sku} className="sales-ia-product">
                    <div>
                      <strong>{p.name}</strong>
                      <small>{p.sku} · SF {money(p.sf)}{p.cf ? ` · CF ${money(p.cf)}` : ''}</small>
                      {p.reason && <em>{p.reason}</em>}
                    </div>
                    <button type="button" className="admin-ai-pill" onClick={() => addSuggestedToQuote(p)}>Agregar</button>
                  </div>
                ))}
              </div>

              <div className="sales-ia-section">
                <h4>Borrador de cotización</h4>
                {quoteRows.length === 0 && <p className="sales-ia-muted">Agrega productos para cotizar.</p>}
                {quoteRows.length > 0 && (
                  <div className="admin-ai-table-wrap">
                    <table className="admin-ai-table">
                      <thead>
                        <tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th><th></th></tr>
                      </thead>
                      <tbody>
                        {quoteRows.map((r, i) => (
                          <tr key={r.sku}>
                            <td>{r.displayName}<br /><small>{r.sku}</small></td>
                            <td>
                              <input type="number" min="1" value={r.qty} style={{ width: '56px' }}
                                onChange={(e) => updateRow(i, { qty: e.target.value })} />
                            </td>
                            <td>
                              <input type="number" min="0" step="0.01" value={r.unitPrice} style={{ width: '80px' }}
                                onChange={(e) => updateRow(i, { unitPrice: e.target.value })} />
                            </td>
                            <td>{money(r.lineTotal)}</td>
                            <td><button type="button" className="sales-ia-remove" onClick={() => removeRow(i)}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="sales-ia-quote-meta">
                  <label>Almacén
                    <select value={storeLocation} onChange={(e) => setStoreLocation(e.target.value)}>
                      {STORE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label>Tipo
                    <select value={ventaType} onChange={(e) => setVentaType(e.target.value)}>
                      {VENTA_TYPE_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </label>
                  <label>Vendedor
                    <select value={sellerUserId} onChange={(e) => setSellerUserId(e.target.value)}>
                      <option value="">Selecciona…</option>
                      {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </select>
                  </label>
                </div>

                <div className="sales-ia-quote-foot">
                  <strong>Total: {money(subtotal)}</strong>
                  <button type="button" className="btn" onClick={createQuote} disabled={creatingQuote || quoteRows.length === 0}>
                    {creatingQuote ? 'Creando…' : 'Crear cotización'}
                  </button>
                </div>

                {quoteResult?.id && (
                  <div className="sales-ia-ok">Cotización #{quoteResult.id} creada correctamente.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SalesAssistant;
