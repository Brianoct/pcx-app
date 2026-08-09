const express = require('express');
const { authenticateToken } = require('../lib/authMiddleware');
const { isSandboxRequest } = require('../lib/requestContext');
const { canUseSandbox, getSandboxStatus, resetSandbox } = require('../lib/sandbox');

const router = express.Router();

router.get('/api/sandbox/status', authenticateToken, async (req, res) => {
  try {
    const status = await getSandboxStatus();
    res.json({
      ...status,
      can_use: canUseSandbox(req.user?.role),
      active: isSandboxRequest()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo consultar el estado del sandbox' });
  }
});

// Reinicia el sandbox al punto de partida: estructura fresca, catálogo y
// usuarios copiados de la base real, y el seed de práctica.
router.post('/api/sandbox/reset', authenticateToken, async (req, res) => {
  if (!canUseSandbox(req.user?.role)) {
    return res.status(403).json({ error: 'Permisos insuficientes' });
  }
  try {
    const result = await resetSandbox();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[sandbox] reset falló:', err);
    res.status(500).json({ error: 'No se pudo reiniciar el sandbox' });
  }
});

module.exports = router;
