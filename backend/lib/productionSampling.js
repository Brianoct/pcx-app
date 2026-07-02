const { pool } = require('../db');
const { loadProductionSettings } = require('./productStructure');
const { createHttpError } = require('./util');

// Random measurement tasks: when a card enters a stage, each BOM material
// consumed at that stage has a sampling_rate_pct chance of generating a task
// asking the operator for the batch's real usage. The partial unique index
// keeps at most one pending question per card+process+material.
const maybeCreateSamplingTasks = async ({ cardId, sku, storeLocation, process, batchQty }) => {
  const settings = await loadProductionSettings();
  const rate = Number(settings.sampling_rate_pct || 0);
  if (rate <= 0) return 0;

  const bomRes = await pool.query(
    `SELECT m.material_id
     FROM product_material_map m
     WHERE UPPER(m.sku) = $1
       AND m.process = $2
       AND m.qty_per_unit > 0`,
    [String(sku || '').toUpperCase(), process]
  );

  let created = 0;
  for (const row of bomRes.rows || []) {
    if (Math.random() * 100 >= rate) continue;
    const insertRes = await pool.query(
      `INSERT INTO production_task_samples (card_id, sku, store_location, process, material_id, batch_qty)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (card_id, process, material_id) WHERE status = 'pending' DO NOTHING`,
      [cardId, String(sku || '').toUpperCase(), storeLocation, process, row.material_id, Math.max(0, Number(batchQty) || 0)]
    );
    created += insertRes.rowCount;
  }
  return created;
};

const listCardTasks = async (cardId) => {
  const res = await pool.query(
    `SELECT t.id, t.process, t.material_id, t.batch_qty, t.prompted_at,
            c.code AS material_code, c.name AS material_name, c.unit_measure
     FROM production_task_samples t
     JOIN production_material_catalog c ON c.id = t.material_id
     WHERE t.card_id = $1
       AND t.status = 'pending'
     ORDER BY t.prompted_at ASC, t.id ASC`,
    [cardId]
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    process: row.process,
    material_id: Number(row.material_id),
    material_code: row.material_code,
    material_name: row.material_name,
    unit_measure: row.unit_measure,
    batch_qty: Number(row.batch_qty || 0),
    prompted_at: row.prompted_at
  }));
};

const resolveTask = async (taskId, { qtyUsed = null, skip = false, userId }) => {
  const id = Number.parseInt(taskId, 10);
  if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, 'ID de tarea inválido');

  if (!skip) {
    const qty = Number(qtyUsed);
    if (!Number.isFinite(qty) || qty < 0) {
      throw createHttpError(400, 'Cantidad usada inválida. Debe ser un número >= 0');
    }
  }

  const res = await pool.query(
    `UPDATE production_task_samples
     SET status = $2,
         qty_used = $3,
         completed_by = $4,
         completed_at = NOW()
     WHERE id = $1
       AND status = 'pending'
     RETURNING id, sku, process, material_id, qty_used, batch_qty, status`,
    [id, skip ? 'skipped' : 'done', skip ? null : Number(qtyUsed), userId || null]
  );
  if (res.rowCount === 0) throw createHttpError(404, 'Tarea no encontrada o ya resuelta');
  return res.rows[0];
};

// Pending-task counts for a set of card ids (badge on the board).
const countPendingTasksByCard = async (cardIds = []) => {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return new Map();
  const res = await pool.query(
    `SELECT card_id, COUNT(*)::int AS pending
     FROM production_task_samples
     WHERE status = 'pending'
       AND card_id = ANY($1::int[])
     GROUP BY card_id`,
    [cardIds]
  );
  return new Map(res.rows.map((row) => [Number(row.card_id), Number(row.pending)]));
};

// Real vs standard: material usage from completed samples, stage times from
// the movement log (interval between entering a stage and the next move).
const getVarianceReport = async () => {
  const materialsRes = await pool.query(
    `SELECT s.sku, s.material_id, c.code, c.name, c.unit_measure,
            COUNT(*)::int AS samples,
            AVG(s.qty_used / NULLIF(s.batch_qty, 0)) AS avg_qty_per_piece,
            MAX(m.qty_per_unit) AS std_qty_per_piece
     FROM production_task_samples s
     JOIN production_material_catalog c ON c.id = s.material_id
     LEFT JOIN product_material_map m
       ON UPPER(m.sku) = UPPER(s.sku) AND m.material_id = s.material_id
     WHERE s.status = 'done'
       AND s.qty_used IS NOT NULL
       AND s.batch_qty > 0
     GROUP BY s.sku, s.material_id, c.code, c.name, c.unit_measure
     ORDER BY s.sku, c.name`
  );

  const timesRes = await pool.query(
    `WITH durations AS (
       SELECT e.sku, e.to_stage AS process,
              EXTRACT(EPOCH FROM (
                LEAD(e.moved_at) OVER (PARTITION BY e.card_id ORDER BY e.moved_at, e.id) - e.moved_at
              )) / 60.0 AS minutes
       FROM production_stage_events e
     )
     SELECT d.sku, d.process,
            COUNT(*)::int AS observed,
            AVG(d.minutes) AS avg_minutes,
            MAX(p.std_minutes) AS std_minutes
     FROM durations d
     LEFT JOIN product_process_steps p
       ON UPPER(p.sku) = UPPER(d.sku) AND p.process = d.process
     WHERE d.minutes IS NOT NULL
     GROUP BY d.sku, d.process
     ORDER BY d.sku, d.process`
  );

  const pct = (actual, std) => {
    if (!Number.isFinite(actual) || !Number.isFinite(std) || std <= 0) return null;
    return Number((((actual - std) / std) * 100).toFixed(1));
  };

  return {
    materials: materialsRes.rows.map((row) => {
      const avg = row.avg_qty_per_piece !== null ? Number(Number(row.avg_qty_per_piece).toFixed(4)) : null;
      const std = row.std_qty_per_piece !== null ? Number(row.std_qty_per_piece) : null;
      return {
        sku: row.sku,
        material_id: Number(row.material_id),
        code: row.code,
        name: row.name,
        unit_measure: row.unit_measure,
        samples: Number(row.samples),
        std_qty_per_piece: std,
        avg_qty_per_piece: avg,
        delta_pct: avg !== null && std !== null ? pct(avg, std) : null
      };
    }),
    times: timesRes.rows.map((row) => {
      const avg = row.avg_minutes !== null ? Number(Number(row.avg_minutes).toFixed(1)) : null;
      const std = row.std_minutes !== null ? Number(row.std_minutes) : null;
      return {
        sku: row.sku,
        process: row.process,
        observed: Number(row.observed),
        std_minutes: std,
        avg_minutes: avg,
        delta_pct: avg !== null && std !== null ? pct(avg, std) : null
      };
    })
  };
};

module.exports = {
  countPendingTasksByCard,
  getVarianceReport,
  listCardTasks,
  maybeCreateSamplingTasks,
  resolveTask
};
