const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { resolveUserDisplayName } = require('../lib/users');
const { createHttpError, parseJsonInput, parseOptionalBoolean } = require('../lib/util');
const { WHATSAPP_MEDIA_UPLOAD_MAX_BYTES, WHATSAPP_PIPELINE_STAGES, WHATSAPP_VERIFY_TOKEN, assignConversationRoundRobin, buildOutboundWhatsAppPayload, fetchWhatsAppMediaBinary, fetchWhatsAppMediaMeta, guessWhatsAppMessageTypeFromMime, loadEligibleWhatsAppSalesUsers, normalizeWhatsAppFollowupStatus, normalizeWhatsAppPhone, normalizeWhatsAppPipelineStage, notifyWhatsAppInboxRealtime, processInboundWhatsAppMessage, processWhatsAppStatusUpdates, sendWhatsAppMessage, uploadMediaToWhatsApp, verifyWhatsAppWebhookSignature, whatsappMediaUpload } = require('../lib/whatsapp');

const router = express.Router();

// ─── WHATSAPP WEBHOOK (META DIRECT) ─────────────────────────────────────────
router.get('/api/whatsapp/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge || ''));
  }
  return res.status(403).json({ error: 'Webhook verify token inválido' });
});

router.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    if (!verifyWhatsAppWebhookSignature(req)) {
      return res.status(403).json({ error: 'Firma de webhook inválida' });
    }
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        if (String(change?.field || '').trim() !== 'messages') continue;
        const value = change?.value || {};
        const contactsByWaId = new Map();
        for (const contact of (Array.isArray(value?.contacts) ? value.contacts : [])) {
          const waId = normalizeWhatsAppPhone(contact?.wa_id || '');
          if (!waId) continue;
          contactsByWaId.set(waId, String(contact?.profile?.name || '').trim());
        }

        const inboundMessages = Array.isArray(value?.messages) ? value.messages : [];
        for (const message of inboundMessages) {
          await processInboundWhatsAppMessage(message, contactsByWaId);
        }
        const statusUpdates = Array.isArray(value?.statuses) ? value.statuses : [];
        await processWhatsAppStatusUpdates(statusUpdates);
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    return res.status(500).json({ error: 'No se pudo procesar webhook de WhatsApp' });
  }
});

// ─── WHATSAPP ADMIN INBOX ────────────────────────────────────────────────────
router.post(
  '/api/whatsapp/inbox/media/upload',
  authenticateToken,
  requireRole(['admin']),
  (req, res, next) => {
    whatsappMediaUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `Archivo demasiado grande. Límite: ${Math.round(WHATSAPP_MEDIA_UPLOAD_MAX_BYTES / (1024 * 1024))}MB`
        });
      }
      return next(err);
    });
  },
  async (req, res) => {
    try {
      if (!req.file || !Buffer.isBuffer(req.file.buffer) || req.file.size <= 0) {
        return res.status(400).json({ error: 'Debes adjuntar un archivo en el campo file' });
      }
      const mimeType = String(req.file.mimetype || '').trim() || 'application/octet-stream';
      const filename = String(req.file.originalname || '').trim() || 'archivo.bin';
      const uploadResult = await uploadMediaToWhatsApp({
        fileBuffer: req.file.buffer,
        mimeType,
        filename
      });
      const mediaId = String(uploadResult?.id || '').trim();
      if (!mediaId) {
        return res.status(502).json({ error: 'WhatsApp no devolvió media_id para el archivo subido' });
      }
      return res.status(201).json({
        media_id: mediaId,
        mime_type: mimeType,
        filename,
        size_bytes: Number(req.file.size || 0),
        suggested_message_type: guessWhatsAppMessageTypeFromMime(mimeType, filename),
        raw_response: uploadResult
      });
    } catch (err) {
      console.error(err);
      if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
      return res.status(500).json({ error: 'No se pudo subir archivo a WhatsApp media API' });
    }
  }
);

router.get('/api/whatsapp/inbox/media/:id/meta', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const mediaId = String(req.params.id || '').trim();
    if (!mediaId) return res.status(400).json({ error: 'media_id inválido' });
    const meta = await fetchWhatsAppMediaMeta(mediaId);
    return res.json({
      id: String(meta?.id || mediaId).trim(),
      mime_type: String(meta?.mime_type || '').trim() || null,
      sha256: String(meta?.sha256 || '').trim() || null,
      file_size: Number(meta?.file_size || 0) || null,
      messaging_product: String(meta?.messaging_product || '').trim() || 'whatsapp'
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo obtener metadatos de media' });
  }
});

router.get('/api/whatsapp/inbox/media/:id/content', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const mediaId = String(req.params.id || '').trim();
    if (!mediaId) return res.status(400).json({ error: 'media_id inválido' });
    const meta = await fetchWhatsAppMediaMeta(mediaId);
    const mediaUrl = String(meta?.url || '').trim();
    if (!mediaUrl) return res.status(404).json({ error: 'Media no disponible para descarga' });

    const mediaFile = await fetchWhatsAppMediaBinary(mediaUrl);
    const mimeType = String(mediaFile.contentType || meta?.mime_type || 'application/octet-stream').trim();
    const disposition = parseOptionalBoolean(req.query.download, false) ? 'attachment' : 'inline';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.setHeader('Content-Disposition', `${disposition}; filename="${mediaId}"`);
    if (mediaFile.contentLength) {
      res.setHeader('Content-Length', String(mediaFile.contentLength));
    }
    return res.status(200).send(mediaFile.buffer);
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo descargar media de WhatsApp' });
  }
});

