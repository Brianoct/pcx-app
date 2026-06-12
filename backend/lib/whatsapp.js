const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { pool } = require('../db');
const { ROLE_KEYS, normalizeRole } = require('./rbac');
const { createHttpError, parseJsonInput, parseOptionalBoolean } = require('./util');

const whatsappWsServer = new WebSocketServer({ noServer: true });

const whatsappWsClients = new Set();

const WHATSAPP_VERIFY_TOKEN = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();

const WHATSAPP_ACCESS_TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '').trim();

const WHATSAPP_PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

const WHATSAPP_GRAPH_VERSION = String(process.env.WHATSAPP_GRAPH_VERSION || 'v20.0').trim();

const WHATSAPP_API_BASE = String(process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').trim();

const WHATSAPP_APP_SECRET = String(process.env.WHATSAPP_APP_SECRET || '').trim();

const WHATSAPP_OUTBOUND_TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'location', 'contacts', 'interactive', 'template']);

const WHATSAPP_PIPELINE_STAGES = ['new', 'qualified', 'quoted', 'negotiation', 'won', 'lost'];

const WHATSAPP_FOLLOWUP_STATUSES = ['pending', 'done', 'cancelled'];

const WHATSAPP_MEDIA_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;

const whatsappMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: WHATSAPP_MEDIA_UPLOAD_MAX_BYTES
  }
});

let whatsappWsGatewayReady = false;

const normalizeWhatsAppPhone = (value = '') => String(value || '').replace(/\D/g, '').trim();

const normalizeWhatsAppPipelineStage = (value = '') => {
  const stage = String(value || '').trim().toLowerCase();
  return WHATSAPP_PIPELINE_STAGES.includes(stage) ? stage : 'new';
};

const normalizeWhatsAppFollowupStatus = (value = '') => {
  const status = String(value || '').trim().toLowerCase();
  return WHATSAPP_FOLLOWUP_STATUSES.includes(status) ? status : 'pending';
};

const guessWhatsAppMessageTypeFromMime = (mimeType = '', filename = '') => {
  const mime = String(mimeType || '').trim().toLowerCase();
  const lowerName = String(filename || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'document';
  if (mime) return 'document';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(lowerName)) return 'image';
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(lowerName)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(lowerName)) return 'audio';
  return 'document';
};

const notifyWhatsAppInboxRealtime = (event, payload = {}) => {
  if (!event || whatsappWsClients.size === 0) return;
  const message = JSON.stringify({
    channel: 'whatsapp_inbox',
    event: String(event).trim(),
    payload,
    emitted_at: new Date().toISOString()
  });
  for (const client of whatsappWsClients) {
    if (!client || client.readyState !== 1) continue;
    try {
      client.send(message);
    } catch {
      // ignore individual websocket delivery failures
    }
  }
};

const resolveWebSocketToken = (requestUrl, authHeader = '', hostHeader = 'localhost') => {
  const parsedUrl = new URL(String(requestUrl || '/'), `http://${hostHeader}`);
  const tokenFromQuery = String(parsedUrl.searchParams.get('token') || '').trim();
  if (tokenFromQuery) return tokenFromQuery;
  const header = String(authHeader || '').trim();
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return '';
};

