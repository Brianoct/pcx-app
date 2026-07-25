// Búsqueda de destinos para el autocompletado de Cotizar + panel Admin de
// reclasificación de destinos históricos.
const express = require('express');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const {
  assignGeoText,
  classifyLegacyQuotes,
  geoClassificationCounts,
  searchGeoDestinations
} = require('../lib/geo');

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

const adminOnly = [authenticateToken, requireRole(['admin'])];

// Estado de clasificación + simulación de la reclasificación (no escribe).
router.get('/api/admin/geo/summary', ...adminOnly, async (_req, res) => {
  try {
    const [counts, preview] = await Promise.all([
      geoClassificationCounts(),
      classifyLegacyQuotes({ apply: false })
    ]);
    res.json({
      counts,
      autoFull: preview.updatedFull,
      autoProvincia: preview.updatedProvincia,
      unmatched: preview.unmatched
    });
  } catch (err) {
    console.error('Error en resumen geo:', err);
    res.status(500).json({ error: 'No se pudo obtener el resumen de destinos' });
  }
});

// Ejecuta la reclasificación automática sobre las cotizaciones pendientes.
router.post('/api/admin/geo/backfill', ...adminOnly, async (_req, res) => {
  try {
    const result = await classifyLegacyQuotes({ apply: true });
    res.json(result);
  } catch (err) {
    console.error('Error en reclasificación geo:', err);
    res.status(500).json({ error: 'No se pudo ejecutar la reclasificación' });
  }
});

// Asignación manual: texto libre → municipio del catálogo (+ alias opcional).
router.post('/api/admin/geo/assign', ...adminOnly, async (req, res) => {
  try {
    const { text, dest_geo_id, save_alias } = req.body || {};
    const result = await assignGeoText({
      text: String(text || ''),
      destGeoId: dest_geo_id,
      saveAlias: Boolean(save_alias)
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('Error asignando destino:', err);
    res.status(500).json({ error: 'No se pudo asignar el destino' });
  }
});

module.exports = router;
