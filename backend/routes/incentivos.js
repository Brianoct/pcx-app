const express = require('express');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { buildSimulation, saveConfig } = require('../lib/incentivos');

const router = express.Router();

// Incentivos de ventas por esfuerzo, en SIMULACIÓN: solo Admin lo ve y nada
// de esto cambia lo que se paga. El equipo de ventas no tiene acceso.

const parseMonth = (query) => {
  const now = new Date();
  const month = Number.parseInt(query.month, 10);
  const year = Number.parseInt(query.year, 10);
  return {
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1,
    year: Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : now.getFullYear()
  };
};

const adminOnly = (req, res, next) => {
  if (normalizeRole(req.user?.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'Solo Admin puede ver la simulación de incentivos' });
  }
  return next();
};

router.get('/api/admin/sales-incentives', authenticateToken, adminOnly, async (req, res) => {
  try {
    res.json(await buildSimulation(parseMonth(req.query || {})));
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error building sales incentives simulation:', err);
    res.status(500).json({ error: 'No se pudo calcular la simulación de incentivos' });
  }
});

router.put('/api/admin/sales-incentives', authenticateToken, adminOnly, async (req, res) => {
  try {
    await saveConfig({ rules: req.body?.rules, cap_pct: req.body?.cap_pct, min_cases: req.body?.min_cases }, req.user.id);
    res.json({ message: 'Reglas guardadas', ...(await buildSimulation(parseMonth(req.query || {}))) });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error saving sales incentives:', err);
    res.status(500).json({ error: 'No se pudieron guardar las reglas' });
  }
});

module.exports = router;