router.get('/api/whatsapp/inbox/conversations', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const searchRaw = String(req.query.search || '').trim();
    const searchLike = `%${searchRaw}%`;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const [conversationsRes, salesUsers] = await Promise.all([
      pool.query(
        `SELECT
           c.id,
           c.status,
           c.pipeline_stage,
           c.unread_count,
           c.last_message_preview,
           c.last_message_at,
           c.updated_at,
           ct.wa_phone AS contact_phone,
           ct.profile_name AS contact_name,
           u.id AS assigned_user_id,
           u.email AS assigned_user_email,
           u.display_name AS assigned_user_display_name,
           msg.last_inbound_at,
           msg.last_outbound_at,
           msg.first_inbound_at,
           msg.first_outbound_at,
           fu.next_followup_due_at,
           COALESCE(fu.has_overdue_followup, FALSE) AS has_overdue_followup
         FROM whatsapp_conversations c
         JOIN whatsapp_contacts ct ON ct.id = c.contact_id
         LEFT JOIN users u ON u.id = c.assigned_user_id
         LEFT JOIN LATERAL (
           SELECT
             MAX(m.created_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at,
             MAX(m.created_at) FILTER (WHERE m.direction = 'outbound') AS last_outbound_at,
             MIN(m.created_at) FILTER (WHERE m.direction = 'inbound') AS first_inbound_at,
             MIN(m.created_at) FILTER (WHERE m.direction = 'outbound') AS first_outbound_at
           FROM whatsapp_messages m
           WHERE m.conversation_id = c.id
         ) msg ON TRUE
         LEFT JOIN LATERAL (
           SELECT
             MIN(t.due_at) FILTER (WHERE t.status = 'pending') AS next_followup_due_at,
             BOOL_OR(t.status = 'pending' AND t.due_at < NOW()) AS has_overdue_followup
           FROM whatsapp_followup_tasks t
           WHERE t.conversation_id = c.id
         ) fu ON TRUE
         WHERE ($1 = '' OR ct.wa_phone ILIKE $2 OR COALESCE(ct.profile_name, '') ILIKE $2)
         ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC, c.id DESC
         LIMIT $3 OFFSET $4`,
        [searchRaw, searchLike, limit, offset]
      ),
      loadEligibleWhatsAppSalesUsers()
    ]);

    const conversations = (conversationsRes.rows || []).map((row) => ({
      id: Number(row.id),
      status: String(row.status || 'open').trim() || 'open',
      pipeline_stage: normalizeWhatsAppPipelineStage(row.pipeline_stage),
      unread_count: Number(row.unread_count || 0),
      last_message_preview: String(row.last_message_preview || '').trim() || '',
      last_message_at: row.last_message_at || null,
      last_inbound_at: row.last_inbound_at || null,
      last_outbound_at: row.last_outbound_at || null,
      first_inbound_at: row.first_inbound_at || null,
      first_outbound_at: row.first_outbound_at || null,
      next_followup_due_at: row.next_followup_due_at || null,
      has_overdue_followup: Boolean(row.has_overdue_followup),
      updated_at: row.updated_at || null,
      contact_phone: String(row.contact_phone || '').trim(),
      contact_name: String(row.contact_name || '').trim() || null,
      assigned_user_id: row.assigned_user_id !== null ? Number(row.assigned_user_id) : null,
      assigned_user_name: row.assigned_user_id
        ? resolveUserDisplayName(
            { display_name: row.assigned_user_display_name, email: row.assigned_user_email },
            'Sin asignar'
          )
        : null
    }));

    res.json({
      page,
      limit,
      conversations,
      sales_users: salesUsers.map((row) => ({
        id: Number(row.id),
        email: String(row.email || '').trim(),
        name: resolveUserDisplayName(row, 'Vendedor'),
        role: String(row.role || '').trim(),
        city: String(row.city || '').trim() || null
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar inbox de WhatsApp' });
  }
});

router.patch('/api/whatsapp/inbox/conversations/:id/pipeline', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const requestedStage = String(req.body?.pipeline_stage || '').trim().toLowerCase();
    if (!WHATSAPP_PIPELINE_STAGES.includes(requestedStage)) {
      return res.status(400).json({ error: `pipeline_stage inválido. Usa: ${WHATSAPP_PIPELINE_STAGES.join(', ')}` });
    }
    const updateRes = await pool.query(
      `UPDATE whatsapp_conversations
       SET pipeline_stage = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, pipeline_stage`,
      [conversationId, requestedStage]
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: conversationId,
      reason: 'pipeline_change',
      pipeline_stage: requestedStage
    });
    notifyWhatsAppInboxRealtime('kpi_updated', {
      reason: 'pipeline_change'
    });
    return res.json({
      message: 'Pipeline actualizado',
      conversation_id: conversationId,
      pipeline_stage: normalizeWhatsAppPipelineStage(updateRes.rows[0]?.pipeline_stage)
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo actualizar pipeline de conversación' });
  }
});

router.get('/api/whatsapp/inbox/shortcuts', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const shortcutsRes = await pool.query(
      `SELECT id, title, reply_type, body_text, template_name, template_language_code, template_components,
              is_active, created_by, updated_by, created_at, updated_at
       FROM whatsapp_quick_replies
       ORDER BY is_active DESC, reply_type ASC, title ASC, id ASC`
    );
    return res.json({
      shortcuts: (shortcutsRes.rows || []).map((row) => ({
        id: Number(row.id),
        title: String(row.title || '').trim(),
        reply_type: String(row.reply_type || 'text').trim(),
        body_text: String(row.body_text || '').trim() || '',
        template_name: String(row.template_name || '').trim() || null,
        template_language_code: String(row.template_language_code || 'es').trim() || 'es',
        template_components: Array.isArray(row.template_components) ? row.template_components : [],
        is_active: Boolean(row.is_active),
        created_by: row.created_by !== null ? Number(row.created_by) : null,
        updated_by: row.updated_by !== null ? Number(row.updated_by) : null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
      }))
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudieron cargar respuestas rápidas' });
  }
});

router.post('/api/whatsapp/inbox/shortcuts', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const replyType = String(req.body?.reply_type || 'text').trim().toLowerCase();
    if (!title) return res.status(400).json({ error: 'title es requerido' });
    if (!['text', 'template'].includes(replyType)) {
      return res.status(400).json({ error: 'reply_type inválido. Usa text o template' });
    }
    const bodyText = String(req.body?.body_text || '').trim() || null;
    const templateName = String(req.body?.template_name || '').trim() || null;
    const templateLanguageCode = String(req.body?.template_language_code || 'es').trim() || 'es';
    const templateComponents = parseJsonInput(req.body?.template_components, {
      expected: 'array',
      fieldLabel: 'template_components'
    }) || [];
    const isActive = req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
    if (replyType === 'text' && !bodyText) {
      return res.status(400).json({ error: 'body_text es requerido para respuestas tipo text' });
    }
    if (replyType === 'template' && !templateName) {
      return res.status(400).json({ error: 'template_name es requerido para respuestas tipo template' });
    }
    const insertRes = await pool.query(
      `INSERT INTO whatsapp_quick_replies (
         title, reply_type, body_text, template_name, template_language_code, template_components,
         is_active, created_by, updated_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb,
         $7, $8, $8, NOW(), NOW()
       )
       RETURNING id, title, reply_type, body_text, template_name, template_language_code, template_components, is_active, created_at, updated_at`,
      [
        title,
        replyType,
        bodyText,
        templateName,
        templateLanguageCode,
        JSON.stringify(templateComponents),
        isActive,
        req.user.id
      ]
    );
    return res.status(201).json({
      message: 'Respuesta rápida creada',
      row: {
        id: Number(insertRes.rows[0].id),
        title: String(insertRes.rows[0].title || '').trim(),
        reply_type: String(insertRes.rows[0].reply_type || '').trim(),
        body_text: String(insertRes.rows[0].body_text || '').trim() || '',
        template_name: String(insertRes.rows[0].template_name || '').trim() || null,
        template_language_code: String(insertRes.rows[0].template_language_code || 'es').trim() || 'es',
        template_components: Array.isArray(insertRes.rows[0].template_components) ? insertRes.rows[0].template_components : [],
        is_active: Boolean(insertRes.rows[0].is_active),
        created_at: insertRes.rows[0].created_at || null,
        updated_at: insertRes.rows[0].updated_at || null
      }
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo crear respuesta rápida' });
  }
});

router.patch('/api/whatsapp/inbox/shortcuts/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const shortcutId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(shortcutId) || shortcutId <= 0) return res.status(400).json({ error: 'ID inválido' });
    const currentRes = await pool.query(
      `SELECT id, title, reply_type, body_text, template_name, template_language_code, template_components, is_active
       FROM whatsapp_quick_replies
       WHERE id = $1`,
      [shortcutId]
    );
    if (currentRes.rowCount === 0) return res.status(404).json({ error: 'Respuesta rápida no encontrada' });
    const current = currentRes.rows[0];
    const replyType = req.body?.reply_type !== undefined
      ? String(req.body.reply_type || '').trim().toLowerCase()
      : String(current.reply_type || 'text').trim().toLowerCase();
    if (!['text', 'template'].includes(replyType)) {
      return res.status(400).json({ error: 'reply_type inválido. Usa text o template' });
    }
    const title = req.body?.title !== undefined
      ? String(req.body.title || '').trim()
      : String(current.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title es requerido' });
    const bodyText = req.body?.body_text !== undefined
      ? String(req.body.body_text || '').trim() || null
      : (String(current.body_text || '').trim() || null);
    const templateName = req.body?.template_name !== undefined
      ? String(req.body.template_name || '').trim() || null
      : (String(current.template_name || '').trim() || null);
    const templateLanguageCode = req.body?.template_language_code !== undefined
      ? String(req.body.template_language_code || 'es').trim() || 'es'
      : (String(current.template_language_code || 'es').trim() || 'es');
    const templateComponents = req.body?.template_components !== undefined
      ? (parseJsonInput(req.body.template_components, {
          expected: 'array',
          fieldLabel: 'template_components'
        }) || [])
      : (Array.isArray(current.template_components) ? current.template_components : []);
    const isActive = req.body?.is_active !== undefined
      ? Boolean(req.body.is_active)
      : Boolean(current.is_active);
    if (replyType === 'text' && !bodyText) {
      return res.status(400).json({ error: 'body_text es requerido para respuestas tipo text' });
    }
    if (replyType === 'template' && !templateName) {
      return res.status(400).json({ error: 'template_name es requerido para respuestas tipo template' });
    }
    const updateRes = await pool.query(
      `UPDATE whatsapp_quick_replies
       SET title = $2,
           reply_type = $3,
           body_text = $4,
           template_name = $5,
           template_language_code = $6,
           template_components = $7::jsonb,
           is_active = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, reply_type, body_text, template_name, template_language_code, template_components, is_active, created_at, updated_at`,
      [shortcutId, title, replyType, bodyText, templateName, templateLanguageCode, JSON.stringify(templateComponents), isActive, req.user.id]
    );
    return res.json({
      message: 'Respuesta rápida actualizada',
      row: {
        id: Number(updateRes.rows[0].id),
        title: String(updateRes.rows[0].title || '').trim(),
        reply_type: String(updateRes.rows[0].reply_type || '').trim(),
        body_text: String(updateRes.rows[0].body_text || '').trim() || '',
        template_name: String(updateRes.rows[0].template_name || '').trim() || null,
        template_language_code: String(updateRes.rows[0].template_language_code || 'es').trim() || 'es',
        template_components: Array.isArray(updateRes.rows[0].template_components) ? updateRes.rows[0].template_components : [],
        is_active: Boolean(updateRes.rows[0].is_active),
        created_at: updateRes.rows[0].created_at || null,
        updated_at: updateRes.rows[0].updated_at || null
      }
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo actualizar respuesta rápida' });
  }
});

router.get('/api/whatsapp/inbox/conversations/:id/followups', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const includeCompleted = parseOptionalBoolean(req.query.include_completed, false);
    const rowsRes = await pool.query(
      `SELECT
         t.id,
         t.conversation_id,
         t.assigned_user_id,
         au.email AS assigned_user_email,
         au.display_name AS assigned_user_display_name,
         t.note,
         t.due_at,
         t.status,
         t.completed_at,
         t.created_by,
         cu.email AS created_by_email,
         cu.display_name AS created_by_display_name,
         t.created_at,
         t.updated_at
       FROM whatsapp_followup_tasks t
       LEFT JOIN users au ON au.id = t.assigned_user_id
       LEFT JOIN users cu ON cu.id = t.created_by
       WHERE t.conversation_id = $1
         AND ($2::boolean OR t.status = 'pending')
       ORDER BY
         CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END ASC,
         t.due_at ASC,
         t.id ASC`,
      [conversationId, includeCompleted]
    );
    return res.json({
      followups: (rowsRes.rows || []).map((row) => ({
        id: Number(row.id),
        conversation_id: Number(row.conversation_id),
        assigned_user_id: row.assigned_user_id !== null ? Number(row.assigned_user_id) : null,
        assigned_user_name: row.assigned_user_id
          ? resolveUserDisplayName(
              { display_name: row.assigned_user_display_name, email: row.assigned_user_email },
              'Vendedor'
            )
          : null,
        note: String(row.note || '').trim() || '',
        due_at: row.due_at || null,
        status: normalizeWhatsAppFollowupStatus(row.status),
        completed_at: row.completed_at || null,
        created_by: row.created_by !== null ? Number(row.created_by) : null,
        created_by_name: row.created_by
          ? resolveUserDisplayName(
              { display_name: row.created_by_display_name, email: row.created_by_email },
              'Usuario'
            )
          : null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
      }))
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudieron cargar recordatorios de seguimiento' });
  }
});

router.post('/api/whatsapp/inbox/conversations/:id/followups', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const dueAtRaw = String(req.body?.due_at || '').trim();
    const dueAtDate = dueAtRaw ? new Date(dueAtRaw) : null;
    if (!dueAtDate || Number.isNaN(dueAtDate.getTime())) {
      return res.status(400).json({ error: 'due_at inválido. Usa formato ISO de fecha/hora' });
    }
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'note es requerido' });
    const assignedUserRaw = req.body?.assigned_user_id;
    let assignedUserId = null;
    if (assignedUserRaw !== undefined && assignedUserRaw !== null && assignedUserRaw !== '') {
      const parsedAssigned = Number.parseInt(assignedUserRaw, 10);
      if (!Number.isInteger(parsedAssigned) || parsedAssigned <= 0) {
        return res.status(400).json({ error: 'assigned_user_id inválido' });
      }
      const allowedUsers = await loadEligibleWhatsAppSalesUsers();
      if (!allowedUsers.some((row) => Number(row.id) === parsedAssigned)) {
        return res.status(400).json({ error: 'assigned_user_id no corresponde a vendedor activo' });
      }
      assignedUserId = parsedAssigned;
    }
    const status = normalizeWhatsAppFollowupStatus(req.body?.status || 'pending');
    const insertRes = await pool.query(
      `INSERT INTO whatsapp_followup_tasks (
         conversation_id,
         assigned_user_id,
         note,
         due_at,
         status,
         completed_at,
         created_by,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $5 = 'done' THEN NOW() ELSE NULL END,
         $6, NOW(), NOW()
       )
       RETURNING id, conversation_id, assigned_user_id, note, due_at, status, completed_at, created_by, created_at, updated_at`,
      [conversationId, assignedUserId, note, dueAtDate, status, req.user.id]
    );
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: conversationId,
      reason: 'followup_created'
    });
    notifyWhatsAppInboxRealtime('kpi_updated', {
      reason: 'followup_created'
    });
    return res.status(201).json({
      message: 'Seguimiento creado',
      row: {
        id: Number(insertRes.rows[0].id),
        conversation_id: Number(insertRes.rows[0].conversation_id),
        assigned_user_id: insertRes.rows[0].assigned_user_id !== null ? Number(insertRes.rows[0].assigned_user_id) : null,
        note: String(insertRes.rows[0].note || '').trim() || '',
        due_at: insertRes.rows[0].due_at || null,
        status: normalizeWhatsAppFollowupStatus(insertRes.rows[0].status),
        completed_at: insertRes.rows[0].completed_at || null,
        created_by: insertRes.rows[0].created_by !== null ? Number(insertRes.rows[0].created_by) : null,
        created_at: insertRes.rows[0].created_at || null,
        updated_at: insertRes.rows[0].updated_at || null
      }
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo crear seguimiento' });
  }
});