const authenticateWhatsAppWsClient = async (token) => {
  if (!token) throw createHttpError(401, 'Token requerido');
  let decoded = null;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw createHttpError(403, 'Token inválido');
  }
  const userId = Number(decoded?.id || 0);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createHttpError(403, 'Token inválido');
  }
  const userRes = await pool.query(
    `SELECT id, email, role, panel_access, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  if (userRes.rowCount === 0 || !userRes.rows[0].is_active) {
    throw createHttpError(403, 'Usuario no autorizado');
  }
  const userRow = userRes.rows[0];
  if (normalizeRole(userRow.role || '') !== ROLE_KEYS.admin) {
    throw createHttpError(403, 'Permisos insuficientes');
  }
  return {
    id: Number(userRow.id),
    email: String(userRow.email || '').trim(),
    role: String(userRow.role || '').trim(),
    panel_access: userRow.panel_access || null
  };
};

const initWhatsAppInboxWebSocketGateway = (httpServer) => {
  if (whatsappWsGatewayReady) return;
  whatsappWsGatewayReady = true;

  whatsappWsServer.on('connection', (socket, request, user) => {
    socket.user = user || null;
    whatsappWsClients.add(socket);
    try {
      socket.send(JSON.stringify({
        channel: 'whatsapp_inbox',
        event: 'connected',
        payload: {
          user_id: user?.id || null
        },
        emitted_at: new Date().toISOString()
      }));
    } catch {
      // ignore immediate send error
    }
    socket.on('close', () => {
      whatsappWsClients.delete(socket);
    });
    socket.on('error', () => {
      whatsappWsClients.delete(socket);
    });
    socket.on('message', (raw) => {
      const message = String(raw || '').trim().toLowerCase();
      if (message === 'ping') {
        try {
          socket.send(JSON.stringify({
            channel: 'whatsapp_inbox',
            event: 'pong',
            payload: {},
            emitted_at: new Date().toISOString()
          }));
        } catch {
          // ignore ping response failure
        }
      }
    });
    if (request && typeof request.on === 'function') {
      request.on('close', () => {
        whatsappWsClients.delete(socket);
      });
    }
  });

  httpServer.on('upgrade', async (request, socket, head) => {
    const hostHeader = String(request.headers.host || 'localhost').trim() || 'localhost';
    const parsedUrl = new URL(String(request.url || '/'), `http://${hostHeader}`);
    if (parsedUrl.pathname !== '/ws/whatsapp/inbox') {
      socket.destroy();
      return;
    }
    try {
      const token = resolveWebSocketToken(request.url, request.headers.authorization, hostHeader);
      const user = await authenticateWhatsAppWsClient(token);
      whatsappWsServer.handleUpgrade(request, socket, head, (ws) => {
        whatsappWsServer.emit('connection', ws, request, user);
      });
    } catch {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      } catch {
        // ignore socket write errors
      }
      socket.destroy();
    }
  });
};

