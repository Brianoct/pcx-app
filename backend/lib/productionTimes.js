const { pool } = require('../db');

// Tiempos de producción por proceso.
//  - Estándar: product_process_steps.std_minutes (minutos por pieza) que
//    Admin define en Estructura del producto.
//  - Medido: lo que el tablero registra solo. Cada movimiento de lote deja un
//    evento; el tiempo que el lote pasó en la estación dividido entre sus
//    piezas es el minuto/pieza real. La mediana de los últimos 90 días es la
//    línea base: nadie la declara, así no se puede inflar.

const MEASURED_WINDOW_DAYS = 90;
// Estancias absurdas (un lote olvidado un mes) no deben contaminar la base.
const MAX_STAY_MINUTES = 7 * 24 * 60;

const normalizeSkus = (skus) => [...new Set((Array.isArray(skus) ? skus : []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];

// { SKU: { process: minutos } }
const loadStandardMinutesBySku = async (skus) => {
  const list = normalizeSkus(skus);
  const out = {};
  if (list.length === 0) return out;
  const res = await pool.query(
    `SELECT UPPER(sku) AS sku, process, std_minutes
     FROM product_process_steps
     WHERE UPPER(sku) = ANY($1::text[]) AND std_minutes IS NOT NULL`,
    [list]
  );
  for (const row of res.rows) {
    if (!out[row.sku]) out[row.sku] = {};
    out[row.sku][row.process] = Number(row.std_minutes);
  }
  return out;
};

// { SKU: { process: { minutes_per_piece, lots } } } — mediana medida.
const loadMeasuredMinutesBySku = async (skus, { windowDays = MEASURED_WINDOW_DAYS } = {}) => {
  const list = normalizeSkus(skus);
  const out = {};
  if (list.length === 0) return out;
  const res = await pool.query(
    `WITH stays AS (
       SELECT UPPER(e.sku) AS sku, e.to_stage AS process, e.qty,
              EXTRACT(EPOCH FROM (
                LEAD(e.moved_at) OVER (PARTITION BY e.card_id ORDER BY e.moved_at, e.id) - e.moved_at
              )) / 60.0 AS minutes
       FROM production_stage_events e
       WHERE UPPER(e.sku) = ANY($1::text[])
         AND e.moved_at >= NOW() - ($2::int * INTERVAL '1 day')
     )
     SELECT sku, process,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes / qty) AS minutes_per_piece,
            COUNT(*)::int AS lots
     FROM stays
     WHERE minutes IS NOT NULL AND minutes > 0 AND minutes <= $3 AND qty > 0
       AND process NOT IN ('planificacion', 'recepcion', 'recibido', 'danado_transito')
     GROUP BY sku, process`,
    [list, windowDays, MAX_STAY_MINUTES]
  );
  for (const row of res.rows) {
    if (!out[row.sku]) out[row.sku] = {};
    out[row.sku][row.process] = {
      minutes_per_piece: Number(Number(row.minutes_per_piece).toFixed(2)),
      lots: Number(row.lots)
    };
  }
  return out;
};

module.exports = { MEASURED_WINDOW_DAYS, loadMeasuredMinutesBySku, loadStandardMinutesBySku };
