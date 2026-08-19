const { normalizeText } = require('./rbac');
const { createHttpError } = require('./util');

const QUOTE_STATUSES = ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado'];

const FINALIZED_QUOTE_STATUSES = ['Confirmado', 'Pagado', 'Embalado', 'Enviado'];

const QUOTE_PAYMENT_METHODS = ['QR', 'Efectivo', 'Mixto'];

const QUOTE_PAYMENT_ALLOWED_STATUSES = ['Pagado', 'Embalado', 'Enviado'];

const QUOTE_SAVE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

const quoteSaveIdempotencyCache = new Map();

const normalizeQuotePaymentMethod = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = normalizeText(trimmed);
  if (normalized === 'qr' || normalized === 'codigo qr' || normalized === 'codigoqr') {
    return 'QR';
  }
  if (normalized === 'efectivo' || normalized === 'cash') {
    return 'Efectivo';
  }
  if (
    normalized === 'mixto'
    || normalized === 'mixed'
    || normalized === 'mixta'
    || normalized === 'qr + efectivo'
    || normalized === 'efectivo + qr'
    || normalized === 'qr y efectivo'
    || normalized === 'efectivo y qr'
  ) {
    return 'Mixto';
  }
  return null;
};

const pruneQuoteSaveIdempotencyCache = () => {
  const now = Date.now();
  for (const [cacheKey, entry] of quoteSaveIdempotencyCache.entries()) {
    if (!entry || !entry.expiresAt || entry.expiresAt <= now) {
      quoteSaveIdempotencyCache.delete(cacheKey);
    }
  }
};

const getQuoteSaveIdempotencyCacheKey = (userId, headerValue) => {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const key = String(raw || '').trim();
  if (!key) return null;
  return `${userId}:${key.slice(0, 120)}`;
};

const parseAndNormalizeQuoteRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw createHttpError(400, 'Debes agregar al menos una línea de producto');
  }

  return rows.map((rawRow, index) => {
    if (!rawRow || typeof rawRow !== 'object') {
      throw createHttpError(400, `Línea ${index + 1} inválida`);
    }

    const sku = String(rawRow.sku || '').trim().toUpperCase();
    const qty = Number.parseInt(rawRow.qty, 10);
    const unitPriceRaw = Number(rawRow.unitPrice ?? rawRow.unit_price);
    const lineTotalRaw = Number(rawRow.lineTotal ?? rawRow.line_total);
    const isCombo = Boolean(rawRow.isCombo);

    if (!sku) {
      throw createHttpError(400, `Línea ${index + 1}: SKU requerido`);
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw createHttpError(400, `Línea ${index + 1}: cantidad inválida`);
    }
    const resolvedUnitPrice = Number.isFinite(unitPriceRaw)
      ? unitPriceRaw
      : (Number.isFinite(lineTotalRaw) && qty > 0 ? lineTotalRaw / qty : NaN);
    if (!Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice < 0) {
      throw createHttpError(400, `Línea ${index + 1}: precio unitario inválido`);
    }

    const comboItems = Array.isArray(rawRow.comboItems) ? rawRow.comboItems : [];
    const normalizedComboItems = comboItems.map((comboItem, comboIndex) => {
      const comboSku = String(comboItem?.sku || '').trim().toUpperCase();
      const comboQty = Number.parseInt(comboItem?.quantity, 10);
      if (!comboSku || !Number.isInteger(comboQty) || comboQty <= 0) {
        throw createHttpError(
          400,
          `Línea ${index + 1}: item del combo ${comboIndex + 1} inválido`
        );
      }
      return {
        ...comboItem,
        sku: comboSku,
        quantity: comboQty
      };
    });

    if (isCombo && normalizedComboItems.length === 0) {
      throw createHttpError(400, `Línea ${index + 1}: el combo no tiene productos`);
    }

    const lineTotal = Number.isFinite(lineTotalRaw) ? lineTotalRaw : resolvedUnitPrice * qty;
    const displayName = String(
      rawRow.displayName || rawRow.skuDisplay || rawRow.name || sku
    ).trim() || sku;

    return {
      ...rawRow,
      sku,
      qty,
      unitPrice: resolvedUnitPrice,
      lineTotal,
      isCombo,
      comboItems: normalizedComboItems,
      displayName
    };
  });
};