router.patch('/api/whatsapp/inbox/followups/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const followupId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(followupId) || followupId <= 0) {
      return res.status(400).json({ error: 'ID de seguimiento inválido' });
    }
    const currentRes = await pool.query(
      `SELECT id, conversation_id, assigned_user_id, note, due_at, status
       FROM whatsapp_followup_tasks
       WHERE id = $1`,
      [followupId]
    );
    if (currentRes.rowCount === 0) return res.status(404).json({ error: 'Seguimiento no encontrado' });
    const current = currentRes.rows[0];

    let assignedUserId = current.assigned_user_id !== null ? Number(current.assigned_user_id) : null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assigned_user_id')) {
      const assignedRaw = req.body.assigned_user_id;
      if (assignedRaw === null || assignedRaw === '' || assignedRaw === undefined) {
        assignedUserId = null;
      } else {
        const parsedAssigned = Number.parseInt(assignedRaw, 10);
        if (!Number.isInteger(parsedAssigned) || parsedAssigned <= 0) {
          return res.status(400).json({ error: 'assigned_user_id inválido' });
        }
        const allowedUsers = await loadEligibleWhatsAppSalesUsers();
        if (!allowedUsers.some((row) => Number(row.id) === parsedAssigned)) {
          return res.status(400).json({ error: 'assigned_user_id no corresponde a vendedor activo' });
        }
        assignedUserId = parsedAssigned;
      }
    }

    const note = Object.prototype.hasOwnProperty.call(req.body || {}, 'note')
      ? String(req.body?.note || '').trim()
      : String(current.note || '').trim();
    const dueAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'due_at')
      ? new Date(String(req.body?.due_at || '').trim())
      : new Date(current.due_at);
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      return res.status(400).json({ error: 'due_at inválido. Usa formato ISO de fecha/hora' });
    }
    const status = Object.prototype.hasOwnProperty.call(req.body || {}, 'status')
      ? normalizeWhatsAppFollowupStatus(req.body?.status)
      : normalizeWhatsAppFollowupStatus(current.status);
    const updateRes = await pool.query(
      `UPDATE whatsapp_followup_tasks
       SET assigned_user_id = $2,
           note = $3,
           due_at = $4,
           status = $5,
           completed_at = CASE
             WHEN $5 = 'done' THEN COALESCE(completed_at, NOW())
             WHEN $5 = 'pending' THEN NULL
             ELSE completed_at
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, conversation_id, assigned_user_id, note, due_at, status, completed_at, created_by, created_at, updated_at`,
      [followupId, assignedUserId, note, dueAt, status]
    );
    const updated = updateRes.rows[0];
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: Number(updated.conversation_id),
      reason: 'followup_updated'
    });
    notifyWhatsAppInboxRealtime('kpi_updated', {
      reason: 'followup_updated'
    });
    return res.json({
      message: 'Seguimiento actualizado',
      row: {
        id: Number(updated.id),
        conversation_id: Number(updated.conversation_id),
        assigned_user_id: updated.assigned_user_id !== null ? Number(updated.assigned_user_id) : null,
        note: String(updated.note || '').trim() || '',
        due_at: updated.due_at || null,
        status: normalizeWhatsAppFollowupStatus(updated.status),
        completed_at: updated.completed_at || null,
        created_by: updated.created_by !== null ? Number(updated.created_by) : null,
        created_at: updated.created_at || null,
        updated_at: updated.updated_at || null
      }
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo actualizar seguimiento' });
  }
});

