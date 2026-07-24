// Caja de herramientas de marketing: promociones activables (envío gratis,
// sorteo, ...) que Cotizar consulta al guardar. Reglas clave:
//  - Lo impreso en la proforma se estampa en quotes.promos (snapshot): apagar
//    una herramienta después no cambia promesas ya impresas.
//  - Los códigos de sorteo se generan en el servidor, un código por cliente
//    (único por teléfono normalizado); compras posteriores acumulan tickets.
//  - Los tickets solo valen cuando la cotización está cobrada (Pagado o
//    posterior): se recalculan en cada cambio de estado o edición.
const crypto = require('crypto');
const { pool } = require('../db');

const PROMO_TOOL_TYPES = ['envio_gratis', 'sorteo'];
const PAID_QUOTE_STATUSES = ['Pagado', 'Embalado', 'Enviado'];
const QUOTE_VALIDITY_DAYS = 7; // "Cotización válida por 7 días" en la proforma

const normalizePromoPhone = (value = '') => String(value || '').replace(/\D/g, '');

// Herramientas activas hoy (hora Bolivia). Límite ausente = ventana abierta.
const getActivePromoTools = async (client = pool) => {
  const res = await client.query(
    `SELECT id, tool, name, campaign_id, starts_on::text AS starts_on, ends_on::text AS ends_on, config
     FROM promo_tools
     WHERE active = TRUE
       AND (starts_on IS NULL OR starts_on <= (NOW() AT TIME ZONE 'America/La_Paz')::date)
       AND (ends_on IS NULL OR ends_on >= (NOW() AT TIME ZONE 'America/La_Paz')::date)
     ORDER BY id`
  );
  return res.rows;
};

// Tickets que aporta una compra: alcanzado el mínimo, 1 ticket por cada
// bs_per_ticket (con tope). Sin bs_per_ticket configurado: 1 ticket fijo.
const ticketsForTotal = (config = {}, total = 0) => {
  const amount = Number(total || 0);
  const minTotal = Number(config?.min_total || 0);
  if (amount <= 0 || amount < minTotal) return 0;
  const perTicket = Number(config?.bs_per_ticket || 0);
  if (!perTicket || perTicket <= 0) return 1;
  const cap = Math.max(1, Number(config?.max_tickets || 5));
  return Math.max(1, Math.min(cap, Math.floor(amount / perTicket)));
};

// La promesa impresa nunca contradice el pie "cotización válida 7 días":
// el corte para el cliente es el menor entre el fin de la promo y hoy+7.
const promoValidUntil = (endsOn) => {
  const validity = new Date();
  validity.setDate(validity.getDate() + QUOTE_VALIDITY_DAYS);
  const validityStr = validity.toISOString().slice(0, 10);
  if (!endsOn) return validityStr;
  return String(endsOn) < validityStr ? String(endsOn) : validityStr;
};

const generateSorteoCode = () => {
  // Sin caracteres ambiguos (0/O, 1/I/L) para dictarlo por teléfono sin errores.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `PCX-${suffix}`;
};

// Un código por cliente y herramienta, resuelto atómicamente: dos vendedores
// cotizando al mismo cliente a la vez reciben el MISMO código.
const getOrCreateSorteoCode = async (client, toolId, customerPhone, customerName) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateSorteoCode();
    try {
      const res = await client.query(
        `INSERT INTO promo_codes (tool_id, code, customer_phone, customer_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tool_id, customer_phone)
         DO UPDATE SET customer_name = COALESCE(EXCLUDED.customer_name, promo_codes.customer_name), updated_at = NOW()
         RETURNING id, code`,
        [toolId, code, customerPhone, customerName || null]
      );
      return res.rows[0];
    } catch (err) {
      // Colisión del código aleatorio con otro cliente: generar otro y reintentar.
      if (err.code === '23505' && String(err.constraint || '').includes('code')) continue;
      throw err;
    }
  }
  throw new Error('No se pudo generar un código de sorteo único');
};

