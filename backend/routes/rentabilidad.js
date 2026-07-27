// Rentabilidad por producto (ver lib/rentabilidad.js — el cálculo se comparte
// con el snapshot diario y la alerta de margen bajo del brief).
const express = require('express');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { computeRentabilidad } = require('../lib/rentabilidad');

const router = express.Router();

router.get('/api/admin/rentabilidad', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const data = await computeRentabilidad({ month: req.query.month, year: req.query.year });
    res.json(data);
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error en rentabilidad:', err);
    res.status(500).json({ error: 'No se pudo calcular la rentabilidad' });
  }
});

module.exports = router;