const getWhatsAppMessagePreviewFromPayload = (payload = {}) => {
  const type = String(payload?.type || '').trim().toLowerCase();
  if (type === 'text') return String(payload?.text?.body || '').trim();
  if (type === 'image') return String(payload?.image?.caption || '').trim() || '[Imagen]';
  if (type === 'video') return String(payload?.video?.caption || '').trim() || '[Video]';
  if (type === 'audio') return '[Audio]';
  if (type === 'document') {
    const caption = String(payload?.document?.caption || '').trim();
    const filename = String(payload?.document?.filename || '').trim();
    return caption || filename || '[Documento]';
  }
  if (type === 'location') {
    const name = String(payload?.location?.name || '').trim();
    if (name) return `[Ubicación] ${name}`;
    const latitude = Number(payload?.location?.latitude);
    const longitude = Number(payload?.location?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `[Ubicación] ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
    return '[Ubicación]';
  }
  if (type === 'contacts') {
    const first = Array.isArray(payload?.contacts) ? payload.contacts[0] : null;
    const displayName = String(first?.name?.formatted_name || '').trim();
    return displayName ? `[Contacto] ${displayName}` : '[Contacto]';
  }
  if (type === 'interactive') {
    const bodyText = String(payload?.interactive?.body?.text || '').trim();
    const interactiveType = String(payload?.interactive?.type || '').trim();
    if (bodyText) return bodyText;
    if (interactiveType) return `[Interactivo: ${interactiveType}]`;
    return '[Interactivo]';
  }
  if (type === 'template') {
    const templateName = String(payload?.template?.name || '').trim();
    return templateName ? `[Plantilla] ${templateName}` : '[Plantilla]';
  }
  const fallbackType = String(type || 'mensaje').trim();
  return fallbackType ? `[${fallbackType}]` : '';
};

const extractWhatsAppTextBody = (message = {}) => {
  if (!message || typeof message !== 'object') return '';
  if (message.type === 'text') return String(message?.text?.body || '').trim();
  if (message.type === 'button') return String(message?.button?.text || '').trim();
  if (message.type === 'interactive') {
    const buttonReply = String(message?.interactive?.button_reply?.title || '').trim();
    if (buttonReply) return buttonReply;
    const listReply = String(message?.interactive?.list_reply?.title || '').trim();
    if (listReply) return listReply;
    const interactiveBody = String(message?.interactive?.body?.text || '').trim();
    if (interactiveBody) return interactiveBody;
  }
  if (message.type === 'location') {
    const name = String(message?.location?.name || '').trim();
    const address = String(message?.location?.address || '').trim();
    const latitude = Number(message?.location?.latitude);
    const longitude = Number(message?.location?.longitude);
    if (name) return `[Ubicación] ${name}`;
    if (address) return `[Ubicación] ${address}`;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `[Ubicación] ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
    return '[Ubicación]';
  }
  if (message.type === 'contacts') {
    const firstContact = Array.isArray(message?.contacts) ? message.contacts[0] : null;
    const fullName = String(firstContact?.name?.formatted_name || '').trim();
    return fullName ? `[Contacto] ${fullName}` : '[Contacto]';
  }
  if (message.type === 'image') return String(message?.image?.caption || '').trim() || '[Imagen]';
  if (message.type === 'video') return String(message?.video?.caption || '').trim() || '[Video]';
  if (message.type === 'audio') return '[Audio]';
  if (message.type === 'document') {
    return String(message?.document?.caption || '').trim()
      || String(message?.document?.filename || '').trim()
      || '[Documento]';
  }
  if (message.type === 'sticker') return '[Sticker]';
  if (message.type === 'reaction') return String(message?.reaction?.emoji || '').trim() || '[Reacción]';
  const fallbackType = String(message.type || 'mensaje').trim();
  return fallbackType ? `[${fallbackType}]` : '';
};

const buildOutboundWhatsAppPayload = ({ toPhone, body = {} }) => {
  const to = normalizeWhatsAppPhone(toPhone);
  if (!to) throw createHttpError(400, 'Número de destino inválido');

  const directPayload = parseJsonInput(body?.payload, { expected: 'object', fieldLabel: 'payload' });
  if (directPayload) {
    const type = String(directPayload.type || '').trim().toLowerCase();
    if (!WHATSAPP_OUTBOUND_TYPES.has(type)) {
      throw createHttpError(400, 'payload.type no está soportado');
    }
    const payload = {
      ...directPayload,
      messaging_product: 'whatsapp',
      to,
      type
    };
    return {
      payload,
      messageType: type,
      previewText: getWhatsAppMessagePreviewFromPayload(payload)
    };
  }

  const type = String(body?.type || 'text').trim().toLowerCase();
  if (!WHATSAPP_OUTBOUND_TYPES.has(type)) {
    throw createHttpError(
      400,
      'Tipo de mensaje no soportado. Usa text, image, video, audio, document, location, contacts, interactive o template'
    );
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type
  };

  if (type === 'text') {
    const textBody = typeof body?.text === 'string'
      ? body.text
      : String(body?.text?.body || body?.body || '').trim();
    if (!textBody) throw createHttpError(400, 'El mensaje de texto no puede estar vacío');
    payload.text = {
      body: textBody,
      preview_url: parseOptionalBoolean(body?.preview_url ?? body?.previewUrl, false)
    };
  } else if (['image', 'video', 'audio', 'document'].includes(type)) {
    const mediaLink = String(body?.media_url || body?.mediaUrl || body?.url || '').trim();
    const mediaId = String(body?.media_id || body?.mediaId || body?.id || '').trim();
    if (!mediaLink && !mediaId) {
      throw createHttpError(400, `Para ${type} debes enviar media_url o media_id`);
    }
    payload[type] = {};
    if (mediaLink) payload[type].link = mediaLink;
    if (mediaId) payload[type].id = mediaId;
    const caption = String(body?.caption || '').trim();
    if (caption && (type === 'image' || type === 'video' || type === 'document')) {
      payload[type].caption = caption;
    }
    if (type === 'document') {
      const filename = String(body?.filename || '').trim();
      if (filename) payload.document.filename = filename;
    }
  } else if (type === 'location') {
    const location = parseJsonInput(body?.location, { expected: 'object', fieldLabel: 'location' }) || body;
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw createHttpError(400, 'Ubicación inválida: latitude y longitude son requeridos');
    }
    payload.location = {
      latitude,
      longitude
    };
    const name = String(location?.name || '').trim();
    const address = String(location?.address || '').trim();
    if (name) payload.location.name = name;
    if (address) payload.location.address = address;
  } else if (type === 'contacts') {
    const contacts = parseJsonInput(body?.contacts, { expected: 'array', fieldLabel: 'contacts' })
      || (Array.isArray(body?.contact) ? body.contact : (body?.contact ? [body.contact] : null));
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw createHttpError(400, 'Debes enviar al menos un contacto en contacts');
    }
    payload.contacts = contacts;
  } else if (type === 'interactive') {
    const interactive = parseJsonInput(body?.interactive, { expected: 'object', fieldLabel: 'interactive' });
    if (!interactive || !String(interactive?.type || '').trim()) {
      throw createHttpError(400, 'interactive.type es requerido para mensajes interactivos');
    }
    payload.interactive = interactive;
  } else if (type === 'template') {
    const template = parseJsonInput(body?.template, { expected: 'object', fieldLabel: 'template' });
    if (template) {
      if (!String(template?.name || '').trim()) throw createHttpError(400, 'template.name es requerido');
      if (!String(template?.language?.code || '').trim()) throw createHttpError(400, 'template.language.code es requerido');
      payload.template = template;
    } else {
      const templateName = String(body?.template_name || body?.templateName || '').trim();
      const languageCode = String(body?.template_language_code || body?.templateLanguageCode || body?.language_code || 'es').trim();
      const components = parseJsonInput(
        body?.template_components ?? body?.templateComponents,
        { expected: 'array', fieldLabel: 'template_components' }
      ) || [];
      if (!templateName) throw createHttpError(400, 'template_name es requerido');
      payload.template = {
        name: templateName,
        language: { code: languageCode || 'es' }
      };
      if (components.length > 0) payload.template.components = components;
    }
  }

  return {
    payload,
    messageType: type,
    previewText: getWhatsAppMessagePreviewFromPayload(payload)
  };
};

