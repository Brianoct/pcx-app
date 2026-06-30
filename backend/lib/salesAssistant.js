const { pool } = require('../db');
const { loadProductCatalogRows } = require('./products');
const { normalizeText } = require('./rbac');
const {
  aiChatCompletion,
  isAiConfigured,
  isTranscriptionConfigured,
  transcribeAudio,
  isVisionConfigured,
  aiVisionDescribe
} = require('./aiProvider');
const { fetchWhatsAppMediaMeta, fetchWhatsAppMediaBinary } = require('./whatsapp');
const { createHttpError } = require('./util');

const MAX_CONTEXT_MESSAGES = 20;
const MAX_CANDIDATES = 60;
const MAX_SUGGESTED = 8;
// Cap how many media items we transcribe/describe per request (bounds latency/cost).
const MAX_MEDIA_ENRICH = 4;
// If the catalog is at or below this size, send the WHOLE catalog to the model
// (so it can pick the exact product) instead of a keyword-filtered shortlist.
const MAX_FULL_CATALOG = 400;

const VISION_PROMPT = [
  'Esta es una imagen enviada por un cliente por WhatsApp. Analízala con cuidado.',
  '',
  'CASO A — Foto de NUESTRO catálogo con uno o más productos marcados/encerrados',
  '(círculos, flechas o resaltados): para CADA producto marcado, lee y transcribe',
  'EXACTAMENTE su nombre y su código/SKU impreso (por ejemplo G10N, G05C, M08N, A15N).',
  'Distingue variantes parecidas (p. ej. "Repisa/Rollo" vs "Repisa Grande") usando el',
  'nombre y código impresos. Indica claramente cuáles están encerrados.',
  '',
  'CASO B — Foto de herramientas o un espacio de trabajo (sin catálogo): nombra las',
  'herramientas u objetos visibles (martillo, llave, taladro, alicate, amoladora, etc.)',
  'para poder sugerir accesorios o soportes compatibles.',
  '',
  'Responde en español, breve y concreto. No inventes códigos: si no puedes leer un',
  'código con seguridad, transcribe solo el nombre tal como aparece.'
].join('\n');

const audioFilenameForMime = (mimeType = '') => {
  const m = String(mimeType || '').toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'audio.ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3';
  if (m.includes('wav')) return 'audio.wav';
  if (m.includes('m4a') || m.includes('mp4')) return 'audio.m4a';
  if (m.includes('webm')) return 'audio.webm';
  return 'audio.ogg';
};

// ── Pure helpers (unit-testable, no DB/network) ──────────────────────────────

const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'a',
  'en', 'para', 'por', 'con', 'que', 'cuanto', 'cuesta', 'precio', 'hola',
  'quiero', 'necesito', 'me', 'mi', 'tu', 'su', 'es', 'son', 'del', 'al',
  'tienen', 'tiene', 'hay', 'busco', 'gustaria', 'porfavor', 'favor', 'gracias'
]);

const tokenize = (text = '') =>
  normalizeText(text)
    .replace(/[^a-z0-9áéíóúñ\s]/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

// Remove media/system placeholders so we can tell whether a message carries
// real, interpretable text. Enriched media keeps its content (e.g. the prefix
// "(nota de voz)"/"(imagen)" is stripped but the transcript/description stays);
// un-interpreted media collapses to an empty string.
const stripMediaPlaceholders = (text = '') =>
  String(text || '')
    .replace(/\[(imagen|image|audio|video|documento|document|sticker|ubicaci[oó]n|location|contacto|contact|reacci[oó]n|reaction|mensaje)\]/gi, '')
    .replace(/\((nota de voz|imagen)\)/gi, '')
    .trim();

// Light Spanish stemming so plurals match singulars (the dominant case is a
// vowel-ending word + 's': tableros->tablero, grandes->grande, rojos->rojo,
// cajas->caja). Only strips a trailing 's' on words longer than 3 chars.
const stemToken = (token = '') => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token);

