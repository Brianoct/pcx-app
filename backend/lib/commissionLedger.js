// Libro de comisiones (ver migración 20261124_commission_ledger.sql).
//
// syncCommissionLedger(client, quoteId) se llama después de CUALQUIER cambio a
// una cotización. No necesita saber qué cambió: compara lo que el libro ya
// tiene para esa cotización con lo que debería tener según su estado actual y
// escribe solo la diferencia, fechada en el mes abierto. Por eso:
//   · cobrar           → asiento +total (venta)
//   · enviar           → asiento +total (envio, la base de Almacén)
//   · volver a Cotizado o borrar → asiento −total (reverso)
//   · cambiar total o vendedor   → asiento por la diferencia (ajuste)
// y un mes cerrado nunca recibe asientos nuevos: lo que pase después se suma o
// se resta en el siguiente mes abierto.
const { pool } = require('../db');
const { REPORTING_TIMEZONE } = require('./reporting');

// Estados que cuentan como venta cobrada. Confirmado NO: todavía no pagó.
const PAID_STATUSES = ['Pagado', 'Embalado', 'Enviado'];
const SHIPPED_STATUS = 'Enviado';
const KIND_SALE = 'venta';
const KIND_SHIPMENT = 'envio';

const isClosed = async (client, year, month) => {
  const res = await client.query(
    'SELECT 1 FROM commission_closures WHERE period_year = $1 AND period_month = $2',
    [year, month]
  );
  return res.rowCount > 0;
};

// Fecha del asiento: ahora, salvo que el mes en curso (hora Bolivia) ya esté
// cerrado; entonces el primer instante del siguiente mes abierto. Devuelve
// una expresión SQL lista para usar como valor.
const resolveEntryTimestamp = async (client) => {
  const nowRes = await client.query(
    `SELECT EXTRACT(YEAR FROM timezone('${REPORTING_TIMEZONE}', NOW()))::int AS y,
            EXTRACT(MONTH FROM timezone('${REPORTING_TIMEZONE}', NOW()))::int AS m`
  );
  let { y, m } = nowRes.rows[0];
  if (!(await isClosed(client, y, m))) return { sql: "(NOW() AT TIME ZONE 'UTC')", rolled: false };
  for (let i = 0; i < 24; i += 1) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (!(await isClosed(client, y, m))) break;
  }
  // Medianoche de Bolivia del día 1, guardada en UTC como el resto de fechas.
  return {
    sql: `(make_timestamp(${y}, ${m}, 1, 0, 0, 0) AT TIME ZONE '${REPORTING_TIMEZONE}' AT TIME ZONE 'UTC')`,
    rolled: true
  };
};

const keyOf = (userId, store) => `${userId ?? ''}|${store ?? ''}`;

const syncCommissionLedger = async (client, quoteId, { deleted = false } = {}) => {
  const db = client || pool;
  const id = Number(quoteId);
  if (!Number.isInteger(id) || id <= 0) return { entries: 0 };

  const quoteRes = await db.query(
    'SELECT id, user_id, store_location, total, status, paid_at FROM quotes WHERE id = $1',
    [id]
  );
  const quote = deleted ? null : (quoteRes.rows[0] || null);
  const status = String(quote?.status || '');
  const total = Math.round(Number(quote?.total || 0) * 100) / 100;
  const paid = Boolean(quote) && PAID_STATUSES.includes(status);
  const shipped = Boolean(quote) && status === SHIPPED_STATUS;

  const currentRes = await db.query(
    `SELECT kind, user_id, store_location, SUM(total) AS net
     FROM commission_entries WHERE quote_id = $1
     GROUP BY kind, user_id, store_location`,
    [id]
  );

  let written = 0;
  let entryAt = null;
  for (const [kind, active] of [[KIND_SALE, paid], [KIND_SHIPMENT, shipped]]) {
    const current = new Map();
    for (const row of currentRes.rows) {
      if (row.kind !== kind) continue;
      current.set(keyOf(row.user_id, row.store_location), {
        user_id: row.user_id, store_location: row.store_location, net: Number(row.net || 0)
      });
    }
    const desired = new Map();
    if (active) {
      desired.set(keyOf(quote.user_id, quote.store_location), {
        user_id: quote.user_id, store_location: quote.store_location, net: total
      });
    }
    const hadAny = [...current.values()].some((c) => Math.abs(c.net) > 0.004);
    for (const key of new Set([...current.keys(), ...desired.keys()])) {
      const cur = current.get(key);
      const want = desired.get(key);
      const delta = Math.round(((want?.net || 0) - (cur?.net || 0)) * 100) / 100;
      if (Math.abs(delta) < 0.005) continue;
      const reason = !active ? 'reverso'
        : (!hadAny ? (kind === KIND_SALE ? 'pago' : 'envio') : 'ajuste');
      if (!entryAt) entryAt = await resolveEntryTimestamp(db);
      const who = want || cur;
      await db.query(
        `INSERT INTO commission_entries (quote_id, kind, user_id, store_location, total, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, ${entryAt.sql})`,
        [id, kind, who.user_id, who.store_location, delta, reason]
      );
      written += 1;
    }
  }

  // Fecha real de cobro en la cotización (para mostrarla; no decide el mes).
  if (quote) {
    if (paid && !quote.paid_at) await db.query("UPDATE quotes SET paid_at = (NOW() AT TIME ZONE 'UTC') WHERE id = $1", [id]);
    if (!paid && quote.paid_at) await db.query('UPDATE quotes SET paid_at = NULL WHERE id = $1', [id]);
  }
  return { entries: written, rolled: Boolean(entryAt?.rolled) };
};

// Nunca debe tumbar una venta: si el libro falla se registra y se sigue.
const syncCommissionLedgerSafe = async (client, quoteId, options) => {
  try {
    return await syncCommissionLedger(client, quoteId, options);
  } catch (err) {
    console.error('Libro de comisiones: no se pudo sincronizar la cotización', quoteId, err.message);
    return { entries: 0, error: err.message };
  }
};

// ── Cierre de mes ───────────────────────────────────────────────────────────
const getClosure = async (year, month) => {
  const res = await pool.query(
    `SELECT c.period_year, c.period_month, c.snapshot, c.closed_at, c.closed_by,
            COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS closed_by_name
     FROM commission_closures c LEFT JOIN users u ON u.id = c.closed_by
     WHERE c.period_year = $1 AND c.period_month = $2`,
    [year, month]
  );
  return res.rows[0] || null;
};

const listClosures = async () => {
  const res = await pool.query(
    'SELECT period_year, period_month, closed_at FROM commission_closures ORDER BY period_year DESC, period_month DESC LIMIT 36'
  );
  return res.rows.map((r) => ({ year: r.period_year, month: r.period_month, closed_at: r.closed_at }));
};

module.exports = {
  KIND_SALE,
  KIND_SHIPMENT,
  PAID_STATUSES,
  getClosure,
  listClosures,
  resolveEntryTimestamp,
  syncCommissionLedger,
  syncCommissionLedgerSafe
};
