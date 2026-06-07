import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const formatDateTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
};

const normalizePhoneDisplay = (phone = '') => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `+${digits}`;
};

function ConversationItem({ row, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        border: isActive ? '1px solid rgba(59,130,246,0.8)' : '1px solid rgba(51,65,85,0.7)',
        background: isActive ? 'linear-gradient(180deg, #1e3a5f 0%, #172338 100%)' : 'linear-gradient(180deg, #162132 0%, #111827 100%)',
        borderRadius: 12,
        padding: '10px 12px',
        color: '#e2e8f0',
        cursor: 'pointer',
        display: 'grid',
        gap: 6
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>
          {row.contact_name || normalizePhoneDisplay(row.contact_phone) || 'Sin nombre'}
        </strong>
        <span style={{ color: '#94a3b8', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
          {formatDateTime(row.last_message_at)}
        </span>
      </div>
      <div style={{ color: '#93c5fd', fontSize: '0.76rem' }}>{normalizePhoneDisplay(row.contact_phone)}</div>
      <div style={{
        color: '#cbd5e1',
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {row.last_message_preview || 'Sin mensajes'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: '0.72rem',
          color: row.status === 'closed' ? '#fca5a5' : '#86efac',
          border: row.status === 'closed' ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(52,211,153,0.5)',
          background: row.status === 'closed' ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
          borderRadius: 999,
          padding: '2px 8px'
        }}>
          {row.status === 'closed' ? 'Cerrado' : 'Abierto'}
        </span>
        {Number(row.unread_count || 0) > 0 && (
          <span style={{
            minWidth: 20,
            height: 20,
            borderRadius: 999,
            background: '#f97316',
            color: 'white',
            fontSize: '0.74rem',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700
          }}>
            {Number(row.unread_count || 0)}
          </span>
        )}
      </div>
    </button>
  );
}

export default function WhatsAppInboxAdmin({ token }) {
  const [search, setSearch] = useState('');
  const [conversations, setConversations] = useState([]);
  const [salesUsers, setSalesUsers] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationMeta, setConversationMeta] = useState(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const selectedConversation = useMemo(
    () => conversations.find((row) => row.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const loadConversations = async ({ preserveSelection = true } = {}) => {
    setLoadingConversations(true);
    try {
      const params = new URLSearchParams({
        search: search.trim(),
        limit: '80'
      });
      const payload = await apiRequest(`/api/whatsapp/inbox/conversations?${params.toString()}`, { token });
      const rows = Array.isArray(payload?.conversations) ? payload.conversations : [];
      setConversations(rows);
      setSalesUsers(Array.isArray(payload?.sales_users) ? payload.sales_users : []);
      if (!preserveSelection) {
        setSelectedConversationId(rows[0]?.id || null);
        return;
      }
      if (!rows.some((row) => row.id === selectedConversationId)) {
        setSelectedConversationId(rows[0]?.id || null);
      }
    } catch (err) {
      setError(err.message || 'No se pudo cargar conversaciones');
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadMessages = async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      setConversationMeta(null);
      return;
    }
    setLoadingMessages(true);
    try {
      const payload = await apiRequest(`/api/whatsapp/inbox/conversations/${conversationId}/messages`, { token });
      setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
      setConversationMeta(payload?.conversation || null);
      await apiRequest(`/api/whatsapp/inbox/conversations/${conversationId}/read`, {
        method: 'PATCH',
        token,
        body: {}
      }).catch(() => {});
      setConversations((prev) => prev.map((row) => (
        row.id === conversationId ? { ...row, unread_count: 0 } : row
      )));
    } catch (err) {
      setError(err.message || 'No se pudieron cargar mensajes');
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadConversations({ preserveSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    loadMessages(selectedConversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadConversations();
      if (selectedConversationId) {
        loadMessages(selectedConversationId);
      }
    }, 15000);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId, search]);

  const sendMessage = async () => {
    if (!selectedConversationId || !draft.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiRequest(`/api/whatsapp/inbox/conversations/${selectedConversationId}/messages`, {
        method: 'POST',
        token,
        body: { text: draft.trim() }
      });
      setDraft('');
      await Promise.all([
        loadMessages(selectedConversationId),
        loadConversations()
      ]);
    } catch (err) {
      setError(err.message || 'No se pudo enviar mensaje');
    } finally {
      setSending(false);
    }
  };

  const changeAssignment = async (conversationId, nextValue) => {
    if (!conversationId) return;
    setError('');
    try {
      if (nextValue === 'auto') {
        await apiRequest(`/api/whatsapp/inbox/conversations/${conversationId}/assign`, {
          method: 'PATCH',
          token,
          body: { mode: 'auto' }
        });
      } else {
        await apiRequest(`/api/whatsapp/inbox/conversations/${conversationId}/assign`, {
          method: 'PATCH',
          token,
          body: { assigned_user_id: Number(nextValue) }
        });
      }
      await Promise.all([
        loadConversations(),
        loadMessages(conversationId)
      ]);
    } catch (err) {
      setError(err.message || 'No se pudo cambiar asignación');
    }
  };

  const toggleStatus = async (conversationId, status) => {
    if (!conversationId) return;
    setError('');
    try {
      await apiRequest(`/api/whatsapp/inbox/conversations/${conversationId}/status`, {
        method: 'PATCH',
        token,
        body: { status }
      });
      await Promise.all([
        loadConversations(),
        loadMessages(conversationId)
      ]);
    } catch (err) {
      setError(err.message || 'No se pudo actualizar estado');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ marginBottom: 0, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>WhatsApp Inbox</h3>
            <p style={{ color: '#94a3b8', margin: 0 }}>
              Estilo operativo tipo Wati/AiSensy: conversaciones, asignación round-robin y respuesta centralizada.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              loadConversations();
              if (selectedConversationId) loadMessages(selectedConversationId);
            }}
            disabled={loadingConversations || loadingMessages}
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '10px 12px',
          borderRadius: 8,
          color: '#fecaca',
          background: 'rgba(127,29,29,0.35)',
          border: '1px solid rgba(248,113,113,0.45)'
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '320px minmax(0, 1fr) 300px',
        gap: 12
      }}>
        <section className="card" style={{ marginBottom: 0, padding: 12, minHeight: 620 }}>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o número..."
            style={{
              width: '100%',
              minHeight: 40,
              borderRadius: 10,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#f8fafc',
              padding: '8px 10px',
              marginBottom: 10
            }}
          />
          <div style={{ display: 'grid', gap: 8, maxHeight: 550, overflowY: 'auto', paddingRight: 2 }}>
            {loadingConversations ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>Cargando conversaciones...</div>
            ) : conversations.length === 0 ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>Sin conversaciones</div>
            ) : conversations.map((row) => (
              <ConversationItem
                key={row.id}
                row={row}
                isActive={selectedConversationId === row.id}
                onClick={() => setSelectedConversationId(row.id)}
              />
            ))}
          </div>
        </section>

        <section className="card" style={{ marginBottom: 0, padding: 0, minHeight: 620, display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ borderBottom: '1px solid #334155', padding: '12px 14px', minHeight: 68 }}>
            {selectedConversation ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9' }}>
                    {selectedConversation.contact_name || normalizePhoneDisplay(selectedConversation.contact_phone)}
                  </div>
                  <div style={{ color: '#93c5fd', fontSize: '0.84rem' }}>
                    {normalizePhoneDisplay(selectedConversation.contact_phone)}
                  </div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.78rem', textAlign: 'right' }}>
                  Última actividad<br />
                  {formatDateTime(selectedConversation.last_message_at)}
                </div>
              </div>
            ) : (
              <div style={{ color: '#94a3b8' }}>Selecciona una conversación</div>
            )}
          </div>

          <div style={{ padding: 14, overflowY: 'auto', maxHeight: 470, background: 'linear-gradient(180deg, #0f172a 0%, #0b1220 100%)' }}>
            {loadingMessages ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', paddingTop: 24 }}>Cargando mensajes...</div>
            ) : !selectedConversation ? (
              <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 24 }}>
                No hay conversación seleccionada.
              </div>
            ) : messages.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 24 }}>
                Sin mensajes todavía.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {messages.map((message) => {
                  const isOutbound = message.direction === 'outbound';
                  return (
                    <div key={message.id} style={{
                      display: 'flex',
                      justifyContent: isOutbound ? 'flex-end' : 'flex-start'
                    }}>
                      <div style={{
                        maxWidth: '78%',
                        borderRadius: 12,
                        padding: '8px 10px',
                        border: isOutbound ? '1px solid rgba(59,130,246,0.55)' : '1px solid rgba(71,85,105,0.65)',
                        background: isOutbound ? 'linear-gradient(180deg, #1d4ed8 0%, #1e40af 100%)' : '#1f2937',
                        color: '#f8fafc'
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>
                          {message.text_body || '[Sin texto]'}
                        </div>
                        <div style={{
                          marginTop: 4,
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 10,
                          fontSize: '0.72rem',
                          color: isOutbound ? '#bfdbfe' : '#9ca3af'
                        }}>
                          <span>{formatDateTime(message.created_at)}</span>
                          <span>{message.status || (isOutbound ? 'sent' : 'received')}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #334155', padding: 12, display: 'grid', gap: 8 }}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Escribe un mensaje..."
              style={{
                width: '100%',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#111827',
                color: '#f8fafc',
                padding: '9px 10px',
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={sendMessage}
                disabled={sending || !selectedConversation || !draft.trim()}
              >
                {sending ? 'Enviando...' : 'Enviar mensaje'}
              </button>
            </div>
          </div>
        </section>

        <aside className="card" style={{ marginBottom: 0, padding: 14, minHeight: 620 }}>
          {!conversationMeta ? (
            <div style={{ color: '#94a3b8' }}>Selecciona una conversación para ver detalles.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <h4 style={{ marginBottom: 6 }}>Detalles</h4>
                <div style={{ color: '#cbd5e1', fontSize: '0.86rem', display: 'grid', gap: 4 }}>
                  <div><strong>Contacto:</strong> {conversationMeta.contact_name || 'Sin nombre'}</div>
                  <div><strong>Número:</strong> {normalizePhoneDisplay(conversationMeta.contact_phone)}</div>
                  <div><strong>Estado:</strong> {conversationMeta.status === 'closed' ? 'Cerrado' : 'Abierto'}</div>
                </div>
              </div>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Asignado a</span>
                <select
                  value={conversationMeta.assigned_user_id ?? ''}
                  onChange={(event) => changeAssignment(conversationMeta.id, event.target.value)}
                  style={{
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#f1f5f9',
                    padding: '6px 8px'
                  }}
                >
                  <option value="">Sin asignar</option>
                  {salesUsers.map((user) => (
                    <option key={user.id} value={String(user.id)}>
                      {user.name} ({user.city || 'Sin ciudad'})
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="btn"
                onClick={() => changeAssignment(conversationMeta.id, 'auto')}
                style={{ background: '#2563eb', color: '#fff' }}
              >
                Asignar round-robin
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => toggleStatus(conversationMeta.id, 'open')}
                  style={{ background: '#059669', color: '#fff' }}
                >
                  Marcar abierta
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => toggleStatus(conversationMeta.id, 'closed')}
                  style={{ background: '#b91c1c', color: '#fff' }}
                >
                  Cerrar chat
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