// Rank catalog rows by how well their name/sku/category overlap with the
// customer's words. Uses stemming (plural/singular) plus partial/substring
// matching so "tableros rojos" surfaces "Tablero ... Rojo" products. Returns
// the top `limit` rows with a positive score, or a shallow slice of the
// catalog when nothing matched (so the rep still has something to start from).
const scoreCatalogCandidates = (conversationText, catalog = [], limit = MAX_CANDIDATES) => {
  const wanted = new Set(tokenize(conversationText).map(stemToken));
  if (wanted.size === 0) {
    return catalog.slice(0, limit);
  }
  const scored = catalog.map((item) => {
    const haystack = tokenize(`${item.name} ${item.sku} ${item.menu_category || ''}`).map(stemToken);
    let score = 0;
    for (const token of haystack) {
      if (wanted.has(token)) {
        score += 2;
      } else {
        // partial/substring match for compound or near words
        for (const w of wanted) {
          if (w.length >= 4 && token.length >= 4 && (token.includes(w) || w.includes(token))) {
            score += 1;
            break;
          }
        }
      }
    }
    // strong boost for an exact sku mention
    if (wanted.has(stemToken(normalizeText(item.sku)))) score += 4;
    return { item, score };
  });
  const positive = scored.filter((entry) => entry.score > 0);
  positive.sort((a, b) => b.score - a.score);
  if (positive.length === 0) {
    return catalog.slice(0, limit);
  }
  return positive.slice(0, limit).map((entry) => entry.item);
};