const normalizeGiftSelection = (giftPayload = null) => {
  if (!giftPayload || typeof giftPayload !== 'object' || Array.isArray(giftPayload)) {
    return null;
  }
  const giftSku = String(giftPayload.sku || '').trim().toUpperCase();
  const giftQty = Number.parseInt(giftPayload.qty, 10);
  const giftName = String(giftPayload.name || '').trim();
  if (!giftSku) return null;
  if (!Number.isInteger(giftQty) || giftQty <= 0) {
    throw createHttpError(400, 'Cantidad de regalo inválida');
  }
  return {
    sku: giftSku,
    qty: giftQty,
    name: giftName || null
  };
};

// Envío local cotizado desde el GPS del cliente: cargo en Bs, etiqueta para
// la proforma y las coordenadas "lat,lng" (Almacén abre el mapa al despachar).
// Los tres van juntos: sin cargo no se guarda etiqueta ni GPS.
const normalizeDeliveryFields = ({ delivery_fee_bs, delivery_label, delivery_gps } = {}) => {
  const empty = { fee: null, label: null, gps: null };
  if (delivery_fee_bs === undefined || delivery_fee_bs === null || delivery_fee_bs === '') return empty;
  const fee = Number(delivery_fee_bs);
  if (!Number.isFinite(fee) || fee < 0 || fee > 100000) {
    return { error: 'Cargo de envío local inválido' };
  }
  const label = String(delivery_label || '').trim().slice(0, 160) || null;
  let gps = null;
  const gpsText = String(delivery_gps || '').trim();
  if (gpsText) {
    const match = gpsText.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!match) return { error: 'GPS de envío inválido: usa "lat,lng"' };
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { error: 'GPS de envío fuera de rango' };
    }
    gps = `${lat},${lng}`;
  }
  return { fee: Math.round(fee * 100) / 100, label, gps };
};

// Paquete de regalo (promo «Regalo por compra»): lista [{sku, qty, name}].
const MAX_GIFT_ITEMS = 10;

const normalizeGiftItems = (payload = null) => {
  if (!Array.isArray(payload)) return null;
  const merged = new Map();
  for (const item of payload) {
    const sku = String(item?.sku || '').trim().toUpperCase();
    const qty = Number.parseInt(item?.qty, 10);
    if (!sku || !Number.isInteger(qty) || qty <= 0) continue;
    const existing = merged.get(sku);
    merged.set(sku, {
      sku,
      qty: (existing?.qty || 0) + qty,
      name: String(item?.name || existing?.name || '').trim() || null
    });
  }
  const items = [...merged.values()].slice(0, MAX_GIFT_ITEMS);
  return items.length > 0 ? items : null;
};

// Valida el paquete contra el catálogo (productos reales y activos) y arma la
// selección completa: gift_items + gift_name como resumen legible («6× Gancho
// J + 1× Bandeja») para todos los lugares que muestran un solo texto.
const resolveGiftItemsForQuote = async (client, rawItems) => {
  const items = normalizeGiftItems(rawItems);
  if (!items) return null;
  const res = await client.query(
    `SELECT UPPER(sku) AS sku, name, is_active
     FROM products
     WHERE UPPER(sku) = ANY($1::text[])`,
    [items.map((item) => item.sku)]
  );
  const bySku = new Map(res.rows.map((row) => [row.sku, row]));
  const resolved = items.map((item) => {
    const product = bySku.get(item.sku);
    if (!product) throw createHttpError(400, `El producto de regalo ${item.sku} no existe`);
    if (!product.is_active) throw createHttpError(400, `El producto de regalo ${item.sku} está inactivo`);
    return { sku: item.sku, qty: item.qty, name: String(product.name || '').trim() || item.sku };
  });
  const summary = resolved.map((item) => `${item.qty}× ${item.name}`).join(' + ');
  return {
    gift_name: summary,
    // gift_sku queda en null: el descuento de stock usa gift_items y así no
    // se descuenta dos veces.
    gift_sku: null,
    gift_qty: 1,
    gift_items: resolved
  };
};

