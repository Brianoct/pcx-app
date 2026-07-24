// Analista nocturno — "Resumen de la mañana".
//  GET  /api/admin/daily-brief/latest  → último resumen (admin)
//  POST /api/admin/daily-brief/run     → generar ahora (admin, o Render Cron)
const express = require('express');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { generateDailyBrief, getLatestBrief, getAiStatus } = require('../lib/dailyBrief');

const router = express.Router();

router.get('/api/admin/daily-brief/latest', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const brief = await getLatestBrief();
    res.json({ brief, ai: getAiStatus() });
  } catch (err) {
    console.error('Error cargando resumen de la mañana:', err);
    res.status(500).json({ error: 'No se pudo cargar el resumen' });
  }
});

// El disparador nocturno (Render Cron) autentica con un secreto compartido en
// la cabecera x-cron-secret; el botón "Generar ahora" del panel usa el JWT admin.
const authorizeRun = (req, res, next) => {
  const secret = String(process.env.DAILY_BRIEF_CRON_SECRET || '').trim();
  const provided = String(req.get('x-cron-secret') || '').trim();
  if (secret && provided && provided === secret) return next();
  return authenticateToken(req, res, () => requireRole(['admin'])(req, res, next));
};

router.post('/api/admin/daily-brief/run', authorizeRun, async (_req, res) => {
  try {
    const brief = await generateDailyBrief();
    res.json({ brief, ai: getAiStatus() });
  } catch (err) {
    console.error('Error generando resumen de la mañana:', err);
    res.status(500).json({ error: 'No se pudo generar el resumen' });
  }
});

module.exports = router;
