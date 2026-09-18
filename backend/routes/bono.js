const express = require('express');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { buildScorecard, loadGoalLog, saveGoals } = require('../lib/bono');

const router = express.Router();

// Bono por desempeño: scorecard del mes. Lo ve todo el equipo (transparencia:
// la gente corrige el rumbo cuando lo ve). Solo Admin edita metas.

const parseMonth = (query) => {
  const now = new Date();
  const month = Number.parseInt(query.month, 10);
  const year = Number.parseInt(query.year, 10);
  return {
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1,
    year: Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : now.getFullYear()
  };
};

router.get('/api/bono', authenticateToken, async (req, res) => {
  try {
    const scorecard = await buildScorecard(parseMonth(req.query || {}));
    const isAdmin = normalizeRole(req.user?.role || '') === ROLE_KEYS.admin;
    res.json({ ...scorecard, log: isAdmin ? await loadGoalLog() : [] });
  } catch (err) {
    console.error('Error building bono scorecard:', err);
    res.status(500).json({ error: 'No se pudo calcular el bono por desempeño' });
  }
});

router.put('/api/bono/goals', authenticateToken, async (req, res) => {
  if (normalizeRole(req.user?.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'Solo Admin puede cambiar las metas' });
  }
  try {
    await saveGoals({ goals: req.body?.goals, tick_up_pct: req.body?.tick_up_pct }, req.user.id);
    const scorecard = await buildScorecard(parseMonth(req.query || {}));
    res.json({ message: 'Metas guardadas', ...scorecard, log: await loadGoalLog() });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error saving bono goals:', err);
    res.status(500).json({ error: 'No se pudieron guardar las metas' });
  }
});

module.exports = router;
