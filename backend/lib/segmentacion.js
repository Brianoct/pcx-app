// Segmentación: dónde se usará el tablero (uso, por cotización) y cómo nos
// conoció el cliente (origen, por cliente). Las listas viven aquí y en
// frontend/src/segmentacion.js; si cambias una, cambia la otra.
const { pool } = require('../db');

const USOS = [
  { key: 'taller_mecanico', label: 'Taller mecánico' },
  { key: 'industria', label: 'Fábrica o industria' },
  { key: 'empresa_oficina', label: 'Oficina o empresa' },
  { key: 'ferreteria_revendedor', label: 'Ferretería o reventa' },
  { key: 'hogar', label: 'Casa o garaje' },
  { key: 'institucion_publica', label: 'Institución pública' },
  { key: 'otro', label: 'Otro' }
];

const ORIGENES = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'google', label: 'Google' },
  { key: 'referido', label: 'Referido' },
  { key: 'tienda_fisica', label: 'Tienda física' },
  { key: 'feria_evento', label: 'Feria o evento' },
  { key: 'vendedor_visita', label: 'Visita de vendedor' },
  { key: 'cliente_recurrente', label: 'Cliente recurrente' },
  { key: 'otro', label: 'Otro' }
];

const USO_KEYS = new Set(USOS.map((u) => u.key));
const ORIGEN_KEYS = new Set(ORIGENES.map((o) => o.key));

const normalizeUso = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return USO_KEYS.has(key) ? key : null;
};
const normalizeOrigen = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return ORIGEN_KEYS.has(key) ? key : null;
};
const trimDetalle = (value, max = 120) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
};

// Lee uso/origen del body de una cotización. Lanza 400 si viene un valor
// fuera de la lista (vacío es válido: las cotizaciones viejas no lo tienen).
const parseQuoteSegmentation = (body = {}) => {
  const out = {};
  if (body.uso !== undefined && body.uso !== null && String(body.uso).trim() !== '') {
    out.uso = normalizeUso(body.uso);
    if (!out.uso) { const e = new Error('Uso inválido'); e.statusCode = 400; throw e; }
  } else out.uso = null;
  out.uso_detalle = trimDetalle(body.uso_detalle);
  if (body.origen !== undefined && body.origen !== null && String(body.origen).trim() !== '') {
    out.origen = normalizeOrigen(body.origen);
    if (!out.origen) { const e = new Error('Origen inválido'); e.statusCode = 400; throw e; }
  } else out.origen = null;
  out.origen_detalle = trimDetalle(body.origen_detalle);
  const campaignId = Number.parseInt(body.campaign_id, 10);
  out.campaign_id = Number.isInteger(campaignId) && campaignId > 0 ? campaignId : null;
  return out;
};

// Tras guardar una cotización: el origen del cliente se fija la primera vez
// (nunca se pisa) y el segmento se deriva del uso más frecuente mientras no
// lo haya confirmado una persona (segmento_auto = TRUE). Nunca lanza.
const applySegmentationFromQuote = async ({ phoneNormalized, origen, origenDetalle }) => {
  if (!phoneNormalized) return;
  try {
    if (origen) {
      await pool.query(
        `UPDATE customers SET origen = $2, origen_detalle = COALESCE(origen_detalle, $3), updated_at = NOW()
         WHERE phone_normalized = $1 AND origen IS NULL`,
        [phoneNormalized, origen, origenDetalle || null]
      );
    }
    await pool.query(
      `UPDATE customers c SET segmento = s.uso, updated_at = NOW()
       FROM (
         SELECT q.uso
         FROM quotes q
         WHERE regexp_replace(COALESCE(q.customer_phone, ''), '\\D', '', 'g') = $1 AND q.uso IS NOT NULL
         GROUP BY q.uso
         ORDER BY COUNT(*) DESC, MAX(q.created_at) DESC
         LIMIT 1
       ) s
       WHERE c.phone_normalized = $1 AND c.segmento_auto = TRUE AND c.segmento IS DISTINCT FROM s.uso`,
      [phoneNormalized]
    );
  } catch (err) {
    console.warn('segmentación desde cotización falló (no bloqueante):', err.message);
  }
};

module.exports = { ORIGENES, USOS, applySegmentationFromQuote, normalizeOrigen, normalizeUso, parseQuoteSegmentation, trimDetalle };