router.get('/api/whatsapp/inbox/conversations/:id/customer-360', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const conversationRes = await pool.query(
      `SELECT c.id, c.contact_id, ct.wa_phone, ct.profile_name
       FROM whatsapp_conversations c
       JOIN whatsapp_contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1`,
      [conversationId]
    );
    if (conversationRes.rowCount === 0) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    const conversation = conversationRes.rows[0];
    const contactPhone = normalizeWhatsAppPhone(conversation.wa_phone || '');
    if (!contactPhone) {
      return res.json({
        contact: {
          phone: '',
          name: String(conversation.profile_name || '').trim() || null
        },
        summary: {
          quotes_total: 0,
          closed_quotes: 0,
          closed_amount_bs: 0,
          last_quote_at: null
        },
        recent_quotes: [],
        top_products: []
      });
    }

    const quotesRes = await pool.query(
      `SELECT
         q.id,
         q.customer_name,
         q.customer_phone,
         q.alternative_name,
         q.alternative_phone,
         q.department,
         q.provincia,
         q.store_location,
         q.vendor,
         q.status,
         q.total,
         q.created_at,
         q.line_items
       FROM quotes q
       WHERE regexp_replace(COALESCE(q.customer_phone, ''), '\\D', '', 'g') = $1
          OR regexp_replace(COALESCE(q.alternative_phone, ''), '\\D', '', 'g') = $1
       ORDER BY q.created_at DESC
       LIMIT 60`,
      [contactPhone]
    );
    const rows = quotesRes.rows || [];
    const closedStatuses = new Set(['confirmado', 'pagado', 'embalado', 'enviado']);
    const summary = {
      quotes_total: rows.length,
      closed_quotes: 0,
      closed_amount_bs: 0,
      last_quote_at: rows[0]?.created_at || null
    };
    const productTotals = new Map();
    const parseLineItems = (lineItemsValue) => {
      if (Array.isArray(lineItemsValue)) return lineItemsValue;
      if (lineItemsValue && typeof lineItemsValue === 'object') return [lineItemsValue];
      const raw = String(lineItemsValue || '').trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    for (const row of rows) {
      const statusText = String(row.status || '').trim().toLowerCase();
      const total = Number(row.total || 0);
      if (closedStatuses.has(statusText)) {
        summary.closed_quotes += 1;
        summary.closed_amount_bs += Number.isFinite(total) ? total : 0;
      }
      const lineItems = parseLineItems(row.line_items);
      for (const item of lineItems) {
        const sku = String(item?.sku || '').trim().toUpperCase();
        const productName = String(item?.name || item?.product_name || '').trim();
        const qty = Number(item?.qty || item?.quantity || 0);
        if (!sku && !productName) continue;
        const key = sku || productName;
        const previous = productTotals.get(key) || { sku: sku || null, name: productName || key, qty: 0 };
        previous.qty += Number.isFinite(qty) ? qty : 0;
        if (!previous.name && productName) previous.name = productName;
        if (!previous.sku && sku) previous.sku = sku;
        productTotals.set(key, previous);
      }
    }
    const topProducts = [...productTotals.values()]
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
      .slice(0, 8)
      .map((item) => ({
        sku: item.sku || null,
        name: item.name || item.sku || 'Producto',
        qty: Number(item.qty || 0)
      }));
    const recentQuotes = rows.slice(0, 12).map((row) => ({
      id: Number(row.id),
      customer_name: String(row.customer_name || '').trim() || null,
      customer_phone: String(row.customer_phone || '').trim() || null,
      alternative_name: String(row.alternative_name || '').trim() || null,
      alternative_phone: String(row.alternative_phone || '').trim() || null,
      department: String(row.department || '').trim() || null,
      provincia: String(row.provincia || '').trim() || null,
      store_location: String(row.store_location || '').trim() || null,
      vendor: String(row.vendor || '').trim() || null,
      status: String(row.status || '').trim() || null,
      total: Number(row.total || 0),
      created_at: row.created_at || null
    }));
    return res.json({
      contact: {
        phone: contactPhone,
        name: String(conversation.profile_name || '').trim() || null
      },
      summary,
      recent_quotes: recentQuotes,
      top_products: topProducts
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo cargar Customer 360' });
  }
});

router.get('/api/whatsapp/inbox/kpis', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const daysRaw = Number.parseInt(req.query.days, 10);
    const days = Math.min(90, Math.max(1, Number.isInteger(daysRaw) ? daysRaw : 7));
    const sinceParam = `${days} days`;

    const [conversationSummaryRes, outboundSummaryRes, firstResponseSummaryRes, agentRowsRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total_conversations,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open_conversations,
           COALESCE(SUM(unread_count), 0)::int AS unread_messages
         FROM whatsapp_conversations`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE direction = 'outbound' AND created_at >= NOW() - $1::interval)::int AS outbound_total,
           COUNT(*) FILTER (WHERE direction = 'outbound' AND status = 'delivered' AND created_at >= NOW() - $1::interval)::int AS outbound_delivered,
           COUNT(*) FILTER (WHERE direction = 'outbound' AND status = 'read' AND created_at >= NOW() - $1::interval)::int AS outbound_read,
           COUNT(*) FILTER (WHERE direction = 'outbound' AND status = 'failed' AND created_at >= NOW() - $1::interval)::int AS outbound_failed
         FROM whatsapp_messages`,
        [sinceParam]
      ),
      pool.query(
        `WITH first_inbound AS (
           SELECT conversation_id, MIN(created_at) AS first_inbound_at
           FROM whatsapp_messages
           WHERE direction = 'inbound'
             AND created_at >= NOW() - $1::interval
           GROUP BY conversation_id
         ),
         first_response AS (
           SELECT
             fi.conversation_id,
             fi.first_inbound_at,
             MIN(m.created_at) AS first_outbound_at
           FROM first_inbound fi
           LEFT JOIN whatsapp_messages m
             ON m.conversation_id = fi.conversation_id
            AND m.direction = 'outbound'
            AND m.created_at >= fi.first_inbound_at
           GROUP BY fi.conversation_id, fi.first_inbound_at
         )
         SELECT
           COUNT(*)::int AS inbound_conversations,
           COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)::int AS responded_conversations,
           AVG(EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)) / 60.0)
             FILTER (WHERE first_outbound_at IS NOT NULL) AS avg_first_response_minutes
         FROM first_response`,
        [sinceParam]
      ),
      pool.query(
        `WITH first_inbound AS (
           SELECT conversation_id, MIN(created_at) AS first_inbound_at
           FROM whatsapp_messages
           WHERE direction = 'inbound'
             AND created_at >= NOW() - $1::interval
           GROUP BY conversation_id
         ),
         first_response AS (
           SELECT
             fi.conversation_id,
             fi.first_inbound_at,
             MIN(m.created_at) AS first_outbound_at
           FROM first_inbound fi
           LEFT JOIN whatsapp_messages m
             ON m.conversation_id = fi.conversation_id
            AND m.direction = 'outbound'
            AND m.created_at >= fi.first_inbound_at
           GROUP BY fi.conversation_id, fi.first_inbound_at
         ),
         outbound_by_agent AS (
           SELECT
             c.assigned_user_id AS user_id,
             COUNT(*)::int AS outbound_total,
             COUNT(*) FILTER (WHERE m.status = 'read')::int AS outbound_read
           FROM whatsapp_messages m
           JOIN whatsapp_conversations c ON c.id = m.conversation_id
           WHERE m.direction = 'outbound'
             AND m.created_at >= NOW() - $1::interval
           GROUP BY c.assigned_user_id
         )
         SELECT
           c.assigned_user_id AS user_id,
           COALESCE(u.display_name, u.email, 'Sin asignar') AS user_name,
           COUNT(c.id)::int AS conversations_total,
           COUNT(c.id) FILTER (WHERE c.status = 'open')::int AS open_conversations,
           COUNT(fr.conversation_id) FILTER (WHERE fr.first_outbound_at IS NOT NULL)::int AS conversations_responded,
           AVG(EXTRACT(EPOCH FROM (fr.first_outbound_at - fr.first_inbound_at)) / 60.0)
             FILTER (WHERE fr.first_outbound_at IS NOT NULL) AS avg_first_response_minutes,
           COALESCE(MAX(oba.outbound_total), 0)::int AS outbound_total,
           COALESCE(MAX(oba.outbound_read), 0)::int AS outbound_read
         FROM whatsapp_conversations c
         LEFT JOIN users u ON u.id = c.assigned_user_id
         LEFT JOIN first_response fr ON fr.conversation_id = c.id
         LEFT JOIN outbound_by_agent oba ON oba.user_id IS NOT DISTINCT FROM c.assigned_user_id
         WHERE COALESCE(c.last_message_at, c.updated_at, c.created_at) >= NOW() - $1::interval
         GROUP BY c.assigned_user_id, COALESCE(u.display_name, u.email, 'Sin asignar')
         ORDER BY conversations_total DESC, user_name ASC`,
        [sinceParam]
      )
    ]);

    const summary = conversationSummaryRes.rows[0] || {};
    const outbound = outboundSummaryRes.rows[0] || {};
    const responseSummary = firstResponseSummaryRes.rows[0] || {};
    const outboundTotal = Number(outbound.outbound_total || 0);
    const outboundRead = Number(outbound.outbound_read || 0);
    const readRate = outboundTotal > 0 ? (outboundRead / outboundTotal) * 100 : 0;

    const byAgent = (agentRowsRes.rows || []).map((row) => {
      const agentOutboundTotal = Number(row.outbound_total || 0);
      const agentOutboundRead = Number(row.outbound_read || 0);
      return {
        user_id: row.user_id !== null ? Number(row.user_id) : null,
        user_name: String(row.user_name || 'Sin asignar').trim() || 'Sin asignar',
        conversations_total: Number(row.conversations_total || 0),
        open_conversations: Number(row.open_conversations || 0),
        conversations_responded: Number(row.conversations_responded || 0),
        avg_first_response_minutes: row.avg_first_response_minutes !== null
          ? Number(row.avg_first_response_minutes)
          : null,
        outbound_total: agentOutboundTotal,
        outbound_read: agentOutboundRead,
        read_rate_percent: agentOutboundTotal > 0
          ? (agentOutboundRead / agentOutboundTotal) * 100
          : 0
      };
    });

    return res.json({
      window_days: days,
      totals: {
        total_conversations: Number(summary.total_conversations || 0),
        open_conversations: Number(summary.open_conversations || 0),
        unread_messages: Number(summary.unread_messages || 0),
        outbound_total: outboundTotal,
        outbound_delivered: Number(outbound.outbound_delivered || 0),
        outbound_read: outboundRead,
        outbound_failed: Number(outbound.outbound_failed || 0),
        read_rate_percent: readRate,
        inbound_conversations: Number(responseSummary.inbound_conversations || 0),
        responded_conversations: Number(responseSummary.responded_conversations || 0),
        avg_first_response_minutes: responseSummary.avg_first_response_minutes !== null
          ? Number(responseSummary.avg_first_response_minutes)
          : null
      },
      by_agent: byAgent
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudieron cargar KPI de WhatsApp inbox' });
  }
});

