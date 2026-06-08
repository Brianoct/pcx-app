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

const COMPOSER_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'image', label: 'Imagen' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documento' },
  { value: 'location', label: 'Ubicación' },
  { value: 'contacts', label: 'Contacto(s)' },
  { value: 'interactive', label: 'Botones/Lista' },
  { value: 'template', label: 'Plantilla' }
];

const parseJsonInput = (value, fieldLabel, fallbackValue = null) => {
  const raw = String(value || '').trim();
  if (!raw) return fallbackValue;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${fieldLabel} debe ser JSON válido`);
  }
};

const normalizeMessagePayload = (message = {}) => {
  const rawPayload = message?.raw_payload;
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  if (message.direction === 'outbound' && rawPayload.request && typeof rawPayload.request === 'object') {
    return rawPayload.request;
  }
  return rawPayload;
};

const renderMessageBody = (message = {}) => {
  const payload = normalizeMessagePayload(message);
  const messageType = String(message?.message_type || payload?.type || 'text').trim().toLowerCase();
  const textBody = String(message?.text_body || '').trim();

  if (messageType === 'text') {
    return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>{textBody || '[Sin texto]'}</div>;
  }

  if (['image', 'video', 'audio', 'document'].includes(messageType)) {
    const media = payload?.[messageType] || {};
    const link = String(media?.link || '').trim();
    const mediaId = String(media?.id || '').trim();
    const caption = String(media?.caption || '').trim();
    const filename = String(media?.filename || '').trim();
    return (
      <div style={{ display: 'grid', gap: 5 }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{textBody || `[${messageType}]`}</div>
        {caption && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>{caption}</div>}
        {filename && <div style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>Archivo: {filename}</div>}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', fontSize: '0.78rem' }}>
            Abrir archivo
          </a>
        )}
        {mediaId && <div style={{ color: '#94a3b8', fontSize: '0.74rem' }}>Media ID: {mediaId}</div>}
      </div>
    );
  }

  if (messageType === 'location') {
    const location = payload?.location || {};
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    const mapsLink = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `https://maps.google.com/?q=${latitude},${longitude}`
      : '';
    return (
      <div style={{ display: 'grid', gap: 5 }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{textBody || '[Ubicación]'}</div>
        {location?.name && <div style={{ fontSize: '0.82rem' }}>{location.name}</div>}
        {location?.address && <div style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>{location.address}</div>}
        {mapsLink && (
          <a href={mapsLink} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', fontSize: '0.78rem' }}>
            Ver en mapa
          </a>
        )}
      </div>
    );
  }

  if (messageType === 'contacts') {
    const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
    const firstContact = contacts[0];
    const firstName = String(firstContact?.name?.formatted_name || '').trim();
    const firstPhone = Array.isArray(firstContact?.phones) ? firstContact.phones[0]?.phone : '';
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{textBody || '[Contacto]'}</div>
        {firstName && <div style={{ fontSize: '0.82rem' }}>{firstName}</div>}
        {firstPhone && <div style={{ color: '#93c5fd', fontSize: '0.8rem' }}>{firstPhone}</div>}
        <div style={{ color: '#94a3b8', fontSize: '0.74rem' }}>
          {contacts.length > 1 ? `${contacts.length} contactos enviados` : '1 contacto enviado'}
        </div>
      </div>
    );
  }

  if (messageType === 'interactive') {
    const interactive = payload?.interactive || {};
    const interactiveType = String(interactive?.type || '').trim();
    const bodyText = String(interactive?.body?.text || '').trim();
    const buttonTitles = Array.isArray(interactive?.action?.buttons)
      ? interactive.action.buttons.map((btn) => String(btn?.reply?.title || '').trim()).filter(Boolean)
      : [];
    const listButton = String(interactive?.action?.button || '').trim();
    return (
      <div style={{ display: 'grid', gap: 5 }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
          {bodyText || textBody || '[Interactivo]'}
        </div>
        {interactiveType && <div style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>Tipo: {interactiveType}</div>}
        {buttonTitles.length > 0 && (
          <div style={{ color: '#93c5fd', fontSize: '0.78rem' }}>
            Botones: {buttonTitles.join(' | ')}
          </div>
        )}
        {listButton && <div style={{ color: '#93c5fd', fontSize: '0.78rem' }}>Lista: {listButton}</div>}
      </div>
    );
  }

  if (messageType === 'template') {
    const template = payload?.template || {};
    const name = String(template?.name || '').trim();
    const lang = String(template?.language?.code || '').trim();
    const componentsCount = Array.isArray(template?.components) ? template.components.length : 0;
    return (
      <div style={{ display: 'grid', gap: 5 }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{textBody || '[Plantilla]'}</div>
        {name && <div style={{ fontSize: '0.82rem' }}>Template: {name}</div>}
        {lang && <div style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>Idioma: {lang}</div>}
        {componentsCount > 0 && (
          <div style={{ color: '#94a3b8', fontSize: '0.74rem' }}>
            Componentes: {componentsCount}
          </div>
        )}
      </div>
    );
  }

  return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>{textBody || `[${messageType}]`}</div>;
};

const getStatusVisual = (statusRaw, isOutbound) => {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (!isOutbound) return { label: status || 'received', color: '#9ca3af' };
  if (status === 'read') return { label: 'read', color: '#86efac' };
  if (status === 'delivered') return { label: 'delivered', color: '#93c5fd' };
  if (status === 'failed') return { label: 'failed', color: '#fca5a5' };
  return { label: status || 'sent', color: '#bfdbfe' };
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
  const [composerType, setComposerType] = useState('text');
  const [draft, setDraft] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [mediaFilename, setMediaFilename] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLng, setLocationLng] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [contactsJson, setContactsJson] = useState(
    '[\n  {\n    "name": { "formatted_name": "Contacto PCX" },\n    "phones": [{ "phone": "59170000000", "type": "MOBILE" }]\n  }\n]'
  );
  const [interactiveJson, setInteractiveJson] = useState(
    '{\n  "type": "button",\n  "body": { "text": "Seleccione una opción" },\n  "action": {\n    "buttons": [\n      { "type": "reply", "reply": { "id": "catalogo", "title": "Catalogo" } },\n      { "type": "reply", "reply": { "id": "asesor", "title": "Hablar con asesor" } }\n    ]\n  }\n}'
  );
  const [templateName, setTemplateName] = useState('');
  const [templateLanguageCode, setTemplateLanguageCode] = useState('es');
  const [templateComponentsJson, setTemplateComponentsJson] = useState('[]');
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

  const buildOutgoingBody = () => {
    if (composerType === 'text') {
      const text = draft.trim();
      if (!text) throw new Error('El mensaje de texto no puede estar vacío');
      return { type: 'text', text };
    }

    if (['image', 'video', 'audio', 'document'].includes(composerType)) {
      const payload = {
        type: composerType
      };
      if (mediaUrl.trim()) payload.media_url = mediaUrl.trim();
      if (mediaId.trim()) payload.media_id = mediaId.trim();
      if (!payload.media_url && !payload.media_id) {
        throw new Error(`Para ${composerType} debes enviar media_url o media_id`);
      }
      if (mediaCaption.trim()) payload.caption = mediaCaption.trim();
      if (composerType === 'document' && mediaFilename.trim()) payload.filename = mediaFilename.trim();
      return payload;
    }

    if (composerType === 'location') {
      const latitude = Number(locationLat);
      const longitude = Number(locationLng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Ubicación inválida: latitude y longitude son requeridos');
      }
      return {
        type: 'location',
        location: {
          latitude,
          longitude,
          name: locationName.trim() || undefined,
          address: locationAddress.trim() || undefined
        }
      };
    }

    if (composerType === 'contacts') {
      const contacts = parseJsonInput(contactsJson, 'contacts', []);
      if (!Array.isArray(contacts) || contacts.length === 0) {
        throw new Error('contacts debe incluir al menos un contacto');
      }
      return {
        type: 'contacts',
        contacts
      };
    }

    if (composerType === 'interactive') {
      const interactive = parseJsonInput(interactiveJson, 'interactive');
      if (!interactive || typeof interactive !== 'object' || Array.isArray(interactive)) {
        throw new Error('interactive debe ser un objeto');
      }
      return {
        type: 'interactive',
        interactive
      };
    }

    if (composerType === 'template') {
      const name = templateName.trim();
      if (!name) throw new Error('template_name es requerido');
      const components = parseJsonInput(templateComponentsJson, 'template_components', []);
      if (!Array.isArray(components)) throw new Error('template_components debe ser un arreglo');
      return {
        type: 'template',
        template_name: name,
        template_language_code: templateLanguageCode.trim() || 'es',
        template_components: components
      };
    }

    throw new Error('Tipo de mensaje no soportado');
  };

  const canSendMessage = useMemo(() => {
    if (!selectedConversationId || sending) return false;
    if (composerType === 'text') return Boolean(draft.trim());
    if (['image', 'video', 'audio', 'document'].includes(composerType)) {
      return Boolean(mediaUrl.trim() || mediaId.trim());
    }
    if (composerType === 'location') {
      return Boolean(locationLat.trim() && locationLng.trim());
    }
    if (composerType === 'template') {
      return Boolean(templateName.trim());
    }
    return true;
  }, [selectedConversationId, sending, composerType, draft, mediaUrl, mediaId, locationLat, locationLng, templateName]);

  const resetComposer = () => {
    setDraft('');
    setMediaUrl('');
    setMediaId('');
    setMediaCaption('');
    setMediaFilename('');
    setLocationLat('');
    setLocationLng('');
    setLocationName('');
    setLocationAddress('');
    setTemplateName('');
    setTemplateComponentsJson('[]');
  };

  const sendMessage = async () => {
    if (!selectedConversationId) return;
    setSending(true);
    setError('');
    try {
      const body = buildOutgoingBody();
      await apiRequest(`/api/whatsapp/inbox/conversations/${selectedConversationId}/messages`, {
        method: 'POST',
        token,
        body
      });
      resetComposer();
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
                  const statusVisual = getStatusVisual(message.status, isOutbound);
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
                        {renderMessageBody(message)}
                        <div style={{
                          marginTop: 4,
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 10,
                          fontSize: '0.72rem',
                          color: isOutbound ? '#bfdbfe' : '#9ca3af'
                        }}>
                          <span>{formatDateTime(message.created_at)}</span>
                          <span style={{ color: statusVisual.color }}>{statusVisual.label}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #334155', padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 8 }}>
              <select
                value={composerType}
                onChange={(event) => setComposerType(event.target.value)}
                style={{
                  minHeight: 40,
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#f8fafc',
                  padding: '8px 10px'
                }}
              >
                {COMPOSER_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div style={{ color: '#94a3b8', fontSize: '0.78rem', display: 'flex', alignItems: 'center' }}>
                Envia texto, media, ubicacion, contactos, botones/lista y plantillas desde este panel.
              </div>
            </div>

            {composerType === 'text' && (
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
            )}

            {['image', 'video', 'audio', 'document'].includes(composerType) && (
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  type="text"
                  value={mediaUrl}
                  onChange={(event) => setMediaUrl(event.target.value)}
                  placeholder="media_url (https://...)"
                  style={{
                    width: '100%',
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '8px 10px'
                  }}
                />
                <input
                  type="text"
                  value={mediaId}
                  onChange={(event) => setMediaId(event.target.value)}
                  placeholder="media_id (opcional si usas URL)"
                  style={{
                    width: '100%',
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '8px 10px'
                  }}
                />
                {composerType !== 'audio' && (
                  <input
                    type="text"
                    value={mediaCaption}
                    onChange={(event) => setMediaCaption(event.target.value)}
                    placeholder="Caption (opcional)"
                    style={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#111827',
                      color: '#f8fafc',
                      padding: '8px 10px'
                    }}
                  />
                )}
                {composerType === 'document' && (
                  <input
                    type="text"
                    value={mediaFilename}
                    onChange={(event) => setMediaFilename(event.target.value)}
                    placeholder="Nombre archivo (opcional)"
                    style={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#111827',
                      color: '#f8fafc',
                      padding: '8px 10px'
                    }}
                  />
                )}
              </div>
            )}

            {composerType === 'location' && (
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <input
                  type="text"
                  value={locationLat}
                  onChange={(event) => setLocationLat(event.target.value)}
                  placeholder="Latitude"
                  style={{
                    width: '100%',
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '8px 10px'
                  }}
                />
                <input
                  type="text"
                  value={locationLng}
                  onChange={(event) => setLocationLng(event.target.value)}
                  placeholder="Longitude"
                  style={{
                    width: '100%',
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '8px 10px'
                  }}
                />
                <input
                  type="text"
                  value={locationName}
                  onChange={(event) => setLocationName(event.target.value)}
                  placeholder="Nombre (opcional)"
                  style={{
                    width: '100%',
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '8px 10px'
                  }}
                />
                <input
                  type="text"
                  value={locationAddress}
                  onChange={(event) => setLocationAddress(event.target.value)}
                  placeholder="Direccion (opcional)"
                  style={{
                    width: '100%',
                    minHeight: 38,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '8px 10px'
                  }}
                />
              </div>
            )}

            {composerType === 'contacts' && (
              <textarea
                value={contactsJson}
                onChange={(event) => setContactsJson(event.target.value)}
                rows={6}
                placeholder='[{"name":{"formatted_name":"Contacto"},"phones":[{"phone":"59170000000","type":"MOBILE"}]}]'
                style={{
                  width: '100%',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#111827',
                  color: '#f8fafc',
                  padding: '9px 10px',
                  resize: 'vertical',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.8rem'
                }}
              />
            )}

            {composerType === 'interactive' && (
              <textarea
                value={interactiveJson}
                onChange={(event) => setInteractiveJson(event.target.value)}
                rows={7}
                placeholder='{"type":"button","body":{"text":"Seleccione"},"action":{"buttons":[...]}}'
                style={{
                  width: '100%',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#111827',
                  color: '#f8fafc',
                  padding: '9px 10px',
                  resize: 'vertical',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.8rem'
                }}
              />
            )}

            {composerType === 'template' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 140px' }}>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="template_name"
                    style={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#111827',
                      color: '#f8fafc',
                      padding: '8px 10px'
                    }}
                  />
                  <input
                    type="text"
                    value={templateLanguageCode}
                    onChange={(event) => setTemplateLanguageCode(event.target.value)}
                    placeholder="Idioma (es)"
                    style={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#111827',
                      color: '#f8fafc',
                      padding: '8px 10px'
                    }}
                  />
                </div>
                <textarea
                  value={templateComponentsJson}
                  onChange={(event) => setTemplateComponentsJson(event.target.value)}
                  rows={5}
                  placeholder='[{"type":"body","parameters":[{"type":"text","text":"Brian"}]}]'
                  style={{
                    width: '100%',
                    borderRadius: 10,
                    border: '1px solid #334155',
                    background: '#111827',
                    color: '#f8fafc',
                    padding: '9px 10px',
                    resize: 'vertical',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '0.8rem'
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={sendMessage}
                disabled={!canSendMessage}
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