// Lista efectiva de regalos a mover en stock: el paquete nuevo o, para
// cotizaciones históricas, el regalo único de la ruleta.
const effectiveGiftItems = (giftSelection = null) => {
  const items = normalizeGiftItems(giftSelection?.gift_items);
  if (items) return items;
  const sku = String(giftSelection?.gift_sku || '').trim().toUpperCase();
  const qty = Number.parseInt(giftSelection?.gift_qty, 10);
  if (sku && Number.isInteger(qty) && qty > 0) return [{ sku, qty, name: null }];
  return [];
};

const giftItemsFingerprint = (giftSelection = null) =>
  effectiveGiftItems(giftSelection)
    .map((item) => `${item.sku}:${item.qty}`)
    .sort()
    .join('|');

const resolveGiftSelectionForQuote = async (client, giftSelection, giftNameLegacy) => {
  const normalizedGift = normalizeGiftSelection(giftSelection);
  if (normalizedGift) {
    const giftProductRes = await client.query(
      `SELECT sku, name, is_active, is_gift_eligible
       FROM products
       WHERE UPPER(sku) = $1`,
      [normalizedGift.sku]
    );
    if (giftProductRes.rowCount === 0) {
      throw createHttpError(400, 'El producto de regalo seleccionado no existe');
    }
    const giftProduct = giftProductRes.rows[0];
    if (!giftProduct.is_active) {
      throw createHttpError(400, 'El producto de regalo seleccionado está inactivo');
    }
    // Legacy: gifts came from the retired prize wheel. The fields stay so
    // historical quotes keep their regalo (pedidos checklist, stock deduct).
    return {
      gift_name: String(giftProduct.name || '').trim() || normalizedGift.name || null,
      gift_sku: String(giftProduct.sku || '').trim().toUpperCase(),
      gift_qty: normalizedGift.qty,
      gift_items: null
    };
  }

  const legacyGiftName = giftNameLegacy ? String(giftNameLegacy).trim() : '';
  if (legacyGiftName) {
    return {
      gift_name: legacyGiftName,
      gift_sku: null,
      gift_qty: 1,
      gift_items: null
    };
  }
  return {
    gift_name: null,
    gift_sku: null,
    gift_qty: 1,
    gift_items: null
  };
};

const flattenQuoteLineItemsToSkuQtyMap = (lineItems = []) => {
  const map = new Map();
  const addQty = (skuValue, qtyValue) => {
    const sku = String(skuValue || '').trim().toUpperCase();
    const qty = Number.parseInt(qtyValue, 10);
    if (!sku || !Number.isInteger(qty) || qty <= 0) return;
    map.set(sku, (map.get(sku) || 0) + qty);
  };

  for (const row of lineItems || []) {
    if (row?.isCombo) {
      for (const comboItem of row.comboItems || []) {
        const comboQty = Number.parseInt(comboItem?.quantity, 10);
        const rowQty = Number.parseInt(row?.qty, 10);
        addQty(comboItem?.sku, (Number.isInteger(comboQty) ? comboQty : 0) * (Number.isInteger(rowQty) ? rowQty : 0));
      }
      continue;
    }
    addQty(row?.sku, row?.qty);
  }

  return map;
};

const lineItemsFingerprint = (lineItems = []) => {
  const entries = [...flattenQuoteLineItemsToSkuQtyMap(lineItems).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([sku, qty]) => `${sku}:${qty}`).join('|');
};

