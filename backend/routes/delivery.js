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

// ── Links cortos de Google Maps (goo.gl/maps, maps.app.goo.gl) ──────────────
// El link que comparte WhatsApp no trae coordenadas: es una redirección al
// URL completo de Maps que sí las trae. El servidor sigue esa cadena (solo
// dominios de Google, máx. 6 saltos) y saca las coordenadas del URL final.
const isAllowedMapsHost = (host) => {
  const h = String(host || '').toLowerCase();
  return h === 'goo.gl'
    || h === 'maps.app.goo.gl'
    || h === 'app.goo.gl'
    || h === 'g.co'
    || h === 'google.com'
    || h.endsWith('.google.com')
    || /^(www\.|maps\.|consent\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
};

// Coordenadas CONFIABLES en un URL: parámetros que expresan el punto elegido
// por el usuario (pin compartido, destino) o el marcador del lugar.
const TRUSTED_URL_PATTERNS = [
  /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /[?&]q=(?:loc:)?\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i,
  /[?&]ll=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i,
  /[?&](?:destination|daddr)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i
];
// @lat,lng es solo el ENCUADRE del mapa: sirve como candidato, nunca como
// respuesta directa (las páginas intermedias traen encuadres ajenos).
const VIEWPORT_URL_PATTERN = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/;

const matchToCoords = (match) => {
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return isValidLat(lat) && isValidLng(lng) ? { lat, lng } : null;
};

const decodeLoose = (text) => {
  try { return decodeURIComponent(String(text || '')); } catch { return String(text || ''); }
};

const parseTrustedCoordsFromUrl = (rawUrl) => {
  const text = decodeLoose(rawUrl);
  for (const pattern of TRUSTED_URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const coords = matchToCoords(match);
      if (coords) return coords;
    }
  }
  return null;
};

// Compatibilidad con pruebas/llamadas viejas: confiable primero, encuadre después.
const parseCoordsFromMapsUrl = (rawUrl) => {
  const trusted = parseTrustedCoordsFromUrl(rawUrl);
  if (trusted) return trusted;
  const match = decodeLoose(rawUrl).match(VIEWPORT_URL_PATTERN);
  return match ? matchToCoords(match) : null;
};

const MAX_LINK_HOPS = 6;
// Un candidato leído de una página solo es creíble si cae a menos de este
// radio de alguno de nuestros almacenes. Las páginas intermedias de Google
// traen coordenadas propias (p. ej. su oficina de Nueva York en el preview
// genérico): sin este filtro, eso se cotizaba como si fuera el cliente.
const CANDIDATE_SANITY_KM = 300;