const safeParseJsonObject = (raw = '') => {
  const text = String(raw || '').trim();
  if (!text) return null;
  // strip ``` / ```json code fences if present
  const fenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const candidate = fenced.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const toQty = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

// Map model-chosen SKUs onto authoritative catalog data so prices/names are
// never hallucinated. The model only picks SKUs + quantities; the server
// attaches the real name and SF price.
const attachCatalogToSuggestion = (aiJson, catalogBySku) => {
  const suggestedRaw = Array.isArray(aiJson?.suggested_skus) ? aiJson.suggested_skus : [];
  const quoteRaw = Array.isArray(aiJson?.quote_rows) ? aiJson.quote_rows : [];

  const suggested_products = [];
  const seenSuggested = new Set();
  for (const entry of suggestedRaw) {
    const sku = String(entry?.sku || '').trim().toUpperCase();
    const item = catalogBySku.get(sku);
    if (!item || seenSuggested.has(sku)) continue;
    seenSuggested.add(sku);
    suggested_products.push({
      sku: item.sku,
      name: item.name,
      sf: item.sf,
      cf: item.cf,
      reason: String(entry?.reason || '').trim().slice(0, 240)
    });
    if (suggested_products.length >= MAX_SUGGESTED) break;
  }

  const rows = [];
  const seenRows = new Set();
  for (const entry of quoteRaw) {
    const sku = String(entry?.sku || '').trim().toUpperCase();
    const item = catalogBySku.get(sku);
    if (!item || seenRows.has(sku)) continue;
    seenRows.add(sku);
    const qty = toQty(entry?.qty);
    const unitPrice = Number(item.sf || 0);
    rows.push({
      sku: item.sku,
      displayName: item.name,
      qty,
      unitPrice,
      lineTotal: Number((unitPrice * qty).toFixed(2)),
      isCombo: false
    });
  }

  return {
    reply_draft: String(aiJson?.reply_draft || '').trim(),
    suggested_products,
    quote_draft: {
      rows,
      note: String(aiJson?.notes || '').trim(),
      customer_name: String(aiJson?.customer_name || '').trim(),
      destination: String(aiJson?.destination || '').trim()
    }
  };
};

// Conservative suggestion used when the AI can't produce a real answer (no key,
// the model call failed, or the content couldn't be interpreted).
//
// Important: we do NOT guess a confident product list in the customer-facing
// reply, and we do NOT pre-fill the quote — a wrong guess is worse than none.
// When there's usable text we still offer keyword "possible matches" as an
// internal aid the rep can add manually. When the content couldn't be
// interpreted at all (e.g. an image/audio we couldn't read), we say so plainly.
const buildFallbackSuggestion = ({ contactName, candidates = [], hasUsableText = true }) => {
  const greeting = contactName ? `Hola ${contactName}, ` : 'Hola, ';
  const reply_draft = `${greeting}gracias por tu mensaje. En un momento revisamos tu solicitud y te enviamos la cotización. 🙌`;

  const top = hasUsableText ? candidates.slice(0, 5) : [];
  const suggested_products = top.map((item) => ({
    sku: item.sku,
    name: item.name,
    sf: item.sf,
    cf: item.cf,
    reason: 'Posible coincidencia por palabras clave (revisar).'
  }));
  // Never auto-fill the quote in fallback; the rep adds products manually.
  const rows = [];
  return {
    reply_draft,
    suggested_products,
    quote_draft: {
      rows,
      note: hasUsableText
        ? 'Posibles coincidencias por palabras clave (revisar).'
        : 'No se pudo interpretar el contenido automáticamente.',
      customer_name: '',
      destination: ''
    }
  };
};

const buildSalesPrompt = ({ contactName, transcript, candidates }) => {
  const candidateLines = candidates
    .map((item) => `- ${item.sku} | ${item.name} | SF ${item.sf} Bs`)
    .join('\n');
  return [
    `Cliente: ${contactName || 'Sin nombre'}`,
    '',
    'Conversación reciente (más antiguo arriba):',
    transcript,
    '',
    'Productos candidatos del catálogo (elige solo de esta lista por SKU):',
    candidateLines || '(sin candidatos)',
    '',
    'Tarea: como asistente de ventas de PCX, redacta una respuesta breve y cordial',
    'en español para el cliente, sugiere productos relevantes (solo SKUs de la lista)',
    'y propone filas de cotización con cantidades. NO inventes SKUs ni precios.',
    '',
    'Identifica el producto EXACTO que coincide con lo que el cliente pide o señaló;',
    'distingue variantes similares por su nombre/código (p. ej. "Repisa/Rollo" no es',
    '"Repisa Grande"). Usa el código/SKU impreso cuando esté disponible. Si el cliente',
    'muestra herramientas en una foto, sugiere los accesorios o soportes compatibles de',
    'la lista. Si no encuentras una coincidencia exacta, dilo en "notes" en lugar de',
    'forzar un producto parecido.',
    '',
    'Si el cliente indica explícitamente a nombre de quién debe ir la cotización,',
    'extrae ese nombre en "customer_name". Si indica una ciudad o departamento de',
    'destino, extrae ese texto en "destination" (tal como lo dijo, p. ej. "Sucre").',
    'Si no lo indica, deja esos campos como cadena vacía.',
    '',
    'Responde SOLO con JSON válido con esta forma exacta:',
    '{',
    '  "reply_draft": "texto de respuesta en español",',
    '  "customer_name": "nombre para la cotización o vacío",',
    '  "destination": "ciudad/departamento de destino o vacío",',
    '  "suggested_skus": [{"sku": "SKU", "reason": "por qué"}],',
    '  "quote_rows": [{"sku": "SKU", "qty": 1}],',
    '  "notes": "notas internas opcionales"',
    '}'
  ].join('\n');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callAiForSales = async ({ contactName, transcript, candidates }) => {
  const prompt = buildSalesPrompt({ contactName, transcript, candidates });
  // Retry once on a transient provider hiccup (rate limit / overloaded / a
  // non-JSON reply) before giving up and falling back to keyword suggestions.
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content, provider } = await aiChatCompletion({
        system: 'Eres un asistente de ventas senior. Usa solo los productos provistos y responde SOLO con un objeto JSON válido, sin texto adicional ni markdown.',
        user: prompt,
        temperature: 0.2,
        maxTokens: 1200,
        json: true
      });
      const parsed = safeParseJsonObject(content);
      if (!parsed) {
        throw new Error('Respuesta de IA no es JSON válido');
      }
      return { data: parsed, provider };
    } catch (err) {
      lastError = err;
      if (attempt === 0) await sleep(700);
    }
  }
  throw lastError;
};