// Total del código = suma de tickets de sus cotizaciones COBRADAS. No pisa el
// estado 'ganadora' de un sorteo ya realizado.
const refreshCodeAggregate = async (client, codeId) => {
  await client.query(
    `UPDATE promo_codes pc SET
       tickets = agg.paid_tickets,
       status = CASE
         WHEN pc.status = 'ganadora' THEN pc.status
         WHEN agg.paid_tickets > 0 THEN 'valida'
         ELSE 'pendiente'
       END,
       updated_at = NOW()
     FROM (
       SELECT COALESCE(SUM(tickets) FILTER (WHERE paid), 0)::int AS paid_tickets
       FROM promo_code_quotes WHERE code_id = $1
     ) agg
     WHERE pc.id = $1`,
    [codeId]
  );
};

// Al guardar una cotización: construye el snapshot para la proforma y registra
// el código de sorteo si corresponde. Corre dentro de la transacción del guardado.
const applyPromosToNewQuote = async (client, { quoteId, total, status, customerPhone, customerName }) => {
  const tools = await getActivePromoTools(client);
  if (tools.length === 0) return [];
  const snapshot = [];
  const amount = Number(total || 0);

  for (const tool of tools) {
    const config = tool.config || {};
    if (tool.tool === 'envio_gratis') {
      const minTotal = Number(config.min_total || 0);
      if (amount >= minTotal && amount > 0) {
        snapshot.push({
          tool: 'envio_gratis',
          name: tool.name,
          min_total: minTotal,
          valid_until: promoValidUntil(tool.ends_on)
        });
      }
    } else if (tool.tool === 'sorteo') {
      const phone = normalizePromoPhone(customerPhone);
      const quoteTickets = ticketsForTotal(config, amount);
      if (!phone || quoteTickets <= 0) continue;
      const codeRow = await getOrCreateSorteoCode(client, tool.id, phone, customerName);
      await client.query(
        `INSERT INTO promo_code_quotes (code_id, quote_id, quote_total, tickets, paid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code_id, quote_id)
         DO UPDATE SET quote_total = EXCLUDED.quote_total, tickets = EXCLUDED.tickets, paid = EXCLUDED.paid`,
        [codeRow.id, quoteId, amount, quoteTickets, PAID_QUOTE_STATUSES.includes(status)]
      );
      await refreshCodeAggregate(client, codeRow.id);
      snapshot.push({
        tool: 'sorteo',
        name: tool.name,
        code: codeRow.code,
        tickets: quoteTickets,
        min_total: Number(config.min_total || 0),
        ends_on: tool.ends_on || null
      });
    }
  }
  return snapshot;
};

// Tras un cambio de estado o edición: recalcular tickets/pagado de esa
// cotización y refrescar sus códigos. No bloqueante (los errores solo se loguean).
const syncPromoTicketsForQuote = async (quoteId) => {
  try {
    const quoteRes = await pool.query('SELECT id, total, status FROM quotes WHERE id = $1', [quoteId]);
    if (quoteRes.rowCount === 0) return;
    const quote = quoteRes.rows[0];
    const backingRes = await pool.query(
      `SELECT pcq.id, pcq.code_id, pt.config
       FROM promo_code_quotes pcq
       JOIN promo_codes pc ON pc.id = pcq.code_id
       JOIN promo_tools pt ON pt.id = pc.tool_id
       WHERE pcq.quote_id = $1`,
      [quoteId]
    );
    for (const row of backingRes.rows) {
      const quoteTickets = ticketsForTotal(row.config || {}, quote.total);
      await pool.query(
        'UPDATE promo_code_quotes SET quote_total = $1, tickets = $2, paid = $3 WHERE id = $4',
        [Number(quote.total || 0), quoteTickets, PAID_QUOTE_STATUSES.includes(quote.status), row.id]
      );
      await refreshCodeAggregate(pool, row.code_id);
    }
  } catch (err) {
    console.error('No se pudieron sincronizar tickets de promo para la cotización', quoteId, err);
  }
};

module.exports = {
  PAID_QUOTE_STATUSES,
  PROMO_TOOL_TYPES,
  applyPromosToNewQuote,
  getActivePromoTools,
  normalizePromoPhone,
  promoValidUntil,
  refreshCodeAggregate,
  syncPromoTicketsForQuote,
  ticketsForTotal
};
