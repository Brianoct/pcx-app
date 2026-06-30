import { useState, useEffect, useCallback, useRef } from 'react';
import { apiRequest, API_BASE } from '../apiClient';
import { generateModernQuotePdf } from '../quotePdf';

const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

// Outbound messages store raw_payload as { request, response }; inbound store
// the webhook object directly.
const normalizeMessagePayload = (message = {}) => {
  const rawPayload = message?.raw_payload;
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  if (message.direction === 'outbound' && rawPayload.request && typeof rawPayload.request === 'object') {
    return rawPayload.request;
  }
  return rawPayload;
};

// Renders a clickable link (or image) for a media/document message. The media
// content endpoint needs the bearer token, so we fetch it and build a blob URL.
function MediaAttachment({ message, token }) {
  const payload = normalizeMessagePayload(message);
  const messageType = String(message?.message_type || payload?.type || 'text').trim().toLowerCase();
  const media = MEDIA_TYPES.includes(messageType) ? (payload?.[messageType] || {}) : null;
  const directLink = String(media?.link || '').trim();
  const mediaId = String(media?.id || '').trim();
  const filename = String(media?.filename || '').trim();

  const [url, setUrl] = useState(directLink);
  const [err, setErr] = useState('');

  useEffect(() => {
    // directLink (if present) is already the initial state; only fetch when we
    // must resolve a media id through the authenticated content endpoint.
    // Depend on primitives (not the recreated `media` object) to avoid refetch loops.
    if (!MEDIA_TYPES.includes(messageType) || directLink) return undefined;
    if (!mediaId || !token) return undefined;
    let active = true;
    let objectUrl = null;
    fetch(`${API_BASE}/api/whatsapp/inbox/media/${encodeURIComponent(mediaId)}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`No se pudo abrir el archivo (${res.status})`);
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => { if (active) setErr(e?.message || 'No se pudo abrir el archivo'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [messageType, directLink, mediaId, token]);

  if (!media) return null;
  if (err) return <span className="sales-ia-media-err">{err}</span>;
  if (!url) return <span className="sales-ia-media-link">Cargando archivo…</span>;
  if (messageType === 'image') {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={filename || 'imagen'} className="sales-ia-media-img" /></a>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" download={filename || undefined} className="sales-ia-media-link">
      {messageType === 'document' ? `Abrir ${filename || 'documento'}` : 'Abrir archivo'}
    </a>
  );
}

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
  // Optional: messages the rep selected so the AI focuses only on those
  const [selectedMsgIds, setSelectedMsgIds] = useState(() => new Set());

  // Reply composer
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  // Catalog (for manually searching/adding products the AI didn't suggest)
  const [catalog, setCatalog] = useState([]);
  const [productQuery, setProductQuery] = useState('');

  // Quote draft
  const [quoteRows, setQuoteRows] = useState([]);
  const [customerNameInput, setCustomerNameInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [storeLocation, setStoreLocation] = useState(STORE_OPTIONS[0]);
  const [ventaType, setVentaType] = useState('SF');
  const [sellerUserId, setSellerUserId] = useState('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [quoteResult, setQuoteResult] = useState(null);
  const [sendingPdf, setSendingPdf] = useState(false);
  const [pdfSent, setPdfSent] = useState(false);

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

  // Tracks the conversation the user most recently opened. Async loads/suggests
  // compare against this so a slow earlier response can't overwrite the thread
  // after the user has switched to a different conversation.
  const activeConvRef = useRef(null);

  const reloadMessages = useCallback(async (id) => {
    const res = await apiRequest(`/api/whatsapp/inbox/conversations/${id}/messages`, { token });
    if (activeConvRef.current !== id) return res; // a newer conversation was opened
    setConversation(res?.conversation || null);
    setMessages(Array.isArray(res?.messages) ? res.messages : []);
    return res;
  }, [token]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/product-catalog', { token })
      .then((rows) => { if (active) setCatalog(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) setCatalog([]); });
    return () => { active = false; };
  }, [token]);

  const toggleMsgSelect = (id) => {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearMsgSelection = () => setSelectedMsgIds(new Set());

  const openConversation = async (id) => {
    activeConvRef.current = id;
    setSelectedId(id);
    setSuggestion(null);
    setReply('');
    setQuoteRows([]);
    setQuoteResult(null);
    setPdfSent(false);
    setCustomerNameInput('');
    setDestinationInput('');
    setSelectedMsgIds(new Set());
    setProductQuery('');
    setLoadingThread(true);
    setError('');
    try {
      const res = await reloadMessages(id);
      const assigned = res?.conversation?.assigned_user_id;
      setSellerUserId(assigned ? String(assigned) : '');
      // default the quote name to the WhatsApp contact until the AI extracts one
      setCustomerNameInput(String(res?.conversation?.contact_name || '').trim());
    } catch (err) {
      setError(err?.message || 'No se pudo abrir la conversación.');
    } finally {
      setLoadingThread(false);
    }
  };

  const generateSuggestion = async () => {
    if (!selectedId) return;
    const convId = selectedId;
    setSuggesting(true);
    setError('');
    try {
      const res = await apiRequest('/api/ai/sales/suggest', {
        method: 'POST',
        token,
        body: {
          conversation_id: convId,
          ...(selectedMsgIds.size > 0 ? { message_ids: Array.from(selectedMsgIds) } : {})
        },
        timeoutMs: 45000,
        retries: 0
      });
      if (activeConvRef.current !== convId) return; // user switched conversations mid-request
      setSuggestion(res);
      setReply(res?.reply_draft || '');
      setQuoteRows(Array.isArray(res?.quote_draft?.rows) ? res.quote_draft.rows : []);
      // prioritize info the customer stated in the conversation; fall back to WhatsApp contact
      const extractedName = String(res?.quote_draft?.customer_name || '').trim();
      const extractedDestination = String(res?.quote_draft?.destination || '').trim();
      if (extractedName) setCustomerNameInput(extractedName);
      else if (!customerNameInput) setCustomerNameInput(String(conversation?.contact_name || '').trim());
      if (extractedDestination) setDestinationInput(extractedDestination);
    } catch (err) {
      if (activeConvRef.current === convId) setError(err?.message || 'No se pudo generar la sugerencia.');
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
      await reloadMessages(selectedId);
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

  const normalizedProductQuery = productQuery.trim().toLowerCase();
  const productSearchResults = normalizedProductQuery
    ? catalog
        .filter((p) => {
          const haystack = `${p.sku || ''} ${p.name || ''} ${p.description || ''}`.toLowerCase();
          return normalizedProductQuery.split(/\s+/).every((term) => haystack.includes(term));
        })
        .filter((p) => !quoteRows.some((r) => r.sku === p.sku))
        .slice(0, 8)
    : [];

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
    // prioritize the name the customer stated (editable field) over the WhatsApp contact
    const customerName = customerNameInput.trim() || (conversation.contact_name || '').trim() || 'Cliente WhatsApp';
    const customerPhone = (conversation.contact_phone || '').trim();
    const destination = destinationInput.trim();
    if (!window.confirm(`¿Crear cotización para ${customerName} por ${money(subtotal)}?`)) return;

    setCreatingQuote(true);
    setError('');
    setQuoteResult(null);
    setPdfSent(false);
    try {
      const res = await apiRequest('/api/quotes', {
        method: 'POST',
        token,
        body: {
          customer_name: customerName,
          customer_phone: customerPhone,
          ...(destination ? { department: destination.slice(0, 50) } : {}),
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
      setQuoteResult({
        id: res?.id,
        customerName,
        customerPhone,
        vendor,
        storeLocation,
        department: destination,
        rows: quoteRows,
        subtotal: Number(subtotal.toFixed(2))
      });
    } catch (err) {
      setError(err?.message || 'No se pudo crear la cotización.');
    } finally {
      setCreatingQuote(false);
    }
  };

  const sendQuotePdfToThread = async () => {
    if (!quoteResult?.id || !selectedId) return;
    if (!window.confirm('¿Enviar el PDF de la cotización al cliente por WhatsApp?')) return;
    setSendingPdf(true);
    setError('');
    try {
      const filename = `cotizacion-${quoteResult.id}.pdf`;
      const doc = generateModernQuotePdf({
        filename,
        autoSave: false,
        quoteNumber: quoteResult.id,
        customerName: quoteResult.customerName,
        customerPhone: quoteResult.customerPhone,
        vendorName: quoteResult.vendor,
        storeLocation: quoteResult.storeLocation,
        department: quoteResult.department,
        dateText: new Date().toLocaleDateString('es-BO'),
        rows: quoteResult.rows,
        subtotal: quoteResult.subtotal,
        total: quoteResult.subtotal
      });
      const blob = doc.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      const formData = new FormData();
      formData.append('file', file);
      const upload = await apiRequest('/api/whatsapp/inbox/media/upload', {
        method: 'POST',
        token,
        body: formData,
        timeoutMs: 45000
      });
      if (!upload?.media_id) throw new Error('No se obtuvo media_id de WhatsApp.');
      await apiRequest(`/api/whatsapp/inbox/conversations/${selectedId}/messages`, {
        method: 'POST',
        token,
        body: {
          type: 'document',
          media_id: upload.media_id,
          filename,
          caption: `Cotización #${quoteResult.id}`
        }
      });
      setPdfSent(true);
      await reloadMessages(selectedId);
    } catch (err) {
      setError(err?.message || 'No se pudo enviar el PDF al chat.');
    } finally {
      setSendingPdf(false);
    }
  };

  return (
    <div className="sales-ia">
      <div className="admin-ai-result-head">
        <h3 style={{ margin: 0 }}>Ventas IA (beta privada)</h3>
        <span>Atiende el inbox de WhatsApp con borradores de IA.</span>
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
                <small className="sales-ia-muted">Marca mensajes para enfocar la IA (opcional)</small>
              </div>
              <div className="sales-ia-messages">
                {loadingThread && <p className="sales-ia-muted">Cargando…</p>}
                {!loadingThread && messages.length === 0 && <p className="sales-ia-muted">Sin mensajes.</p>}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`sales-ia-bubble ${m.direction === 'inbound' ? 'in' : 'out'} ${selectedMsgIds.has(m.id) ? 'selected' : ''}`}
                  >
                    <label className="sales-ia-bubble-select" title="Enfocar la IA en este mensaje">
                      <input
                        type="checkbox"
                        checked={selectedMsgIds.has(m.id)}
                        onChange={() => toggleMsgSelect(m.id)}
                      />
                    </label>
                    <div>{m.text_body || `[${m.message_type || 'mensaje'}]`}</div>
                    <MediaAttachment message={m} token={token} />
                  </div>
                ))}
              </div>
              {selectedMsgIds.size > 0 && (
                <div className="sales-ia-selection-bar">
                  <span>{selectedMsgIds.size} mensaje(s) seleccionado(s) — la IA usará solo estos.</span>
                  <button type="button" className="admin-ai-pill" onClick={clearMsgSelection}>Limpiar</button>
                </div>
              )}
              <div className="sales-ia-composer">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Escribe o usa el borrador de IA…"
                  disabled={sending}
                />
                <div className="sales-ia-composer-actions">
                  <button type="button" className="admin-ai-pill" onClick={generateSuggestion} disabled={suggesting || loadingThread}>
                    {suggesting
                      ? 'Generando…'
                      : (selectedMsgIds.size > 0 ? `Generar IA (${selectedMsgIds.size} sel.)` : 'Generar sugerencias IA')}
                  </button>
                  <button type="button" className="btn" onClick={sendReply} disabled={sending || !reply.trim()}>
                    {sending ? 'Enviando…' : 'Enviar respuesta'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Column 3: AI panel */}
        <div className="sales-ia-col sales-ia-panel">
          {!suggestion && <p className="sales-ia-muted">Genera sugerencias para ver borrador, productos y cotización.</p>}
          {suggestion && (
            <>
              {suggestion.focused && (
                <p className="sales-ia-muted" style={{ margin: 0 }}>
                  Enfocado en {suggestion.focused_count} mensaje(s) seleccionado(s).
                </p>
              )}
              {suggestion.provider === 'fallback' && (
                <div className="admin-ai-error" style={{ color: '#92400e', background: 'rgba(251, 191, 36, 0.14)', borderColor: 'rgba(251, 191, 36, 0.5)' }}>
                  {suggestion.uninterpreted
                    ? 'No pude interpretar este mensaje automáticamente (puede ser un audio o imagen que no se pudo leer). Escribe la respuesta y arma la cotización manualmente.'
                    : 'No pude generar una sugerencia completa. Abajo hay posibles coincidencias por palabras clave para revisar — la respuesta y la cotización quedan a tu criterio.'}
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

                <div className="sales-ia-product-search">
                  <input
                    type="text"
                    value={productQuery}
                    placeholder="Buscar producto por nombre o código para agregar…"
                    onChange={(e) => setProductQuery(e.target.value)}
                  />
                  {normalizedProductQuery && (
                    <div className="sales-ia-search-results">
                      {productSearchResults.length === 0 && (
                        <p className="sales-ia-muted">Sin resultados en el catálogo.</p>
                      )}
                      {productSearchResults.map((p) => (
                        <div key={p.sku} className="sales-ia-product">
                          <div>
                            <strong>{p.name}</strong>
                            <small>{p.sku} · SF {money(p.sf)}{p.cf ? ` · CF ${money(p.cf)}` : ''}</small>
                          </div>
                          <button
                            type="button"
                            className="admin-ai-pill"
                            onClick={() => { addSuggestedToQuote(p); setProductQuery(''); }}
                          >
                            Agregar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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
                  <label className="sales-ia-quote-field">Cliente (cotización)
                    <input
                      type="text"
                      value={customerNameInput}
                      placeholder="Nombre para la cotización"
                      onChange={(e) => setCustomerNameInput(e.target.value)}
                    />
                  </label>
                  <label className="sales-ia-quote-field">Destino
                    <input
                      type="text"
                      value={destinationInput}
                      placeholder="Ciudad / departamento"
                      onChange={(e) => setDestinationInput(e.target.value)}
                    />
                  </label>
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
                  <div className="sales-ia-ok">
                    <span>Cotización #{quoteResult.id} creada correctamente.</span>
                    <div className="sales-ia-quote-foot" style={{ marginTop: '6px' }}>
                      <small>{pdfSent ? 'PDF enviado al chat.' : 'Envía el PDF al cliente por WhatsApp.'}</small>
                      <button type="button" className="btn" onClick={sendQuotePdfToThread} disabled={sendingPdf || pdfSent}>
                        {sendingPdf ? 'Enviando PDF…' : (pdfSent ? 'PDF enviado' : 'Enviar PDF al chat')}
                      </button>
                    </div>
                  </div>
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