const sendWhatsAppMessage = async ({ payload }) => {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw createHttpError(500, 'Configuración de WhatsApp incompleta en el servidor');
  }
  if (!payload || typeof payload !== 'object') {
    throw createHttpError(400, 'Payload de WhatsApp inválido');
  }

  const url = `${WHATSAPP_API_BASE}/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = responsePayload?.error?.message || `WhatsApp API error ${response.status}`;
    throw createHttpError(response.status || 500, message);
  }
  const waMessageId = String(responsePayload?.messages?.[0]?.id || '').trim() || null;
  return {
    wa_message_id: waMessageId,
    raw_response: responsePayload
  };
};

const uploadMediaToWhatsApp = async ({ fileBuffer, mimeType = '', filename = '' }) => {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw createHttpError(500, 'Configuración de WhatsApp incompleta en el servidor');
  }
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw createHttpError(400, 'Archivo inválido para subir a WhatsApp');
  }
  const safeMimeType = String(mimeType || '').trim() || 'application/octet-stream';
  const safeFilename = String(filename || '').trim() || 'archivo.bin';
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', safeMimeType);
  formData.append('file', new Blob([fileBuffer], { type: safeMimeType }), safeFilename);

  const url = `${WHATSAPP_API_BASE}/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/media`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`
    },
    body: formData
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `WhatsApp media upload error ${response.status}`;
    throw createHttpError(response.status || 500, message);
  }
  return payload;
};

