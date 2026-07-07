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
    // Any active product qualifies as gift: the regalo field is filled only
    // by the ruleta, and marketing picks the prize from the full catalog.
    return {
      gift_name: String(giftProduct.name || '').trim() || normalizedGift.name || null,
      gift_sku: String(giftProduct.sku || '').trim().toUpperCase(),
      gift_qty: normalizedGift.qty
    };
  }

  const legacyGiftName = giftNameLegacy ? String(giftNameLegacy).trim() : '';
  if (legacyGiftName) {
    return {
      gift_name: legacyGiftName,
      gift_sku: null,
      gift_qty: 1
    };
  }
  return {
    gift_name: null,
    gift_sku: null,
    gift_qty: 1
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

  const giftSku = String(giftSelection?.gift_sku || '').trim().toUpperCase();
  const giftQty = Number.parseInt(giftSelection?.gift_qty, 10);
  if (giftSku && Number.isInteger(giftQty) && giftQty > 0) {
    const stockCheck = await client.query(
      `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
      [giftSku]
    );
    if (stockCheck.rowCount === 0) throw new Error(`Producto de regalo ${giftSku} no encontrado`);
    const currentStock = Number(stockCheck.rows[0][warehouseField] || 0);
    if (currentStock < giftQty) throw new Error(`Stock insuficiente para regalo ${giftSku}`);
    await client.query(
      `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
      [giftQty, giftSku]
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
  flattenQuoteLineItemsToSkuQtyMap,
  getQuoteSaveIdempotencyCacheKey,
  lineItemsFingerprint,
  normalizeGiftSelection,
  normalizeQuotePaymentMethod,
  parseAndNormalizeQuoteRows,
  pruneQuoteSaveIdempotencyCache,
  quoteSaveIdempotencyCache,
  resolveGiftSelectionForQuote
};