// ─── Helper: Deduct stock for a quote ───────────────────────────────────────
async function deductStockForQuote(client, quoteId, storeLocation, lineItems, giftSelection = null) {
  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[storeLocation];

  if (!warehouseField) throw new Error('Almacén no válido');

  const parseComboIdFromSku = (skuValue = '') => {
    const match = String(skuValue || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const resolveComboItems = async (row) => {
    const comboId = parseComboIdFromSku(row?.sku);
    if (Number.isInteger(comboId) && comboId > 0) {
      const comboItemsRes = await client.query(
        `SELECT sku, quantity
         FROM combo_items
         WHERE combo_id = $1`,
        [comboId]
      );
      const normalizedFromDb = (comboItemsRes.rows || [])
        .map((comboItem) => ({
          sku: String(comboItem?.sku || '').trim().toUpperCase(),
          quantity: Number.parseInt(comboItem?.quantity, 10)
        }))
        .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
      if (normalizedFromDb.length > 0) {
        return normalizedFromDb;
      }
      throw new Error(`Combo COMBO_${comboId} no tiene productos configurados`);
    }

    const inlineItems = Array.isArray(row?.comboItems) ? row.comboItems : [];
    return inlineItems
      .map((comboItem) => ({
        sku: String(comboItem?.sku || '').trim().toUpperCase(),
        quantity: Number.parseInt(comboItem?.quantity, 10)
      }))
      .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
  };

  for (const row of lineItems || []) {
    const rowQty = Number.parseInt(row?.qty, 10);
    if (!Number.isInteger(rowQty) || rowQty <= 0) continue;

    const comboItems = await resolveComboItems(row);
    if (comboItems.length > 0) {
      for (const comboItem of comboItems) {
        const sku = comboItem.sku;
        const qty = comboItem.quantity * rowQty;

        const stockCheck = await client.query(
          `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
          [sku]
        );

        if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
        const currentStock = Number(stockCheck.rows[0][warehouseField] || 0);

        if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

        await client.query(
          `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
          [qty, sku]
        );
      }
      continue;
    }

    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku) continue;
    const qty = rowQty;

    const stockCheck = await client.query(
      `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
      [sku]
    );

    if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
    const currentStock = Number(stockCheck.rows[0][warehouseField] || 0);

    if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

    await client.query(
      `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
      [qty, sku]
    );
  }

  // Regalos: cada ítem del paquete (o el regalo único legacy) descuenta su
  // propio stock, con la misma validación que las líneas de venta.
  for (const giftItem of effectiveGiftItems(giftSelection)) {
    const stockCheck = await client.query(
      `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
      [giftItem.sku]
    );
    if (stockCheck.rowCount === 0) throw new Error(`Producto de regalo ${giftItem.sku} no encontrado`);
    const currentStock = Number(stockCheck.rows[0][warehouseField] || 0);
    if (currentStock < giftItem.qty) throw new Error(`Stock insuficiente para regalo ${giftItem.sku}`);
    await client.query(
      `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
      [giftItem.qty, giftItem.sku]
    );
  }
}

module.exports = {
  FINALIZED_QUOTE_STATUSES,
  QUOTE_PAYMENT_ALLOWED_STATUSES,
  QUOTE_PAYMENT_METHODS,
  QUOTE_SAVE_IDEMPOTENCY_TTL_MS,
  QUOTE_STATUSES,
  deductStockForQuote,
  effectiveGiftItems,
  flattenQuoteLineItemsToSkuQtyMap,
  getQuoteSaveIdempotencyCacheKey,
  giftItemsFingerprint,
  lineItemsFingerprint,
  normalizeDeliveryFields,
  normalizeGiftItems,
  normalizeGiftSelection,
  resolveGiftItemsForQuote,
  normalizeQuotePaymentMethod,
  parseAndNormalizeQuoteRows,
  pruneQuoteSaveIdempotencyCache,
  quoteSaveIdempotencyCache,
  resolveGiftSelectionForQuote
};
