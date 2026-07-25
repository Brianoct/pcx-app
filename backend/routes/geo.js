// Búsqueda de destinos para el autocompletado de Cotizar.
const express = require('express');
const { authenticateToken } = require('../lib/authMiddleware');
const { searchGeoDestinations } = require('../lib/geo');

const router = express.Router();

router.get('/api/geo/search', authenticateToken, async (req, res) => {
  try {
    const results = await searchGeoDestinations(String(req.query.q || ''));
    res.json({ results });
  } catch (err) {
    console.error('Error buscando destinos:', err);
    res.status(500).json({ error: 'No se pudo buscar destinos' });
  }
});

module.exports = router;