const resolveMapsLink = async (rawLink, { allowHost = isAllowedMapsHost, anchors = [] } = {}) => {
  // Lo pegado suele traer texto alrededor («Mira mi ubicación: https://…»):
  // se rescata el primer URL del texto y se limpia la puntuación colgante.
  const urlMatch = String(rawLink || '').match(/https?:\/\/[^\s"'<>]+/i);
  if (!urlMatch) return { error: 'Link inválido: no se encontró un http(s)://…' };
  const cleaned = urlMatch[0].replace(/[),.;!¡¿?\]]+$/, '');
  let current;
  try {
    current = new URL(cleaned);
  } catch {
    return { error: 'Link inválido' };
  }

  // Candidatos de señales NO confiables (encuadres, previews, incrustados):
  // se juntan todos y al final gana el más cercano a nuestros almacenes.
  const candidates = [];
  const pushCandidate = (coords, source) => {
    if (coords) candidates.push({ ...coords, source });
  };
  const logOk = (via, coords) => {
    console.log('delivery/resolve ok:', { via, ...coords, final_url: current.href.slice(0, 200) });
  };

  let lastResponseStatus = null;
  let lastBodyBytes = 0;
  for (let hop = 0; hop < MAX_LINK_HOPS; hop += 1) {
    if (!/^https?:$/.test(current.protocol)) return { error: 'Solo se aceptan links http(s)' };
    if (!allowHost(current.hostname)) {
      return { error: 'Solo se aceptan links de Google Maps (goo.gl, maps.app.goo.gl, google.com/maps)' };
    }
    // La página de consentimiento envuelve el destino real en ?continue=
    const continueParam = current.searchParams.get('continue');
    if (continueParam) {
      const coords = parseTrustedCoordsFromUrl(continueParam);
      if (coords) { logOk('url:continue', coords); return coords; }
      try { current = new URL(continueParam); continue; } catch { /* seguir normal */ }
    }
    // Coordenadas confiables en el URL (pin compartido, destino, marcador).
    const trusted = parseTrustedCoordsFromUrl(current.href);
    if (trusted) { logOk('url', trusted); return trusted; }
    // El encuadre @lat,lng del URL es solo un candidato.
    const viewportMatch = decodeLoose(current.href).match(VIEWPORT_URL_PATTERN);
    if (viewportMatch) pushCandidate(matchToCoords(viewportMatch), 'url:viewport');

    let response;
    try {
      response = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) pcx-app' }
      });
    } catch {
      return { error: 'No se pudo abrir el link (sin conexión con Google Maps)' };
    }
    lastResponseStatus = response.status;
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        current = new URL(location, current.href);
        continue;
      } catch {
        return { error: 'El link redirige a una dirección inválida' };
      }
    }

    // Fin de las redirecciones HTTP: leer el cuerpo (acotado) de la página.
    let body = '';
    try {
      body = (await response.text()).slice(0, 1_500_000);
    } catch { /* cuerpo ilegible: se sigue con lo que hay */ }
    lastBodyBytes = body.length;

    // Google a veces frena IPs de datacenter con su página de captcha:
    // eso explica fallas intermitentes. Mensaje claro para reintentar.
    if (current.pathname.startsWith('/sorry') || body.includes('unusual traffic')) {
      console.warn('delivery/resolve: Google sirvió captcha para', current.href);
      return { error: 'Google bloqueó la consulta temporalmente: reintenta en unos segundos o pega "lat, lng"' };
    }

    // Redirección por meta-refresh (algunas páginas intermedias la usan).
    const metaRefresh = body.match(/http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i);
    if (metaRefresh) {
      try {
        current = new URL(metaRefresh[1].replace(/&amp;/g, '&'), current.href);
        continue;
      } catch { /* refresh inválido: seguir buscando en el cuerpo */ }
    }

    if (body) {
      // URLs de Maps incrustados: los que traen coordenadas confiables
      // responden directo; los demás quedan de candidatos o de próximo salto.
      const embedded = (body.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps[^"'\\\s<>]+/g) || []).slice(0, 20);
      for (const embeddedUrl of embedded) {
        const coords = parseTrustedCoordsFromUrl(embeddedUrl);
        if (coords) { logOk('body:embedded-url', coords); return coords; }
      }

      // Señales del HTML como candidatos (matchAll: pueden venir varias).
      const bodyPatterns = [
        { re: /(?:og|twitter):image["'][^>]*center=(-?\d{1,2}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/gi, source: 'body:preview' },
        { re: /center=(-?\d{1,2}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/g, source: 'body:center' },
        { re: /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g, source: 'body:marker' }
      ];
      for (const { re, source } of bodyPatterns) {
        for (const match of body.matchAll(re)) {
          pushCandidate(matchToCoords(match), source);
          if (candidates.length > 40) break;
        }
      }
      for (const embeddedUrl of embedded) {
        const viewport = decodeLoose(embeddedUrl).match(VIEWPORT_URL_PATTERN);
        if (viewport) pushCandidate(matchToCoords(viewport), 'body:embedded-viewport');
      }

      // Página interstitial («abrir en la app») sin candidatos: seguir el
      // primer URL de Maps incrustado como si fuera la redirección.
      if (candidates.length === 0 && embedded.length > 0 && embedded[0] !== current.href) {
        try { current = new URL(embedded[0].replace(/&amp;/g, '&')); continue; } catch { /* sin salto */ }
      }
    }
    break; // sin más saltos: decidir con los candidatos juntados
  }

  if (candidates.length === 0) {
    console.warn('delivery/resolve: sin coordenadas —', {
      final_url: current.href.slice(0, 300),
      status: lastResponseStatus,
      body_bytes: lastBodyBytes
    });
    return { error: 'El link no trae coordenadas: comparte la ubicación como pin (Ubicación → Enviar) o pega "lat, lng"' };
  }

  // Con almacenes configurados: gana el candidato más cercano a alguno, y si
  // hasta el mejor queda absurdamente lejos, mejor decirlo que cobrar mal.
  const validAnchors = (anchors || []).filter((a) => isValidLat(Number(a?.lat)) && isValidLng(Number(a?.lng)));
  if (validAnchors.length > 0) {
    let best = null;
    for (const candidate of candidates) {
      const distance = Math.min(...validAnchors.map((a) => haversineKm(candidate.lat, candidate.lng, Number(a.lat), Number(a.lng))));
      if (!best || distance < best.distance) best = { ...candidate, distance };
    }
    if (best.distance > CANDIDATE_SANITY_KM) {
      console.warn('delivery/resolve: candidatos implausibles —', {
        best: { lat: best.lat, lng: best.lng, source: best.source, distance_km: Math.round(best.distance) },
        candidates: candidates.length,
        final_url: current.href.slice(0, 300)
      });
      return { error: `El link se leyó como un punto a ${Math.round(best.distance)} km de nuestras ciudades: seguramente no es la ubicación real del cliente. Pide el pin de ubicación (Ubicación → Enviar) o pega "lat, lng"` };
    }
    logOk(`${best.source} (a ${Math.round(best.distance)} km del almacén)`, best);
    return { lat: best.lat, lng: best.lng };
  }

  // Sin almacenes configurados: primer candidato en orden de confiabilidad.
  const priority = ['body:preview', 'body:marker', 'body:center', 'body:embedded-viewport', 'url:viewport'];
  candidates.sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source));
  logOk(candidates[0].source, candidates[0]);
  return { lat: candidates[0].lat, lng: candidates[0].lng };
};

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

// ─── Resolver un link de Maps a coordenadas ──────────────────────────────────
// El frontend manda el link corto tal cual lo pegó el vendedor; el servidor
// lo expande y devuelve lat/lng listos para /api/delivery/quote.
router.post('/api/delivery/resolve', authenticateToken, async (req, res) => {
  try {
    const link = String(req.body?.link || '').trim();
    if (!link) return res.status(400).json({ error: 'Falta el link' });
    // Los almacenes configurados anclan la lectura: entre varios candidatos
    // de la página gana el más cercano a nuestras ciudades.
    let anchors = [];
    try {
      anchors = (await loadSettings())
        .filter((s) => s.active && isValidLat(s.origin_lat) && isValidLng(s.origin_lng))
        .map((s) => ({ lat: s.origin_lat, lng: s.origin_lng }));
    } catch { /* sin anclas: el resolvedor usa el orden de confiabilidad */ }
    const result = await resolveMapsLink(link, { anchors });
    if (result.error) return res.status(422).json({ error: result.error });
    res.json({ lat: result.lat, lng: result.lng });
  } catch (err) {
    console.error('Error resolving maps link:', err);
    res.status(500).json({ error: 'No se pudo leer el link' });
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
    // El punto interpretado viaja SIEMPRE en la respuesta (con link a Maps):
    // si un link se leyó mal, el vendedor lo ve de inmediato en vez de
    // confiar en un precio equivocado.
    const point = {
      lat,
      lng,
      maps_url: `https://www.google.com/maps?q=${lat},${lng}`
    };
    if (!requestedCity && best.distance_km > CITY_MATCH_KM) {
      return res.json({
        in_range: false,
        city: null,
        distance_km: Math.round(best.distance_km * 10) / 10,
        price_bs: null,
        ...point,
        message: `El punto queda a ${Math.round(best.distance_km)} km del almacén de ${best.city}: no es un envío local. Verifica el punto en el link`
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
      ...point,
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
// Expuestos para pruebas (scripts locales): no son parte del API HTTP.
module.exports.parseCoordsFromMapsUrl = parseCoordsFromMapsUrl;
module.exports.resolveMapsLink = resolveMapsLink;