router.get('/api/whatsapp/inbox/conversations/:id/messages', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }

    const conversationRes = await pool.query(
      `SELECT
         c.id,
         c.status,
         c.pipeline_stage,
         c.unread_count,
         c.last_message_preview,
         c.last_message_at,
         c.updated_at,
         ct.wa_phone AS contact_phone,
         ct.profile_name AS contact_name,
         u.id AS assigned_user_id,
         u.email AS assigned_user_email,
         u.display_name AS assigned_user_display_name,
         msg.last_inbound_at,
         msg.last_outbound_at,
         fu.next_followup_due_at,
         COALESCE(fu.has_overdue_followup, FALSE) AS has_overdue_followup
       FROM whatsapp_conversations c
       JOIN whatsapp_contacts ct ON ct.id = c.contact_id
       LEFT JOIN users u ON u.id = c.assigned_user_id
       LEFT JOIN LATERAL (
         SELECT
           MAX(m.created_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at,
           MAX(m.created_at) FILTER (WHERE m.direction = 'outbound') AS last_outbound_at
         FROM whatsapp_messages m
         WHERE m.conversation_id = c.id
       ) msg ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           MIN(t.due_at) FILTER (WHERE t.status = 'pending') AS next_followup_due_at,
           BOOL_OR(t.status = 'pending' AND t.due_at < NOW()) AS has_overdue_followup
         FROM whatsapp_followup_tasks t
         WHERE t.conversation_id = c.id
       ) fu ON TRUE
       WHERE c.id = $1`,
      [conversationId]
    );
    if (conversationRes.rowCount === 0) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    const conversationRow = conversationRes.rows[0];

    const messagesRes = await pool.query(
      `SELECT
         id,
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
       FROM whatsapp_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC
       LIMIT 500`,
      [conversationId]
    );

    res.json({
      conversation: {
        id: Number(conversationRow.id),
        status: String(conversationRow.status || 'open').trim() || 'open',
        pipeline_stage: normalizeWhatsAppPipelineStage(conversationRow.pipeline_stage),
        unread_count: Number(conversationRow.unread_count || 0),
        contact_phone: String(conversationRow.contact_phone || '').trim(),
        contact_name: String(conversationRow.contact_name || '').trim() || null,
        assigned_user_id: conversationRow.assigned_user_id !== null ? Number(conversationRow.assigned_user_id) : null,
        assigned_user_name: conversationRow.assigned_user_id
          ? resolveUserDisplayName(
              {
                display_name: conversationRow.assigned_user_display_name,
                email: conversationRow.assigned_user_email
              },
              'Vendedor'
            )
          : null,
        last_message_preview: String(conversationRow.last_message_preview || '').trim() || '',
        last_message_at: conversationRow.last_message_at || null,
        last_inbound_at: conversationRow.last_inbound_at || null,
        last_outbound_at: conversationRow.last_outbound_at || null,
        next_followup_due_at: conversationRow.next_followup_due_at || null,
        has_overdue_followup: Boolean(conversationRow.has_overdue_followup),
        updated_at: conversationRow.updated_at || null
      },
      messages: (messagesRes.rows || []).map((row) => ({
        id: Number(row.id),
        wa_message_id: String(row.wa_message_id || '').trim() || null,
        direction: String(row.direction || '').trim(),
        message_type: String(row.message_type || '').trim() || 'text',
        text_body: String(row.text_body || '').trim(),
        status: String(row.status || '').trim() || null,
        from_phone: String(row.from_phone || '').trim() || null,
        to_phone: String(row.to_phone || '').trim() || null,
        raw_payload: row.raw_payload || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar mensajes de la conversación' });
  }
});

router.patch('/api/whatsapp/inbox/conversations/:id/read', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const result = await pool.query(
      `UPDATE whatsapp_conversations
       SET unread_count = 0,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, unread_count`,
      [conversationId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: conversationId,
      reason: 'mark_read'
    });
    return res.json({
      message: 'Conversación marcada como leída',
      id: Number(result.rows[0].id),
      unread_count: Number(result.rows[0].unread_count || 0)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de lectura' });
  }
});

router.patch('/api/whatsapp/inbox/conversations/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido. Usa open o closed' });
    }
    const result = await pool.query(
      `UPDATE whatsapp_conversations
       SET status = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status`,
      [conversationId, status]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: conversationId,
      reason: 'status_change',
      status
    });
    return res.json({
      message: 'Estado de conversación actualizado',
      id: Number(result.rows[0].id),
      status: String(result.rows[0].status || status)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de conversación' });
  }
});

