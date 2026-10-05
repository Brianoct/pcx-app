const { pool } = require('../db');

// Tiempos de producción por proceso.
//  - Estándar: product_process_steps (minutos de máquina por tanda ÷ piezas
//    por tanda = minutos por pieza) que Admin define en Estructura.
//  - Medido: lo que el tablero registra solo. Cada movimiento de lote deja un
//    evento; el tiempo que el lote pasó en la estación dividido entre sus
//    piezas es el minuto/pieza real. La mediana de los últimos 90 días es la
//    línea base: nadie la declara, así no se puede inflar.
//    Es reloj de pared: un lote puede dormir en una estación. Por eso se
//    descartan estancias de más de 7 días y se usa la mediana, no el promedio.

const MEASURED_WINDOW_DAYS = 90;
// Estancias absurdas (un lote olvidado un mes) no deben contaminar la base.
const MAX_STAY_MINUTES = 7 * 24 * 60;
const EXCLUDED_STAGES = ['planificacion', 'recepcion', 'recibido', 'danado_transito'];

const normalizeSkus = (skus) => [...new Set((Array.isArray(skus) ? skus : []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];

// Minutos por pieza por tanda: una tanda de 140 min que saca 6 piezas son
// 23.33 min/pza de máquina.
const perPiece = (minutes, piecesPerRun) => {
  if (minutes === null || minutes === undefined) return null;
  const pieces = Math.max(1, Number(piecesPerRun) || 1);
  return Number((Number(minutes) / pieces).toFixed(4));
};

// { SKU: { process: minutos de máquina por pieza } }
const loadStandardMinutesBySku = async (skus) => {
  const list = normalizeSkus(skus);
  const out = {};
  if (list.length === 0) return out;
  const res = await pool.query(
    `SELECT UPPER(sku) AS sku, process, std_minutes, pieces_per_run
     FROM product_process_steps
     WHERE UPPER(sku) = ANY($1::text[]) AND std_minutes IS NOT NULL`,
    [list]
  );
  for (const row of res.rows) {
    if (!out[row.sku]) out[row.sku] = {};
    out[row.sku][row.process] = perPiece(row.std_minutes, row.pieces_per_run);
  }
  return out;
};

// Mediana medida de min/pza por (SKU, proceso). Sin lista de SKUs devuelve
// todos los productos con movimientos en la ventana.
const queryMeasuredStays = async ({ skus = null, windowDays = MEASURED_WINDOW_DAYS } = {}) => {
  const list = skus === null ? null : normalizeSkus(skus);
  if (list !== null && list.length === 0) return [];
  const res = await pool.query(
    `WITH stays AS (
       SELECT UPPER(e.sku) AS sku, e.to_stage AS process, e.qty,
              EXTRACT(EPOCH FROM (
                LEAD(e.moved_at) OVER (PARTITION BY e.card_id ORDER BY e.moved_at, e.id) - e.moved_at
              )) / 60.0 AS minutes
       FROM production_stage_events e
       WHERE ($1::text[] IS NULL OR UPPER(e.sku) = ANY($1::text[]))
         AND e.moved_at >= NOW() - ($2::int * INTERVAL '1 day')
     )
     SELECT sku, process,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes / qty) AS minutes_per_piece,
            COUNT(*)::int AS lots
     FROM stays
     WHERE minutes IS NOT NULL AND minutes > 0 AND minutes <= $3 AND qty > 0
       AND process <> ALL($4::text[])
     GROUP BY sku, process
     ORDER BY sku, process`,
    [list, windowDays, MAX_STAY_MINUTES, EXCLUDED_STAGES]
  );
  return res.rows.map((row) => ({
    sku: row.sku,
    process: row.process,
    minutes_per_piece: Number(Number(row.minutes_per_piece).toFixed(2)),
    lots: Number(row.lots)
  }));
};

// { SKU: { process: { minutes_per_piece, lots } } } — mediana medida.
const loadMeasuredMinutesBySku = async (skus, { windowDays = MEASURED_WINDOW_DAYS } = {}) => {
  const out = {};
  for (const row of await queryMeasuredStays({ skus, windowDays })) {
    if (!out[row.sku]) out[row.sku] = {};
    out[row.sku][row.process] = { minutes_per_piece: row.minutes_per_piece, lots: row.lots };
  }
  return out;
};

module.exports = { MEASURED_WINDOW_DAYS, MAX_STAY_MINUTES, loadMeasuredMinutesBySku, loadStandardMinutesBySku, perPiece, queryMeasuredStays };