const fetchWhatsAppMediaMeta = async (mediaId) => {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw createHttpError(500, 'Configuración de WhatsApp incompleta en el servidor');
  }
  const cleanMediaId = String(mediaId || '').trim();
  if (!cleanMediaId) throw createHttpError(400, 'media_id inválido');
  const url = `${WHATSAPP_API_BASE}/${WHATSAPP_GRAPH_VERSION}/${cleanMediaId}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `WhatsApp media meta error ${response.status}`;
    throw createHttpError(response.status || 500, message);
  }
  return payload || {};
};

const fetchWhatsAppMediaBinary = async (mediaUrl) => {
  if (!WHATSAPP_ACCESS_TOKEN) {
    throw createHttpError(500, 'Configuración de WhatsApp incompleta en el servidor');
  }
  const cleanUrl = String(mediaUrl || '').trim();
  if (!cleanUrl) throw createHttpError(400, 'URL de media inválida');
  const response = await fetch(cleanUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`
    }
  });
  if (!response.ok) {
    throw createHttpError(response.status || 500, `No se pudo descargar media de WhatsApp (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const bodyBuffer = Buffer.from(arrayBuffer);
  return {
    buffer: bodyBuffer,
    contentType: String(response.headers.get('content-type') || '').trim() || null,
    contentLength: response.headers.get('content-length')
  };
};

let whatsappInboxInitPromise = null;

const ensureWhatsAppInboxTables = async () => {
  if (!whatsappInboxInitPromise) {
    whatsappInboxInitPromise = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_contacts (
          id BIGSERIAL PRIMARY KEY,
          wa_phone TEXT NOT NULL UNIQUE,
          profile_name TEXT,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_conversations (
          id BIGSERIAL PRIMARY KEY,
          contact_id BIGINT NOT NULL UNIQUE REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open',
          assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          unread_count INTEGER NOT NULL DEFAULT 0,
          last_message_preview TEXT,
          last_message_at TIMESTAMP WITHOUT TIME ZONE,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_conversations_status_chk CHECK (status IN ('open', 'closed'))
        )`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message_at
         ON whatsapp_conversations (last_message_at DESC NULLS LAST)`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_messages (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
          wa_message_id TEXT,
          direction TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          text_body TEXT,
          status TEXT,
          from_phone TEXT,
          to_phone TEXT,
          raw_payload JSONB,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_messages_direction_chk CHECK (direction IN ('inbound', 'outbound'))
        )`
      );
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_wa_message_id
         ON whatsapp_messages (wa_message_id)
         WHERE wa_message_id IS NOT NULL`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created
         ON whatsapp_messages (conversation_id, created_at ASC, id ASC)`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_assignment_logs (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
          previous_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NOT NULL DEFAULT 'auto_round_robin',
          changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_round_robin_state (
          singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
          last_assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_round_robin_singleton_chk CHECK (singleton_id = 1)
        )`
      );
      await pool.query(
        `INSERT INTO whatsapp_round_robin_state (singleton_id, last_assigned_user_id, updated_at)
         VALUES (1, NULL, NOW())
         ON CONFLICT (singleton_id) DO NOTHING`
      );
      await pool.query(
        `ALTER TABLE whatsapp_conversations
         ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'new'`
      );
      await pool.query(
        `ALTER TABLE whatsapp_conversations
         DROP CONSTRAINT IF EXISTS whatsapp_conversations_pipeline_stage_chk`
      );
      await pool.query(
        `ALTER TABLE whatsapp_conversations
         ADD CONSTRAINT whatsapp_conversations_pipeline_stage_chk
         CHECK (pipeline_stage IN ('new', 'qualified', 'quoted', 'negotiation', 'won', 'lost'))`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_followup_tasks (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
          assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          note TEXT,
          due_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          completed_at TIMESTAMP WITHOUT TIME ZONE,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_followup_tasks_status_chk CHECK (status IN ('pending', 'done', 'cancelled'))
        )`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_whatsapp_followup_tasks_conversation
         ON whatsapp_followup_tasks (conversation_id, status, due_at ASC)`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_whatsapp_followup_tasks_due_pending
         ON whatsapp_followup_tasks (due_at ASC)
         WHERE status = 'pending'`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS whatsapp_quick_replies (
          id BIGSERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          reply_type TEXT NOT NULL DEFAULT 'text',
          body_text TEXT,
          template_name TEXT,
          template_language_code TEXT NOT NULL DEFAULT 'es',
          template_components JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_quick_replies_type_chk CHECK (reply_type IN ('text', 'template'))
        )`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_whatsapp_quick_replies_active
         ON whatsapp_quick_replies (is_active, reply_type, title ASC)`
      );
    })();
  }
  await whatsappInboxInitPromise;
};