router.patch('/api/whatsapp/inbox/conversations/:id/assign', authenticateToken, requireRole(['admin']), async (req, res) => {
  let client;
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const assignMode = String(req.body?.mode || '').trim().toLowerCase();
    const requestedUserIdRaw = req.body?.assigned_user_id;

    client = await pool.connect();
    await client.query('BEGIN');
    const conversationRes = await client.query(
      `SELECT id, assigned_user_id
       FROM whatsapp_conversations
       WHERE id = $1
       FOR UPDATE`,
      [conversationId]
    );
    if (conversationRes.rowCount === 0) {
      throw createHttpError(404, 'Conversación no encontrada');
    }
    const previousUserId = conversationRes.rows[0]?.assigned_user_id
      ? Number(conversationRes.rows[0].assigned_user_id)
      : null;

    let nextUserId = null;
    let reason = 'manual_assign';
    if (assignMode === 'auto' || requestedUserIdRaw === 'auto') {
      nextUserId = await assignConversationRoundRobin(client, conversationId, {
        reason: 'manual_auto_round_robin',
        changedBy: req.user.id
      });
      if (!nextUserId) {
        throw createHttpError(409, 'No hay vendedores activos para asignar');
      }
      reason = 'manual_auto_round_robin';
    } else {
      const requestedUserId = Number.parseInt(requestedUserIdRaw, 10);
      if (!Number.isInteger(requestedUserId) || requestedUserId <= 0) {
        throw createHttpError(400, 'assigned_user_id inválido');
      }
      const salesUsers = await loadEligibleWhatsAppSalesUsers(client);
      const allowed = salesUsers.some((row) => Number(row.id) === requestedUserId);
      if (!allowed) throw createHttpError(400, 'El usuario seleccionado no es vendedor activo');
      nextUserId = requestedUserId;
      await client.query(
        `UPDATE whatsapp_conversations
         SET assigned_user_id = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [conversationId, nextUserId]
      );
      await client.query(
        `INSERT INTO whatsapp_assignment_logs (
          conversation_id,
          previous_user_id,
          assigned_user_id,
          reason,
          changed_by
        ) VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, previousUserId, nextUserId, reason, req.user.id]
      );
    }

    await client.query('COMMIT');
    client.release();
    client = null;
    notifyWhatsAppInboxRealtime('conversation_assigned', {
      conversation_id: conversationId,
      assigned_user_id: nextUserId,
      reason
    });
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: conversationId,
      reason: 'assignment_change'
    });
    notifyWhatsAppInboxRealtime('kpi_updated', {
      reason: 'assignment_change'
    });

    return res.json({
      message: 'Conversación asignada',
      conversation_id: conversationId,
      assigned_user_id: nextUserId,
      reason
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('WhatsApp assign rollback error:', rollbackErr);
      }
      client.release();
    }
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo asignar conversación' });
  }
});

