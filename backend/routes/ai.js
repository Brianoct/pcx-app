const express = require('express');
const { authenticateToken } = require('../lib/authMiddleware');
const { isAiAssistantEnabledFor, requireAiAssistant } = require('../lib/aiAccess');
const { answerAdminAiQuestion } = require('../lib/aiAssistant');

const router = express.Router();

// Lightweight capability check so the frontend can decide whether to show the
// "Asistente IA" tab without exposing the allowlist itself.
router.get('/api/ai/assistant/access', authenticateToken, (req, res) => {
  res.json({ enabled: isAiAssistantEnabledFor(req.user) });
});

// Gated "ask your business a question" endpoint (private beta).
router.post('/api/ai/assistant', authenticateToken, requireAiAssistant, async (req, res) => {
  const question = String(req.body?.question || req.body?.prompt || '').trim();
  const month = req.body?.month;
  const year = req.body?.year;
  if (!question) {
    return res.status(400).json({ error: 'Pregunta requerida para el asistente IA' });
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

module.exports = router;