const verifyWhatsAppWebhookSignature = (req) => {
  if (!WHATSAPP_APP_SECRET) return true;
  const signatureHeader = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  if (!req.rawBody) return false;
  const expectedHash = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');
  const expected = `sha256=${expectedHash}`;
  const sigBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
};

const loadEligibleWhatsAppSalesUsers = async (client = null) => {
  const db = client || pool;
  const result = await db.query(
    `SELECT id, email, display_name, role, city
     FROM users
     WHERE is_active = TRUE
       AND (
         LOWER(role) = 'ventas'
         OR LOWER(role) = 'ventas lider'
       )
     ORDER BY id ASC`
  );
  return result.rows || [];
};

const assignConversationRoundRobin = async (client, conversationId, { reason = 'auto_round_robin', changedBy = null } = {}) => {
  const salesUsers = await loadEligibleWhatsAppSalesUsers(client);
  if (salesUsers.length === 0) return null;

  const lockRes = await client.query(
    `SELECT singleton_id, last_assigned_user_id
     FROM whatsapp_round_robin_state
     WHERE singleton_id = 1
     FOR UPDATE`
  );
  let lastAssigned = lockRes.rows[0]?.last_assigned_user_id
    ? Number(lockRes.rows[0].last_assigned_user_id)
    : null;
  const currentIndex = salesUsers.findIndex((row) => Number(row.id) === lastAssigned);
  const nextUser = currentIndex >= 0
    ? salesUsers[(currentIndex + 1) % salesUsers.length]
    : salesUsers[0];
  const nextUserId = Number(nextUser.id);

  const previousRes = await client.query(
    `SELECT assigned_user_id
     FROM whatsapp_conversations
     WHERE id = $1
     FOR UPDATE`,
    [conversationId]
  );
  if (previousRes.rowCount === 0) return null;
  const previousUserId = previousRes.rows[0]?.assigned_user_id ? Number(previousRes.rows[0].assigned_user_id) : null;

  await client.query(
    `UPDATE whatsapp_conversations
     SET assigned_user_id = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [conversationId, nextUserId]
  );
  await client.query(
    `UPDATE whatsapp_round_robin_state
     SET last_assigned_user_id = $1,
         updated_at = NOW()
     WHERE singleton_id = 1`,
    [nextUserId]
  );
  await client.query(
    `INSERT INTO whatsapp_assignment_logs (
      conversation_id,
      previous_user_id,
      assigned_user_id,
      reason,
      changed_by
    ) VALUES ($1, $2, $3, $4, $5)`,
    [conversationId, previousUserId, nextUserId, reason, changedBy]
  );
  return nextUserId;
};

const processInboundWhatsAppMessage = async (message = {}, contactsByWaId = new Map()) => {
  const fromPhone = normalizeWhatsAppPhone(message.from || '');
  const waMessageId = String(message.id || '').trim();
  if (!fromPhone || !waMessageId) return;
  const profileName = String(contactsByWaId.get(fromPhone) || '').trim() || null;
  const textBody = extractWhatsAppTextBody(message);
  const messageType = String(message.type || 'text').trim() || 'text';
  const createdAt = Number.isFinite(Number(message.timestamp))
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();
  let broadcastPayload = null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const contactRes = await client.query(
      `INSERT INTO whatsapp_contacts (wa_phone, profile_name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (wa_phone) DO UPDATE
       SET profile_name = COALESCE(EXCLUDED.profile_name, whatsapp_contacts.profile_name),
           updated_at = NOW()
       RETURNING id`,
      [fromPhone, profileName]
    );
    const contactId = Number(contactRes.rows[0].id);

    await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [contactId]);
    const existingConvRes = await client.query(
      `SELECT id, assigned_user_id
       FROM whatsapp_conversations
       WHERE contact_id = $1
       LIMIT 1`,
      [contactId]
    );

    let conversationId = null;
    let currentlyAssigned = null;
    if (existingConvRes.rowCount > 0) {
      const convUpdateRes = await client.query(
        `UPDATE whatsapp_conversations
         SET last_message_preview = $2,
             last_message_at = $3,
             status = 'open',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, assigned_user_id`,
        [existingConvRes.rows[0].id, textBody || null, createdAt]
      );
      conversationId = Number(convUpdateRes.rows[0].id);
      currentlyAssigned = convUpdateRes.rows[0]?.assigned_user_id ? Number(convUpdateRes.rows[0].assigned_user_id) : null;
    } else {
      const convInsertRes = await client.query(
        `INSERT INTO whatsapp_conversations (
           contact_id,
           status,
           unread_count,
           last_message_preview,
           last_message_at,
           created_at,
           updated_at
         )
         VALUES ($1, 'open', 0, $2, $3, NOW(), NOW())
         RETURNING id, assigned_user_id`,
        [contactId, textBody || null, createdAt]
      );
      conversationId = Number(convInsertRes.rows[0].id);
      currentlyAssigned = convInsertRes.rows[0]?.assigned_user_id ? Number(convInsertRes.rows[0].assigned_user_id) : null;
    }

    let messageInserted = false;
    if (waMessageId) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [waMessageId]);
      const existingMessageRes = await client.query(
        `SELECT id
         FROM whatsapp_messages
         WHERE wa_message_id = $1
         LIMIT 1`,
        [waMessageId]
      );
      if (existingMessageRes.rowCount === 0) {
        await client.query(
          `INSERT INTO whatsapp_messages (
             conversation_id,
             wa_message_id,
             direction,
             message_type,
             text_body,
             status,
             from_phone,
             to_phone,
             raw_payload,
             created_at,
             updated_at
           )
           VALUES ($1, $2, 'inbound', $3, $4, 'received', $5, NULL, $6::jsonb, $7, NOW())`,
          [conversationId, waMessageId, messageType, textBody || null, fromPhone, JSON.stringify(message), createdAt]
        );
        messageInserted = true;
      }
    } else {
      await client.query(
        `INSERT INTO whatsapp_messages (
           conversation_id,
           wa_message_id,
           direction,
           message_type,
           text_body,
           status,
           from_phone,
           to_phone,
           raw_payload,
           created_at,
           updated_at
         )
         VALUES ($1, NULL, 'inbound', $2, $3, 'received', $4, NULL, $5::jsonb, $6, NOW())`,
        [conversationId, messageType, textBody || null, fromPhone, JSON.stringify(message), createdAt]
      );
      messageInserted = true;
    }

    if (messageInserted) {
      await client.query(
        `UPDATE whatsapp_conversations
         SET unread_count = COALESCE(unread_count, 0) + 1,
             last_message_preview = $2,
             last_message_at = $3,
             status = 'open',
             updated_at = NOW()
         WHERE id = $1`,
        [conversationId, textBody || null, createdAt]
      );
      if (!currentlyAssigned) {
        await assignConversationRoundRobin(client, conversationId, { reason: 'auto_round_robin_inbound', changedBy: null });
      }
      broadcastPayload = {
        conversation_id: conversationId,
        wa_message_id: waMessageId || null,
        direction: 'inbound',
        message_type: messageType
      };
    }

    await client.query('COMMIT');
    if (broadcastPayload) {
      notifyWhatsAppInboxRealtime('message_created', broadcastPayload);
      notifyWhatsAppInboxRealtime('conversation_updated', {
        conversation_id: conversationId,
        reason: 'inbound_message'
      });
      notifyWhatsAppInboxRealtime('kpi_updated', {
        reason: 'inbound_message'
      });
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('WhatsApp inbound rollback error:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
};

const processWhatsAppStatusUpdates = async (statuses = []) => {
  if (!Array.isArray(statuses) || statuses.length === 0) return;
  for (const statusEntry of statuses) {
    const waMessageId = String(statusEntry?.id || '').trim();
    if (!waMessageId) continue;
    const statusText = String(statusEntry?.status || '').trim() || null;
    const timestamp = Number.isFinite(Number(statusEntry?.timestamp))
      ? new Date(Number(statusEntry.timestamp) * 1000)
      : new Date();
    const updateRes = await pool.query(
      `UPDATE whatsapp_messages
       SET status = COALESCE($2, status),
           updated_at = $3
       WHERE wa_message_id = $1
       RETURNING conversation_id, wa_message_id, status`,
      [waMessageId, statusText, timestamp]
    );
    for (const row of (updateRes.rows || [])) {
      notifyWhatsAppInboxRealtime('message_status', {
        conversation_id: Number(row.conversation_id),
        wa_message_id: String(row.wa_message_id || '').trim() || waMessageId,
        status: String(row.status || statusText || '').trim() || null
      });
    }
    if (updateRes.rowCount > 0) {
      notifyWhatsAppInboxRealtime('kpi_updated', {
        reason: 'message_status'
      });
    }
  }
};

module.exports = {
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_API_BASE,
  WHATSAPP_APP_SECRET,
  WHATSAPP_FOLLOWUP_STATUSES,
  WHATSAPP_GRAPH_VERSION,
  WHATSAPP_MEDIA_UPLOAD_MAX_BYTES,
  WHATSAPP_OUTBOUND_TYPES,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_PIPELINE_STAGES,
  WHATSAPP_VERIFY_TOKEN,
  assignConversationRoundRobin,
  authenticateWhatsAppWsClient,
  buildOutboundWhatsAppPayload,
  ensureWhatsAppInboxTables,
  extractWhatsAppTextBody,
  fetchWhatsAppMediaBinary,
  fetchWhatsAppMediaMeta,
  getWhatsAppMessagePreviewFromPayload,
  guessWhatsAppMessageTypeFromMime,
  initWhatsAppInboxWebSocketGateway,
  loadEligibleWhatsAppSalesUsers,
  normalizeWhatsAppFollowupStatus,
  normalizeWhatsAppPhone,
  normalizeWhatsAppPipelineStage,
  notifyWhatsAppInboxRealtime,
  processInboundWhatsAppMessage,
  processWhatsAppStatusUpdates,
  resolveWebSocketToken,
  sendWhatsAppMessage,
  uploadMediaToWhatsApp,
  verifyWhatsAppWebhookSignature,
  whatsappInboxInitPromise,
  whatsappMediaUpload,
  whatsappWsClients,
  whatsappWsGatewayReady,
  whatsappWsServer
};