router.post('/api/whatsapp/inbox/conversations/:id/messages', authenticateToken, requireRole(['admin']), async (req, res) => {
  let client;
  try {
    const conversationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'ID de conversación inválido' });
    }
    const conversationRes = await pool.query(
      `SELECT
         c.id,
         c.contact_id,
         ct.wa_phone AS contact_phone
       FROM whatsapp_conversations c
       JOIN whatsapp_contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1`,
      [conversationId]
    );
    if (conversationRes.rowCount === 0) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    const contactPhone = normalizeWhatsAppPhone(conversationRes.rows[0].contact_phone || '');
    if (!contactPhone) {
      return res.status(400).json({ error: 'La conversación no tiene teléfono válido' });
    }

    const outboundPayloadData = buildOutboundWhatsAppPayload({
      toPhone: contactPhone,
      body: req.body || {}
    });
    const sendResult = await sendWhatsAppMessage({
      payload: outboundPayloadData.payload
    });
    const messageType = String(outboundPayloadData.messageType || 'text').trim() || 'text';
    const previewText = String(outboundPayloadData.previewText || '').trim()
      || `[${messageType}]`;

    client = await pool.connect();
    await client.query('BEGIN');
    const insertRes = await client.query(
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
       VALUES ($1, $2, 'outbound', $3, $4, 'sent', NULL, $5, $6::jsonb, NOW(), NOW())
       RETURNING id, wa_message_id, direction, message_type, text_body, status, from_phone, to_phone, created_at, updated_at`,
      [
        conversationId,
        sendResult.wa_message_id,
        messageType,
        previewText,
        contactPhone,
        JSON.stringify({
          request: outboundPayloadData.payload,
          response: sendResult.raw_response || {}
        })
      ]
    );
    await client.query(
      `UPDATE whatsapp_conversations
       SET last_message_preview = $2,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [conversationId, previewText]
    );
    await client.query('COMMIT');
    client.release();
    client = null;
    notifyWhatsAppInboxRealtime('message_created', {
      conversation_id: conversationId,
      wa_message_id: String(sendResult.wa_message_id || '').trim() || null,
      direction: 'outbound',
      message_type: messageType
    });
    notifyWhatsAppInboxRealtime('conversation_updated', {
      conversation_id: conversationId,
      reason: 'outbound_message'
    });
    notifyWhatsAppInboxRealtime('kpi_updated', {
      reason: 'outbound_message'
    });

    return res.status(201).json({
      message: 'Mensaje enviado',
      row: insertRes.rows[0]
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('WhatsApp send rollback error:', rollbackErr);
      }
      client.release();
    }
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo enviar mensaje de WhatsApp' });
  }
});

module.exports = router;
