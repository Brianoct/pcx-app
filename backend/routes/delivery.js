// Envío local: cotizador de delivery dentro de la ciudad (Cochabamba y
// Santa Cruz). El cliente manda su GPS por WhatsApp; el precio sale de los
// anillos de distancia que configura Almacén alrededor de cada almacén.
// La distancia es en línea recta (haversine): Almacén calibra los anillos
// sabiendo eso.
const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { ROLE_KEYS, normalizeRole } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

const DELIVERY_CITIES = ['Cochabamba', 'Santa Cruz'];
const MAX_RINGS = 12;
// Un punto a más de este radio de TODOS los almacenes no es "envío local".
const CITY_MATCH_KM = 80;

const EARTH_RADIUS_KM = 6371;
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

const isValidLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const isValidLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

// Anillos: [{max_km, price_bs}] ordenados por distancia, sin solaparse.
const normalizeRings = (raw) => {
  if (!Array.isArray(raw)) return null;
  const rings = [];
  for (const item of raw.slice(0, MAX_RINGS)) {
    const maxKm = Number(item?.max_km);
    const priceBs = Number(item?.price_bs);
    if (!Number.isFinite(maxKm) || maxKm <= 0 || maxKm > 200) return null;
    if (!Number.isFinite(priceBs) || priceBs < 0 || priceBs > 100000) return null;
    rings.push({ max_km: Math.round(maxKm * 10) / 10, price_bs: Math.round(priceBs * 100) / 100 });
  }
  rings.sort((a, b) => a.max_km - b.max_km);
  for (let i = 1; i < rings.length; i += 1) {
    if (rings[i].max_km === rings[i - 1].max_km) return null;
  }
  return rings;
};

const rowToSettings = (row) => ({
  city: row.city,
  origin_lat: row.origin_lat === null ? null : Number(row.origin_lat),
  origin_lng: row.origin_lng === null ? null : Number(row.origin_lng),
  rings: Array.isArray(row.rings) ? row.rings : [],
  active: Boolean(row.active),
  updated_at: row.updated_at
});

const loadSettings = async () => {
  const res = await pool.query(
    `SELECT city, origin_lat, origin_lng, rings, active, updated_at
     FROM local_delivery_settings ORDER BY city`
  );
  return res.rows.map(rowToSettings);
};

const canManageDelivery = (role) => {
  const r = normalizeRole(role || '');
  return r === ROLE_KEYS.admin || r === ROLE_KEYS.almacen || r === ROLE_KEYS.almacenLider;
};

// ─── Configuración (lectura para todos los autenticados) ─────────────────────
router.get('/api/delivery/settings', authenticateToken, async (_req, res) => {
  try {
    res.json({ cities: await loadSettings(), can_manage: false });
  } catch (err) {
    console.error('Error loading delivery settings:', err);
    res.status(500).json({ error: 'No se pudo cargar la configuración de envío local' });
  }
});

router.patch('/api/delivery/settings/:city', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (!canManageDelivery(userContext.role)) {
      return res.status(403).json({ error: 'Solo Almacén o Admin configuran el envío local' });
    }
    const city = String(req.params.city || '').trim();
    if (!DELIVERY_CITIES.includes(city)) {
      return res.status(400).json({ error: `Ciudad inválida. Usa: ${DELIVERY_CITIES.join(', ')}` });
    }

    const sets = [];
    const values = [];
    const push = (sql, value) => { values.push(value); sets.push(`${sql} = $${values.length}`); };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'origin_lat')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'origin_lng')) {
      const lat = Number(req.body?.origin_lat);
      const lng = Number(req.body?.origin_lng);
      if (!isValidLat(lat) || !isValidLng(lng)) {
        return res.status(400).json({ error: 'Punto del almacén inválido (lat/lng)' });
      }
      push('origin_lat', lat);
      push('origin_lng', lng);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rings')) {
      const rings = normalizeRings(req.body.rings);
      if (rings === null) {
        return res.status(400).json({ error: 'Anillos inválidos: usa rangos de km (0–200) con precio en Bs, sin repetir distancias' });
      }
      push('rings', JSON.stringify(rings));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active')) {
      push('active', Boolean(req.body.active));
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    push('updated_by', req.user.id);

    await pool.query(
      `UPDATE local_delivery_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE city = $${values.length + 1}`,
      [...values, city]
    );
    res.json({ message: 'Envío local actualizado', cities: await loadSettings() });
  } catch (err) {
    console.error('Error updating delivery settings:', err);
    res.status(500).json({ error: 'No se pudo actualizar la configuración' });
  }
});

// ─── Cotizar un envío desde un punto GPS ─────────────────────────────────────
// city es opcional: sin ella se usa el almacén más cercano (el caso WhatsApp,
// donde el vendedor aún no eligió sede).
router.post('/api/delivery/quote', authenticateToken, async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!isValidLat(lat) || !isValidLng(lng)) {
      return res.status(400).json({ error: 'Ubicación inválida: se necesita lat y lng' });
    }
    const requestedCity = String(req.body?.city || '').trim();
    if (requestedCity && !DELIVERY_CITIES.includes(requestedCity)) {
      return res.status(400).json({ error: `Ciudad inválida. Usa: ${DELIVERY_CITIES.join(', ')}` });
    }

    const allSettings = await loadSettings();
    const candidates = allSettings
      .filter((s) => s.active && isValidLat(s.origin_lat) && isValidLng(s.origin_lng))
      .filter((s) => !requestedCity || s.city === requestedCity)
      .map((s) => ({ ...s, distance_km: haversineKm(lat, lng, s.origin_lat, s.origin_lng) }))
      .sort((a, b) => a.distance_km - b.distance_km);

    if (candidates.length === 0) {
      return res.status(409).json({
        error: requestedCity
          ? `Envío local sin configurar para ${requestedCity}: Almacén debe fijar el punto y los anillos`
          : 'Envío local sin configurar: Almacén debe fijar el punto y los anillos'
      });
    }

    const best = candidates[0];
    if (!requestedCity && best.distance_km > CITY_MATCH_KM) {
      return res.json({
        in_range: false,
        city: null,
        distance_km: Math.round(best.distance_km * 10) / 10,
        price_bs: null,
        message: 'El punto queda lejos de ambas ciudades: no es un envío local'
      });
    }

    const distanceKm = Math.round(best.distance_km * 10) / 10;
    const ring = (best.rings || []).find((r) => distanceKm <= Number(r.max_km)) || null;
    res.json({
      in_range: Boolean(ring),
      city: best.city,
      distance_km: distanceKm,
      price_bs: ring ? Number(ring.price_bs) : null,
      ring_max_km: ring ? Number(ring.max_km) : null,
      label: ring
        ? `Envío local ${best.city} · ${distanceKm} km (hasta ${ring.max_km} km)`
        : null,
      message: ring
        ? null
        : `A ${distanceKm} km del almacén de ${best.city}: fuera de cobertura, cotizar manual`
    });
  } catch (err) {
    console.error('Error quoting delivery:', err);
    res.status(500).json({ error: 'No se pudo cotizar el envío' });
  }
});

module.exports = router;
