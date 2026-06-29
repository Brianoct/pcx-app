const { pool } = require('../db');
const { loadProductCatalogRows } = require('./products');
const { normalizeText } = require('./rbac');
const { aiChatCompletion, isAiConfigured } = require('./aiProvider');
const { createHttpError } = require('./util');

const MAX_CONTEXT_MESSAGES = 20;
const MAX_CANDIDATES = 40;
const MAX_SUGGESTED = 8;

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

// Rank catalog rows by how well their name/sku/category overlap with the
// customer's words. Returns the top `limit` rows with a positive score, or a
// shallow slice of the catalog when nothing matched (so the rep still has
// something to start from).
const scoreCatalogCandidates = (conversationText, catalog = [], limit = MAX_CANDIDATES) => {
  const wanted = new Set(tokenize(conversationText));
  if (wanted.size === 0) {
    return catalog.slice(0, limit);
  }
  const scored = catalog.map((item) => {
    const haystack = tokenize(`${item.name} ${item.sku} ${item.menu_category || ''}`);
    let score = 0;
    for (const token of haystack) {
      if (wanted.has(token)) score += 1;
    }
    // light boost for exact sku mention
    if (wanted.has(normalizeText(item.sku))) score += 3;
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
      note: String(aiJson?.notes || '').trim()
    }
  };
};

// Deterministic suggestion used when no AI key is configured (or the model
// call fails): keyword-matched products + a simple acknowledgement reply.
const buildFallbackSuggestion = ({ contactName, candidates = [] }) => {
  const top = candidates.slice(0, 5);
  const suggested_products = top.map((item) => ({
    sku: item.sku,
    name: item.name,
    sf: item.sf,
    cf: item.cf,
    reason: 'Coincidencia por palabras clave del mensaje del cliente.'
  }));
  const rows = top.map((item) => ({
    sku: item.sku,
    displayName: item.name,
    qty: 1,
    unitPrice: Number(item.sf || 0),
    lineTotal: Number(item.sf || 0),
    isCombo: false
  }));
  const greeting = contactName ? `Hola ${contactName}, ` : 'Hola, ';
  const reply_draft = top.length > 0
    ? `${greeting}gracias por tu mensaje. Según lo que mencionas, te recomiendo: `
      + `${top.map((item) => item.name).join(', ')}. ¿Te preparo una cotización con estos productos?`
    : `${greeting}gracias por tu mensaje. ¿Podrías darme más detalles del producto que buscas para ayudarte mejor?`;
  return {
    reply_draft,
    suggested_products,
    quote_draft: { rows, note: 'Borrador generado sin IA (coincidencia por palabras clave).' }
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
    'Responde SOLO con JSON válido con esta forma exacta:',
    '{',
    '  "reply_draft": "texto de respuesta en español",',
    '  "suggested_skus": [{"sku": "SKU", "reason": "por qué"}],',
    '  "quote_rows": [{"sku": "SKU", "qty": 1}],',
    '  "notes": "notas internas opcionales"',
    '}'
  ].join('\n');
};

const callAiForSales = async ({ contactName, transcript, candidates }) => {
  const prompt = buildSalesPrompt({ contactName, transcript, candidates });
  const { content, provider } = await aiChatCompletion({
    system: 'Eres un asistente de ventas senior. Usa solo los productos provistos y responde solo con JSON válido.',
    user: prompt,
    temperature: 0.3,
    maxTokens: 700
  });
  const parsed = safeParseJsonObject(content);
  if (!parsed) {
    throw new Error('Respuesta de IA no es JSON válido');
  }
  return { data: parsed, provider };
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
    `SELECT direction, text_body, created_at
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
      direction: m.direction,
      text: String(m.text_body || '').trim(),
      at: m.created_at
    }))
  };
};

const buildSalesSuggestion = async ({ conversationId }) => {
  const convo = await loadConversationContext(conversationId);
  const inboundText = convo.messages
    .filter((m) => m.direction === 'inbound' && m.text)
    .map((m) => m.text)
    .join(' \n');
  const transcript = convo.messages
    .filter((m) => m.text)
    .map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Vendedor'}: ${m.text}`)
    .join('\n');

  const catalog = await loadProductCatalogRows({ includeInactive: false });
  const catalogBySku = new Map(catalog.map((item) => [item.sku, item]));
  const candidates = scoreCatalogCandidates(inboundText || transcript, catalog, MAX_CANDIDATES);

  let suggestion;
  let provider = 'fallback';
  let aiError = null;
  if (isAiConfigured()) {
    try {
      const aiResult = await callAiForSales({
        contactName: convo.contactName,
        transcript,
        candidates
      });
      suggestion = attachCatalogToSuggestion(aiResult.data, catalogBySku);
      provider = aiResult.provider || 'ai';
      // If the model produced no usable products, fall back so the rep still
      // gets keyword-matched suggestions.
      if (suggestion.suggested_products.length === 0 && suggestion.quote_draft.rows.length === 0) {
        suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates });
        provider = 'fallback';
      }
    } catch (err) {
      console.error('Sales assistant AI fallback:', err.message || err);
      suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates });
      provider = 'fallback';
      aiError = String(err?.message || err || 'Error desconocido');
    }
  } else {
    suggestion = buildFallbackSuggestion({ contactName: convo.contactName, candidates });
  }

  return {
    provider,
    ai_error: aiError,
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
  loadConversationContext,
  buildSalesSuggestion
};
