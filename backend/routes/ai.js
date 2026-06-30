const express = require('express');
const { authenticateToken } = require('../lib/authMiddleware');
const { isAiAssistantEnabledFor, requireAiAssistant } = require('../lib/aiAccess');
const { answerAdminAiQuestion } = require('../lib/aiAssistant');
const { buildSalesSuggestion } = require('../lib/salesAssistant');
const { getActiveAiProviderInfo } = require('../lib/aiProvider');

const router = express.Router();

// Lightweight capability check so the frontend can decide whether to show the
// "Asistente IA" tab without exposing the allowlist itself. Also reports the
// active AI provider so the UI can show which model is in use (and whether a
// key is configured for real generative answers).
router.get('/api/ai/assistant/access', authenticateToken, (req, res) => {
  const enabled = isAiAssistantEnabledFor(req.user);
  const providerInfo = enabled ? getActiveAiProviderInfo() : {};
  res.json({ enabled, ...providerInfo });
});

// Gated "ask your business a question" endpoint (private beta).
router.post('/api/ai/assistant', authenticateToken, requireAiAssistant, async (req, res) => {
  const question = String(req.body?.question || req.body?.prompt || '').trim();
  const month = req.body?.month;
  const year = req.body?.year;
  if (!question) {
    return res.status(400).json({ error: 'Pregunta requerida para el asistente IA' });
  }
  // Cap input size: unbounded text is forwarded to a paid LLM (cost/abuse guard).
  const MAX_QUESTION_CHARS = 4000;
  if (question.length > MAX_QUESTION_CHARS) {
    return res.status(400).json({ error: `La pregunta es demasiado larga (máx ${MAX_QUESTION_CHARS} caracteres)` });
  }

  try {
    const payload = await answerAdminAiQuestion({ question, month, year });
    return res.json(payload);
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('AI assistant error:', err);
    return res.status(500).json({ error: 'No se pudo ejecutar el asistente IA' });
  }
});

// Gated sales workspace helper: given a WhatsApp conversation id, return an
// AI-drafted reply, suggested catalog products, and a draft quote. Nothing is
// sent or saved here — the rep confirms via the existing send/quote endpoints.
router.post('/api/ai/sales/suggest', authenticateToken, requireAiAssistant, async (req, res) => {
  const conversationId = req.body?.conversation_id ?? req.body?.conversationId;
  if (conversationId === undefined || conversationId === null || conversationId === '') {
    return res.status(400).json({ error: 'conversation_id requerido' });
  }
  // Cap the number of message ids to bound how much conversation text is sent
  // to the paid LLM in a single request.
  const MAX_MESSAGE_IDS = 200;
  const messageIds = Array.isArray(req.body?.message_ids)
    ? req.body.message_ids.map((value) => Number(value)).filter(Number.isInteger).slice(0, MAX_MESSAGE_IDS)
    : [];
  try {
    const payload = await buildSalesSuggestion({ conversationId, messageIds });
    return res.json(payload);
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Sales assistant error:', err);
    return res.status(500).json({ error: 'No se pudo generar la sugerencia de ventas' });
  }
});

module.exports = router;