// ── DB-backed orchestration ──────────────────────────────────────────────────

const loadConversationContext = async (conversationId) => {
  const id = Number.parseInt(conversationId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw createHttpError(400, 'ID de conversación inválido');
  }
  const convoRes = await pool.query(
    `SELECT c.id, c.pipeline_stage, ct.profile_name, ct.wa_phone
     FROM whatsapp_conversations c
     JOIN whatsapp_contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1`,
    [id]
  );
  if (convoRes.rowCount === 0) {
    throw createHttpError(404, 'Conversación no encontrada');
  }
  const convo = convoRes.rows[0];
  const msgRes = await pool.query(
    `SELECT id, direction, message_type, text_body, raw_payload, created_at
     FROM whatsapp_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [id, MAX_CONTEXT_MESSAGES]
  );
  const messages = (msgRes.rows || []).reverse();
  return {
    id,
    contactName: String(convo.profile_name || '').trim(),
    contactPhone: String(convo.wa_phone || '').trim(),
    pipelineStage: convo.pipeline_stage || 'new',
    messages: messages.map((m) => ({
      id: Number(m.id),
      type: String(m.message_type || 'text').trim().toLowerCase(),
      rawPayload: m.raw_payload && typeof m.raw_payload === 'object' ? m.raw_payload : null,
      direction: m.direction,
      text: String(m.text_body || '').trim(),
      at: m.created_at
    }))
  };
};

// Turn inbound voice notes and images into text so the rest of the pipeline
// (catalog matching, draft reply, quote) can use them. Mutates message.text.
// Each item is best-effort: failures leave the original placeholder in place.
const enrichMessagesWithMedia = async (messages = []) => {
  const transcriptionOn = isTranscriptionConfigured();
  const visionOn = isVisionConfigured();
  if (!transcriptionOn && !visionOn) return;

  const mediaMessages = messages.filter((m) => (
    m.direction === 'inbound'
    && ((m.type === 'audio' && transcriptionOn) || (m.type === 'image' && visionOn))
    && m.rawPayload
  ));
  // most recent few only
  const toProcess = mediaMessages.slice(-MAX_MEDIA_ENRICH);

  await Promise.all(toProcess.map(async (m) => {
    try {
      const media = m.rawPayload?.[m.type] || {};
      const mediaId = String(media?.id || '').trim();
      if (!mediaId) return;
      const meta = await fetchWhatsAppMediaMeta(mediaId);
      const mediaUrl = String(meta?.url || '').trim();
      if (!mediaUrl) return;
      const binary = await fetchWhatsAppMediaBinary(mediaUrl);
      const mimeType = String(binary.contentType || meta?.mime_type || media?.mime_type || '').trim();

      if (m.type === 'audio') {
        const text = await transcribeAudio({
          buffer: binary.buffer,
          filename: audioFilenameForMime(mimeType),
          mimeType: mimeType || 'audio/ogg'
        });
        if (text) m.text = `(nota de voz) ${text}`;
      } else if (m.type === 'image') {
        const base64 = binary.buffer.toString('base64');
        const description = await aiVisionDescribe({
          base64,
          mimeType: mimeType || 'image/jpeg',
          prompt: VISION_PROMPT
        });
        const caption = String(media?.caption || '').trim();
        if (description) m.text = `(imagen) ${description}${caption ? ` Leyenda: ${caption}` : ''}`;
      }
    } catch (err) {
      console.error('Media enrich failed:', err.message || err);
    }
  }));
};

const buildSalesSuggestion = async ({ conversationId, messageIds }) => {
  const convo = await loadConversationContext(conversationId);

  // Optionally narrow the context to messages the rep selected, so the AI
  // focuses only on the relevant parts of a long conversation.
  let focusMessages = convo.messages;
  let focused = false;
  if (Array.isArray(messageIds) && messageIds.length > 0) {
    const wantedIds = new Set(messageIds.map((value) => Number(value)).filter(Number.isInteger));
    const selected = convo.messages.filter((m) => wantedIds.has(m.id));
    if (selected.length > 0) {
      focusMessages = selected;
      focused = true;
    }
  }

  await enrichMessagesWithMedia(focusMessages);
  const inboundText = focusMessages
    .filter((m) => m.direction === 'inbound' && m.text)
    .map((m) => m.text)
    .join(' \n');
  // When focusing on a selection, use all selected messages (regardless of who
  // sent them); otherwise keep the existing whole-conversation behavior.
  const transcript = focusMessages
    .filter((m) => m.text)
    .map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Vendedor'}: ${m.text}`)
    .join('\n');

  // Did we end up with real content to reason about? If the inbound messages are
  // only un-interpreted media placeholders (e.g. an image/audio we couldn't read),
  // we must NOT guess — that produces confident-but-wrong suggestions.
  const usableInboundText = focusMessages
    .filter((m) => m.direction === 'inbound')
    .map((m) => stripMediaPlaceholders(m.text))
    .join(' ')
    .trim();
  const hasUsableText = usableInboundText.length >= 3;

  const catalog = await loadProductCatalogRows({ includeInactive: false });
  const catalogBySku = new Map(catalog.map((item) => [item.sku, item]));
  // Ranked subset is used for keyword fallback. For the model itself, send the
  // FULL catalog when it's small enough so it can pick the exact product (e.g.
  // distinguish "Repisa/Rollo" from "Repisa Grande"); only fall back to the
  // keyword shortlist for very large catalogs.
  const rankedCandidates = scoreCatalogCandidates(inboundText || transcript, catalog, MAX_CANDIDATES);
  const promptCandidates = catalog.length <= MAX_FULL_CATALOG ? catalog : rankedCandidates;

  let suggestion;
  let provider = 'fallback';
  let uninterpreted = false;

  if (!hasUsableText) {
    // Nothing we could interpret — be honest instead of guessing.
    suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates: [], hasUsableText: false });
    uninterpreted = true;
  } else if (isAiConfigured()) {
    try {
      const aiResult = await callAiForSales({
        contactName: convo.contactName,
        transcript,
        candidates: promptCandidates
      });
      suggestion = attachCatalogToSuggestion(aiResult.data, catalogBySku);
      provider = aiResult.provider || 'ai';
      // If the model produced no usable products, fall back to keyword matches.
      if (suggestion.suggested_products.length === 0 && suggestion.quote_draft.rows.length === 0) {
        suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates: rankedCandidates, hasUsableText: true });
        provider = 'fallback';
      }
    } catch (err) {
      console.error('Sales assistant AI fallback:', err.message || err);
      suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates: rankedCandidates, hasUsableText: true });
      provider = 'fallback';
    }
  } else {
    suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates: rankedCandidates, hasUsableText: true });
  }

  return {
    provider,
    uninterpreted,
    focused,
    focused_count: focused ? focusMessages.length : 0,
    conversation: {
      id: convo.id,
      contact_name: convo.contactName,
      contact_phone: convo.contactPhone,
      pipeline_stage: convo.pipelineStage
    },
    ...suggestion
  };
};

module.exports = {
  tokenize,
  scoreCatalogCandidates,
  safeParseJsonObject,
  attachCatalogToSuggestion,
  buildFallbackSuggestion,
  buildSalesPrompt,
  stripMediaPlaceholders,
  audioFilenameForMime,
  enrichMessagesWithMedia,
  loadConversationContext,
  buildSalesSuggestion
};
