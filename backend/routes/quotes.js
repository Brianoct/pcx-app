const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { getPedidosAccessScope } = require('../lib/inventory');
const { FINALIZED_QUOTE_STATUSES, QUOTE_PAYMENT_ALLOWED_STATUSES, QUOTE_PAYMENT_METHODS, QUOTE_SAVE_IDEMPOTENCY_TTL_MS, QUOTE_STATUSES, deductStockForQuote, getQuoteSaveIdempotencyCacheKey, lineItemsFingerprint, normalizeQuotePaymentMethod, parseAndNormalizeQuoteRows, pruneQuoteSaveIdempotencyCache, quoteSaveIdempotencyCache, resolveGiftSelectionForQuote } = require('../lib/quotes');
const { ROLE_KEYS, canAccessPanel, normalizeRole, normalizeText, sanitizePanelAccess } = require('../lib/rbac');
const { upsertCustomerFromQuote } = require('../lib/customers');
const { loadUserContext, resolveUserDisplayName } = require('../lib/users');
const { createHttpError, getUserDisplayName } = require('../lib/util');

const router = express.Router();

const assertQuoteMutationPermission = async (client, quoteId, reqUserId, userContext, access) => {
  const canManageAnyQuote = Boolean(access?.pedidos_global || access?.historial_global);
  const isPedidosIndividualScoped = Boolean(access?.pedidos_individual) && !canManageAnyQuote;
  let pedidosScope = null;
  if (isPedidosIndividualScoped) {
    pedidosScope = getPedidosAccessScope(userContext, access);
    if (pedidosScope.error) {
      throw createHttpError(403, pedidosScope.error);
    }
  }

  const quoteRes = await client.query(
    `SELECT id, user_id, customer_name, customer_phone, department, provincia, shipping_notes,
            alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent,
            coupon_code, coupon_discount_percent, gift_name, gift_sku, gift_qty, payment_method, payment_cash_bs,
            line_items, subtotal, total, status
     FROM quotes
     WHERE id = $1
     FOR UPDATE`,
    [quoteId]
  );

  if (quoteRes.rowCount === 0) {
    throw createHttpError(404, 'Cotización no encontrada');
  }

  const quote = quoteRes.rows[0];
  if (isPedidosIndividualScoped && pedidosScope && !pedidosScope.isGlobal) {
    if (quote.store_location !== pedidosScope.city) {
      throw createHttpError(403, 'No autorizado para modificar pedidos de otra ciudad');
    }
  } else if (!canManageAnyQuote && quote.user_id !== reqUserId) {
    throw createHttpError(403, 'No autorizado para modificar este pedido');
  }

  return quote;
};

const resolveAssignableVendorName = async (sellerUserId, fallbackName = '') => {
  const parsedId = Number.parseInt(sellerUserId, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw createHttpError(400, 'Vendedor asignado inválido');
  }
  const sellerRes = await pool.query(
    `SELECT id, email, display_name, role
     FROM users
     WHERE id = $1
       AND is_active = TRUE`,
    [parsedId]
  );
  if (sellerRes.rowCount === 0) {
    throw createHttpError(404, 'Vendedor asignado no encontrado o desactivado');
  }
  const seller = sellerRes.rows[0];
  const sellerRole = normalizeRole(seller.role || '');
  const isAssignableSeller = sellerRole === ROLE_KEYS.ventas
    || sellerRole === ROLE_KEYS.ventasLider
    || sellerRole === 'sales'
    || sellerRole === 'vendedor';
  if (!isAssignableSeller) {
    throw createHttpError(400, 'El usuario asignado no pertenece al equipo de ventas');
  }
  const displayName = resolveUserDisplayName(seller, fallbackName || 'Vendedor');
  return displayName;
};

// ─── SAVE new quote ─────────────────────────────────────────────────────────
router.post('/api/quotes', authenticateToken, async (req, res) => {
  const {
    customer_name,
    customer_phone,
    department,
    provincia,
    shipping_notes,
    alternative_name,
    alternative_phone,
    store_location,
    vendor,
    seller_user_id,
    venta_type,
    discount_percent,
    coupon_code,
    coupon_discount_percent,
    gift_name,
    gift_sku,
    gift_qty,
    rows,
    subtotal,
    total,
    status = 'Cotizado'
  } = req.body || {};

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }

  const normalizedStatus = String(status || 'Cotizado').trim();
  if (!QUOTE_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${QUOTE_STATUSES.join(', ')}` });
  }

  if (!customer_name || !customer_phone || !store_location || !venta_type) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para guardar la cotización' });
  }

  let lineItemsWithDisplay;
  let subtotalValue;
  let totalValue;
  let discountPercentValue;
  try {
    lineItemsWithDisplay = parseAndNormalizeQuoteRows(rows);
    subtotalValue = Number(subtotal);
    totalValue = Number(total);
    discountPercentValue = Number(discount_percent ?? 0);
    if (!Number.isFinite(subtotalValue) || subtotalValue < 0) {
      throw createHttpError(400, 'Subtotal inválido');
    }
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      throw createHttpError(400, 'Total inválido');
    }
    if (!Number.isFinite(discountPercentValue) || discountPercentValue < 0 || discountPercentValue > 100) {
      throw createHttpError(400, 'Descuento inválido');
    }
    if (totalValue - subtotalValue > 0.01) {
      throw createHttpError(400, 'El total no puede ser mayor al subtotal');
    }
  } catch (err) {
    const statusCode = err?.statusCode || 400;
    return res.status(statusCode).json({ error: err.message || 'Datos inválidos en la cotización' });
  }

  pruneQuoteSaveIdempotencyCache();
  const idempotencyCacheKey = getQuoteSaveIdempotencyCacheKey(req.user.id, req.headers['x-idempotency-key']);
  if (idempotencyCacheKey) {
    const existing = quoteSaveIdempotencyCache.get(idempotencyCacheKey);
    if (existing?.inFlight) {
      return res.status(409).json({ error: 'La cotización ya se está guardando. Espera un momento.' });
    }
    if (existing?.response) {
      return res.status(existing.statusCode || 201).json({
        ...existing.response,
        duplicate: true
      });
    }
    quoteSaveIdempotencyCache.set(idempotencyCacheKey, {
      inFlight: true,
      expiresAt: Date.now() + QUOTE_SAVE_IDEMPOTENCY_TTL_MS
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const creatorRole = normalizeRole(userContext.role || '');
    const isSalesOwnerRole = creatorRole === ROLE_KEYS.ventas
      || creatorRole === ROLE_KEYS.ventasLider
      || creatorRole === 'sales'
      || creatorRole === 'vendedor';
    const requiresAssignedSeller = !isSalesOwnerRole;
    let quoteOwnerId = req.user.id;
    let vendorDisplayName = String(vendor || '').trim() || getUserDisplayName(userContext, 'Usuario');

    if (requiresAssignedSeller) {
      const selectedSellerId = Number.parseInt(seller_user_id, 10);
      if (!Number.isInteger(selectedSellerId)) {
        throw createHttpError(400, 'Selecciona un vendedor válido para asignar la cotización');
      }
      const sellerRes = await client.query(
        'SELECT id, email, display_name, role FROM users WHERE id = $1 AND is_active = TRUE',
        [selectedSellerId]
      );
      if (sellerRes.rowCount === 0) {
        throw createHttpError(400, 'El vendedor seleccionado no existe o está desactivado');
      }
      const seller = sellerRes.rows[0];
      const sellerRole = normalizeRole(seller.role || '');
      const isAssignableSeller = sellerRole === ROLE_KEYS.ventas || sellerRole === ROLE_KEYS.ventasLider || sellerRole === 'sales' || sellerRole === 'vendedor';
      if (!isAssignableSeller) {
        throw createHttpError(400, 'Solo puedes asignar la cotización a un usuario de ventas');
      }
      quoteOwnerId = seller.id;
      vendorDisplayName = resolveUserDisplayName(seller, vendorDisplayName);
    }

    const giftSelection = await resolveGiftSelectionForQuote(
      client,
      { sku: gift_sku, qty: gift_qty, name: gift_name },
      gift_name
    );

    const quoteResult = await client.query(
      `INSERT INTO quotes (
        user_id, customer_name, customer_phone, department, provincia, shipping_notes,
        alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent,
        coupon_code, coupon_discount_percent, gift_name, gift_sku, gift_qty, line_items, subtotal, total, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
      RETURNING id`,
      [
        quoteOwnerId,
        customer_name,
        customer_phone,
        department || null,
        provincia || null,
        shipping_notes || null,
        alternative_name || null,
        alternative_phone || null,
        store_location,
        vendorDisplayName,
        venta_type,
        discountPercentValue,
        coupon_code ? String(coupon_code).trim().toUpperCase() : null,
        Number.isFinite(Number(coupon_discount_percent)) ? Number(coupon_discount_percent) : 0,
        giftSelection.gift_name,
        giftSelection.gift_sku,
        giftSelection.gift_qty,
        JSON.stringify(lineItemsWithDisplay),
        subtotalValue,
        totalValue,
        normalizedStatus
      ]
    );

    const quoteId = quoteResult.rows[0].id;

    // Only deduct stock if initial status is finalized.
    if (FINALIZED_QUOTE_STATUSES.includes(normalizedStatus)) {
      await deductStockForQuote(client, quoteId, store_location, lineItemsWithDisplay, {
        gift_sku: giftSelection.gift_sku,
        gift_qty: giftSelection.gift_qty
      });
    }

    await client.query('COMMIT');

    // CRM: keep the customer book current (non-blocking; failures logged only).
    await upsertCustomerFromQuote({
      name: customer_name,
      phone: customer_phone,
      department,
      provincia,
      vendor: vendorDisplayName,
      userId: req.user.id
    });

    const responseBody = { id: quoteId, message: 'Cotización guardada' };
    if (idempotencyCacheKey) {
      quoteSaveIdempotencyCache.set(idempotencyCacheKey, {
        inFlight: false,
        statusCode: 201,
        response: responseBody,
        expiresAt: Date.now() + QUOTE_SAVE_IDEMPOTENCY_TTL_MS
      });
    }
    res.status(201).json(responseBody);
  } catch (err) {
    await client.query('ROLLBACK');
    if (idempotencyCacheKey) {
      quoteSaveIdempotencyCache.delete(idempotencyCacheKey);
    }
    console.error(err);
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ error: err.message || 'Error al guardar cotización' });
  } finally {
    client.release();
  }
});

// ─── GET quotes (personal or team) ──────────────────────────────────────────
router.get('/api/quotes', authenticateToken, async (req, res) => {
  const { team } = req.query;
  const isTeamView = team === 'true';
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const hasAnyPedidosAccess = Boolean(access.pedidos_individual || access.pedidos_global);
  const pedidosScope = hasAnyPedidosAccess ? getPedidosAccessScope(userContext, access) : null;
  if (hasAnyPedidosAccess && pedidosScope?.error) return res.status(403).json({ error: pedidosScope.error });

  if (isTeamView) {
    const canSeeGlobalHistory = access.historial_global || access.pedidos_global;
    if (!canSeeGlobalHistory) {
      return res.status(403).json({ error: 'No tienes permiso para historial/pedidos global' });
    }
  } else {
    const canSeeOwnHistory = access.historial_individual || access.pedidos_individual;
    if (!canSeeOwnHistory) {
      return res.status(403).json({ error: 'No tienes permiso para historial/pedidos individual' });
    }
  }

  try {
    let query = '';
    let params = [];

    if (isTeamView) {
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.payment_method, q.payment_cash_bs,
                      q.gift_name, q.gift_sku, q.gift_qty,
                      q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               ORDER BY q.created_at DESC`;
      params = [];
    } else if (access.pedidos_individual && !access.historial_individual && !pedidosScope.isGlobal) {
      // Pedidos individual: scope by assigned city/store.
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.payment_method, q.payment_cash_bs,
                      q.gift_name, q.gift_sku, q.gift_qty,
                      q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               WHERE q.store_location = $1
               ORDER BY q.created_at DESC`;
      params = [pedidosScope.city];
    } else {
      // Historial individual: own quotes only.
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.payment_method, q.payment_cash_bs,
                      q.gift_name, q.gift_sku, q.gift_qty,
                      q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               WHERE q.user_id = $1
               ORDER BY q.created_at DESC`;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ─── GET seller contact by quote id (team roles) ───────────────────────────
router.get('/api/quotes/:id/seller-contact', authenticateToken, async (req, res) => {
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const canAccessAllQuotes = ['ventas lider', 'admin', 'almacen lider', 'almacen'].includes(userRoleNormalized);

  try {
    const result = await pool.query(
      `SELECT q.user_id, u.email AS seller_email, u.phone AS seller_phone
       FROM quotes q
       LEFT JOIN users u ON u.id = q.user_id
       WHERE q.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const row = result.rows[0];
    if (!canAccessAllQuotes && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este contacto' });
    }

    res.json({
      seller_email: row.seller_email,
      seller_phone: row.seller_phone
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener contacto del vendedor' });
  }
});

// ─── GET single quote for checklist with displayName ────────────────────────
router.get('/api/quotes/:id/checklist', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canAccessAllQuotes = access.pedidos_global || access.historial_global;
  const pedidosScope = getPedidosAccessScope(userContext, access);
  if (pedidosScope.error) return res.status(403).json({ error: pedidosScope.error });

  try {
    const result = await pool.query(
      `SELECT id, user_id, customer_name, customer_phone, department, provincia, store_location,
              vendor, status, line_items, created_at, alternative_name, alternative_phone,
              coupon_code, coupon_discount_percent, gift_name, gift_sku, gift_qty
       FROM quotes WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const quote = result.rows[0];
    const isPedidosIndividualScoped = Boolean(access?.pedidos_individual)
      && !canAccessAllQuotes
      && !Boolean(access?.historial_individual)
      && !pedidosScope.isGlobal;
    if (isPedidosIndividualScoped) {
      if (quote.store_location !== pedidosScope.city) {
        return res.status(403).json({ error: 'No autorizado para ver pedidos de otra ciudad' });
      }
    } else if (!canAccessAllQuotes && quote.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este pedido' });
    }

    const rawLineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
    const parseComboIdFromSku = (skuValue = '') => {
      const match = String(skuValue || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
      return match ? Number.parseInt(match[1], 10) : null;
    };
    const formatRowLabel = (row) => {
      const rawLabel = String(row?.displayName || row?.skuDisplay || row?.sku || 'Producto desconocido').trim() || 'Producto desconocido';
      const comboMatch = String(row?.sku || '').trim().toUpperCase().match(/^COMBO_(\d+)$/);
      if (!comboMatch) return rawLabel;
      const cleaned = rawLabel.replace(/^COMBO_\d+\s*-\s*/i, '').trim();
      return cleaned || rawLabel;
    };
    const normalizeSkuName = (skuValue = '', nameValue = '') => {
      const normalizedSku = String(skuValue || '').trim().toUpperCase();
      const rawName = String(nameValue || '').trim();
      if (!normalizedSku) return rawName || 'Producto desconocido';
      if (!rawName) return 'Producto desconocido';
      const duplicatePrefixPattern = new RegExp(`^${normalizedSku}\\s*-\\s*`, 'i');
      const withoutDuplicatePrefix = rawName.replace(duplicatePrefixPattern, '').trim();
      if (!withoutDuplicatePrefix) return 'Producto desconocido';
      const normalizedName = withoutDuplicatePrefix.toUpperCase() === normalizedSku
        ? 'Producto desconocido'
        : withoutDuplicatePrefix;
      return normalizedName || 'Producto desconocido';
    };

    const resolveComboItems = async (row) => {
      const comboId = parseComboIdFromSku(row?.sku);
      if (Number.isInteger(comboId) && comboId > 0) {
        const comboItemsRes = await pool.query(
          `SELECT ci.sku, ci.quantity, p.name
           FROM combo_items ci
           LEFT JOIN products p ON UPPER(p.sku) = UPPER(ci.sku)
           WHERE ci.combo_id = $1
           ORDER BY ci.sku ASC`,
          [comboId]
        );
        const normalizedFromDb = (comboItemsRes.rows || [])
          .map((comboItem) => ({
            sku: String(comboItem?.sku || '').trim().toUpperCase(),
            quantity: Number.parseInt(comboItem?.quantity, 10),
            name: String(comboItem?.name || '').trim()
          }))
          .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
        if (normalizedFromDb.length > 0) {
          return normalizedFromDb;
        }
      }

      const inlineItems = Array.isArray(row?.comboItems) ? row.comboItems : [];
      const normalizedInline = inlineItems
        .map((comboItem) => ({
          sku: String(comboItem?.sku || '').trim().toUpperCase(),
          quantity: Number.parseInt(comboItem?.quantity, 10),
          name: String(comboItem?.name || comboItem?.displayName || '').trim()
        }))
        .filter((comboItem) => comboItem.sku && Number.isInteger(comboItem.quantity) && comboItem.quantity > 0);
      if (normalizedInline.length === 0) {
        return [];
      }
      const missingNameSkus = normalizedInline
        .filter((comboItem) => !comboItem.name)
        .map((comboItem) => comboItem.sku);
      if (missingNameSkus.length === 0) {
        return normalizedInline;
      }
      const namesRes = await pool.query(
        `SELECT sku, name
         FROM products
         WHERE UPPER(sku) = ANY($1::text[])`,
        [missingNameSkus]
      );
      const namesBySku = new Map(
        (namesRes.rows || []).map((productRow) => [
          String(productRow?.sku || '').trim().toUpperCase(),
          String(productRow?.name || '').trim()
        ])
      );
      return normalizedInline.map((comboItem) => ({
        ...comboItem,
        name: comboItem.name || namesBySku.get(comboItem.sku) || comboItem.sku
      }));
    };

    const items = [];
    for (const row of rawLineItems) {
      const rowQty = Number.parseInt(row?.qty, 10);
      if (!Number.isInteger(rowQty) || rowQty <= 0) continue;

      const rowLabel = formatRowLabel(row);
      const comboItems = await resolveComboItems(row);
      if (comboItems.length > 0) {
        items.push({
          displayName: rowLabel,
          qty: rowQty,
          isComboHeader: true,
          isIndented: false,
          isCheckable: false
        });
        for (const comboItem of comboItems) {
          const componentQty = comboItem.quantity * rowQty;
          items.push({
            displayName: normalizeSkuName(comboItem.sku, comboItem.name),
            sku: comboItem.sku,
            qty: componentQty,
            isComboHeader: false,
            isIndented: true,
            isCheckable: true
          });
        }
        continue;
      }

      items.push({
        displayName: rowLabel,
        sku: String(row?.sku || '').trim().toUpperCase() || null,
        qty: rowQty,
        isComboHeader: false,
        isIndented: false,
        isCheckable: true
      });
    }

    // The regalo must be PACKED, so it is a checkable line in the list — not
    // just an informative chip that's easy to miss.
    if (quote.gift_name || quote.gift_sku) {
      items.push({
        displayName: `REGALO — ${String(quote.gift_name || quote.gift_sku).trim()}`,
        sku: String(quote.gift_sku || '').trim().toUpperCase() || null,
        qty: Math.max(1, Number.parseInt(quote.gift_qty, 10) || 1),
        isComboHeader: false,
        isIndented: false,
        isCheckable: true,
        isGift: true
      });
    }

    const promoSections = [];
    if (quote.coupon_code) {
      const couponPercent = Number(quote.coupon_discount_percent || 0);
      promoSections.push({
        type: 'coupon',
        title: 'Cupón',
        code: String(quote.coupon_code).trim().toUpperCase(),
        discount_percent: Number.isFinite(couponPercent) ? couponPercent : 0,
        label: Number.isFinite(couponPercent) && couponPercent > 0
          ? `Cupón ${String(quote.coupon_code).trim().toUpperCase()} (${couponPercent}%)`
          : `Cupón ${String(quote.coupon_code).trim().toUpperCase()}`
      });
    }
    if (quote.gift_name || quote.gift_sku) {
      promoSections.push({
        type: 'gift',
        title: 'Regalo',
        name: String(quote.gift_name || '').trim() || null,
        sku: String(quote.gift_sku || '').trim().toUpperCase() || null,
        qty: Math.max(1, Number.parseInt(quote.gift_qty, 10) || 1),
        label: String(quote.gift_name || '').trim()
          ? `Regalo: ${String(quote.gift_name).trim()}`
          : 'Regalo'
      });
    }

    res.json({
      id: quote.id,
      customer_name: quote.customer_name,
      customer_phone: quote.customer_phone,
      alternative_name: quote.alternative_name,
      alternative_phone: quote.alternative_phone,
      department: quote.department,
      provincia: quote.provincia,
      store_location: quote.store_location,
      vendor: quote.vendor,
      status: quote.status,
      created_at: quote.created_at,
      coupon_code: quote.coupon_code,
      coupon_discount_percent: quote.coupon_discount_percent,
      gift_name: quote.gift_name,
      gift_sku: quote.gift_sku || null,
      gift_qty: Math.max(1, Number.parseInt(quote.gift_qty, 10) || 1),
      promo_sections: promoSections,
      items
    });
  } catch (err) {
    console.error('Error fetching checklist:', err);
    res.status(500).json({ error: 'Error al obtener checklist' });
  }
});

// ─── UPDATE quote status (deduct stock only from Cotizado → other) ──────────
router.patch('/api/quotes/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado'];
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canManageAnyQuote = access.pedidos_global || access.historial_global;
  const pedidosScope = getPedidosAccessScope(userContext, access);
  if (pedidosScope.error) return res.status(403).json({ error: pedidosScope.error });

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${validStatuses.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      'SELECT user_id, status, store_location, line_items, gift_sku, gift_qty FROM quotes WHERE id = $1',
      [req.params.id]
    );

    if (currentRes.rowCount === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const isPedidosIndividualScoped = access.pedidos_individual && !canManageAnyQuote && !pedidosScope.isGlobal;
    if (isPedidosIndividualScoped) {
      if (currentRes.rows[0].store_location !== pedidosScope.city) {
        return res.status(403).json({ error: 'No autorizado para actualizar pedidos de otra ciudad' });
      }
    } else if (!canManageAnyQuote && currentRes.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para actualizar este pedido' });
    }

    const currentStatus = currentRes.rows[0].status;
    const storeLocation = currentRes.rows[0].store_location;
    const lineItems = currentRes.rows[0].line_items;
    const giftSku = String(currentRes.rows[0].gift_sku || '').trim().toUpperCase() || null;
    const giftQty = Math.max(1, Number.parseInt(currentRes.rows[0].gift_qty, 10) || 1);

    // Deduct stock only if moving FROM Cotizado to something else
    if (currentStatus === 'Cotizado' && status !== 'Cotizado') {
      await deductStockForQuote(client, req.params.id, storeLocation, lineItems, {
        gift_sku: giftSku,
        gift_qty: giftQty
      });
    }

    const updateRes = await client.query(
      'UPDATE quotes SET status = $1 WHERE id = $2 RETURNING status',
      [status, req.params.id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Estado actualizado', status: updateRes.rows[0].status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al actualizar estado' });
  } finally {
    client.release();
  }
});

router.patch('/api/quotes/:id/payment-method', authenticateToken, async (req, res) => {
  const quoteId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ error: 'ID de cotización inválido' });
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
    ? req.body
    : {};
  const hasPaymentMethodField = Object.prototype.hasOwnProperty.call(body, 'payment_method');
  const hasCashField = Object.prototype.hasOwnProperty.call(body, 'payment_cash_bs');
  if (!hasPaymentMethodField && !hasCashField) {
    return res.status(400).json({ error: 'Debes enviar payment_method o payment_cash_bs' });
  }

  const rawPaymentMethod = body?.payment_method;
  const normalizedPaymentMethod = normalizeQuotePaymentMethod(rawPaymentMethod);
  if (hasPaymentMethodField && rawPaymentMethod !== undefined && rawPaymentMethod !== null && String(rawPaymentMethod).trim() !== '' && !normalizedPaymentMethod) {
    return res.status(400).json({ error: `Método de pago inválido. Usa: ${QUOTE_PAYMENT_METHODS.join(', ')}` });
  }

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentQuote = await assertQuoteMutationPermission(client, quoteId, req.user.id, userContext, access);
    const currentMethod = normalizeQuotePaymentMethod(currentQuote.payment_method);
    const nextPaymentMethod = hasPaymentMethodField ? normalizedPaymentMethod : currentMethod;
    const currentStatus = String(currentQuote.status || '').trim();
    const canMutatePaymentForStatus = QUOTE_PAYMENT_ALLOWED_STATUSES.includes(currentStatus);
    if (nextPaymentMethod && !canMutatePaymentForStatus) {
      throw createHttpError(400, `Solo puedes registrar pago cuando el estado es ${QUOTE_PAYMENT_ALLOWED_STATUSES.join(', ')}`);
    }
    const totalAmount = Number(currentQuote.total || 0);
    const clampMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
    let nextCashBs = null;

    if (nextPaymentMethod === 'QR') {
      nextCashBs = 0;
    } else if (nextPaymentMethod === 'Efectivo') {
      nextCashBs = clampMoney(totalAmount);
    } else if (nextPaymentMethod === 'Mixto') {
      const baseCashRaw = hasCashField ? body.payment_cash_bs : currentQuote.payment_cash_bs;
      const parsedCash = Number(baseCashRaw);
      if (!Number.isFinite(parsedCash) || parsedCash <= 0) {
        return res.status(400).json({ error: 'Para pago mixto debes indicar monto en efectivo mayor a 0' });
      }
      if (totalAmount > 0 && parsedCash >= totalAmount) {
        return res.status(400).json({ error: 'En pago mixto el efectivo debe ser menor al total' });
      }
      nextCashBs = clampMoney(parsedCash);
    }

    const updateRes = await client.query(
      'UPDATE quotes SET payment_method = $1, payment_cash_bs = $2 WHERE id = $3 RETURNING payment_method, payment_cash_bs',
      [nextPaymentMethod, nextCashBs, quoteId]
    );

    await client.query('COMMIT');
    return res.json({
      message: 'Método de pago actualizado',
      payment_method: updateRes.rows[0]?.payment_method || null,
      payment_cash_bs: updateRes.rows[0]?.payment_cash_bs === null || updateRes.rows[0]?.payment_cash_bs === undefined
        ? null
        : Number(updateRes.rows[0].payment_cash_bs)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const statusCode = err?.statusCode || 500;
    console.error(err);
    return res.status(statusCode).json({ error: err.message || 'Error al actualizar método de pago' });
  } finally {
    client.release();
  }
});

// ─── UPDATE quote details (owner/global roles, stock-safe) ───────────────────
router.put('/api/quotes/:id', authenticateToken, async (req, res) => {
  const quoteId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ error: 'ID de cotización inválido' });
  }

  const requestBody = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
    ? req.body
    : {};
  const hasBodyField = (field) => Object.prototype.hasOwnProperty.call(requestBody, field);
  const {
    customer_name,
    customer_phone,
    department,
    provincia,
    shipping_notes,
    alternative_name,
    alternative_phone,
    store_location,
    vendor,
    seller_user_id,
    venta_type,
    discount_percent,
    coupon_code,
    coupon_discount_percent,
    gift_name,
    gift_sku,
    gift_qty,
    rows,
    subtotal,
    total,
    status
  } = requestBody;
  const hasCouponCodeField = hasBodyField('coupon_code');
  const hasCouponDiscountField = hasBodyField('coupon_discount_percent');
  const hasGiftNameField = hasBodyField('gift_name');
  const hasGiftSkuField = hasBodyField('gift_sku');
  const hasGiftQtyField = hasBodyField('gift_qty');

  if (!customer_name || !customer_phone || !store_location || !venta_type) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para actualizar la cotización' });
  }
  const nextVendor = String(vendor || '').trim();
  if (nextVendor && nextVendor.length > 120) {
    return res.status(400).json({ error: 'Vendedor demasiado largo (máx 120)' });
  }

  const normalizedStatus = String(status || 'Cotizado').trim();
  if (!QUOTE_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${QUOTE_STATUSES.join(', ')}` });
  }

  let lineItemsWithDisplay;
  let subtotalValue;
  let totalValue;
  let discountPercentValue;
  try {
    lineItemsWithDisplay = parseAndNormalizeQuoteRows(rows);
    subtotalValue = Number(subtotal);
    totalValue = Number(total);
    discountPercentValue = Number(discount_percent ?? 0);
    if (!Number.isFinite(subtotalValue) || subtotalValue < 0) {
      throw createHttpError(400, 'Subtotal inválido');
    }
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      throw createHttpError(400, 'Total inválido');
    }
    if (!Number.isFinite(discountPercentValue) || discountPercentValue < 0 || discountPercentValue > 100) {
      throw createHttpError(400, 'Descuento inválido');
    }
    if (totalValue - subtotalValue > 0.01) {
      throw createHttpError(400, 'El total no puede ser mayor al subtotal');
    }
  } catch (err) {
    const statusCode = err?.statusCode || 400;
    return res.status(statusCode).json({ error: err.message || 'Datos inválidos en la cotización' });
  }

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });

  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canManageAnyQuote = Boolean(access?.pedidos_global || access?.historial_global);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentQuote = await assertQuoteMutationPermission(
      client,
      quoteId,
      req.user.id,
      userContext,
      access
    );

    const oldStatus = String(currentQuote.status || 'Cotizado');
    const oldStore = currentQuote.store_location;
    const oldLineItems = Array.isArray(currentQuote.line_items) ? currentQuote.line_items : [];
    const wasFinalized = FINALIZED_QUOTE_STATUSES.includes(oldStatus);
    const willBeFinalized = FINALIZED_QUOTE_STATUSES.includes(normalizedStatus);
    const oldStoreKey = normalizeText(oldStore);
    const newStoreKey = normalizeText(store_location);
    const storeChanged = oldStoreKey !== newStoreKey;
    const lineItemsChanged = lineItemsFingerprint(oldLineItems) !== lineItemsFingerprint(lineItemsWithDisplay);
    const hasSellerUserId = seller_user_id !== undefined && seller_user_id !== null && String(seller_user_id).trim() !== '';

    let nextQuoteOwnerId = currentQuote.user_id;
    let nextVendorName = nextVendor || currentQuote.vendor || null;
    if (hasSellerUserId) {
      if (!canManageAnyQuote) {
        throw createHttpError(403, 'No autorizado para reasignar vendedor en esta cotización');
      }
      const selectedSellerId = Number.parseInt(seller_user_id, 10);
      if (!Number.isInteger(selectedSellerId) || selectedSellerId <= 0) {
        throw createHttpError(400, 'Vendedor asignado inválido');
      }
      nextVendorName = await resolveAssignableVendorName(selectedSellerId, nextVendorName || '');
      nextQuoteOwnerId = selectedSellerId;
    }

    const hasAnyGiftField = hasGiftNameField || hasGiftSkuField || hasGiftQtyField;
    const resolvedGift = hasAnyGiftField
      ? await resolveGiftSelectionForQuote(
        client,
        { sku: gift_sku, qty: gift_qty, name: gift_name },
        gift_name
      )
      : {
        gift_name: String(currentQuote.gift_name || '').trim() || null,
        gift_sku: String(currentQuote.gift_sku || '').trim().toUpperCase() || null,
        gift_qty: Math.max(1, Number.parseInt(currentQuote.gift_qty, 10) || 1)
      };
    const currentCouponCode = String(currentQuote.coupon_code || '').trim().toUpperCase() || null;
    const currentCouponDiscount = Number(currentQuote.coupon_discount_percent);
    let nextCouponCode = currentCouponCode;
    if (hasCouponCodeField) {
      const normalizedCouponCode = String(coupon_code || '').trim().toUpperCase();
      nextCouponCode = normalizedCouponCode || null;
    }
    let nextCouponDiscount = Number.isFinite(currentCouponDiscount) ? currentCouponDiscount : 0;
    if (hasCouponDiscountField) {
      const requestedCouponDiscount = Number(coupon_discount_percent);
      nextCouponDiscount = Number.isFinite(requestedCouponDiscount) ? requestedCouponDiscount : 0;
    }
    if (!nextCouponCode) {
      nextCouponDiscount = 0;
    }
    const previousGiftSelection = {
      gift_sku: String(currentQuote.gift_sku || '').trim().toUpperCase() || null,
      gift_qty: Number.parseInt(currentQuote.gift_qty, 10) || 1
    };
    const nextGiftSelection = {
      gift_sku: resolvedGift.gift_sku,
      gift_qty: resolvedGift.gift_qty
    };
    const giftChanged = `${previousGiftSelection.gift_sku || ''}:${previousGiftSelection.gift_qty}`
      !== `${nextGiftSelection.gift_sku || ''}:${nextGiftSelection.gift_qty}`;

    if (wasFinalized && (!willBeFinalized || storeChanged || lineItemsChanged || giftChanged)) {
      await restockStockForQuote(client, oldStore, oldLineItems, previousGiftSelection);
    }
    if (willBeFinalized && (!wasFinalized || storeChanged || lineItemsChanged || giftChanged)) {
      await deductStockForQuote(client, quoteId, store_location, lineItemsWithDisplay, nextGiftSelection);
    }

    await client.query(
      `UPDATE quotes
       SET customer_name = $1,
           customer_phone = $2,
           department = $3,
           provincia = $4,
           shipping_notes = $5,
           alternative_name = $6,
           alternative_phone = $7,
           store_location = $8,
           user_id = $9,
           vendor = $10,
           venta_type = $11,
           discount_percent = $12,
           coupon_code = $13,
           coupon_discount_percent = $14,
           gift_name = $15,
           gift_sku = $16,
           gift_qty = $17,
           line_items = $18,
           subtotal = $19,
           total = $20,
           status = $21
      WHERE id = $22`,
      [
        customer_name,
        customer_phone,
        department || null,
        provincia || null,
        shipping_notes || null,
        alternative_name || null,
        alternative_phone || null,
        store_location,
        nextQuoteOwnerId,
        nextVendorName,
        venta_type,
        discountPercentValue,
        nextCouponCode,
        nextCouponDiscount,
        resolvedGift.gift_name,
        resolvedGift.gift_sku,
        resolvedGift.gift_qty,
        JSON.stringify(lineItemsWithDisplay),
        subtotalValue,
        totalValue,
        normalizedStatus,
        quoteId
      ]
    );
    await client.query('COMMIT');

    // CRM: corrected name/phone on edit also refreshes the customer book.
    await upsertCustomerFromQuote({
      name: customer_name,
      phone: customer_phone,
      department,
      provincia,
      vendor: nextVendorName,
      userId: req.user.id
    });

    return res.json({ message: 'Cotización actualizada', id: quoteId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || 'Error al actualizar cotización' });
  } finally {
    client.release();
  }
});

// ─── DELETE quote (owner/global roles, restores stock if needed) ─────────────
router.delete('/api/quotes/:id', authenticateToken, async (req, res) => {
  const quoteId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ error: 'ID de cotización inválido' });
  }

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentQuote = await assertQuoteMutationPermission(
      client,
      quoteId,
      req.user.id,
      userContext,
      access
    );

    if (FINALIZED_QUOTE_STATUSES.includes(String(currentQuote.status || 'Cotizado'))) {
      await restockStockForQuote(
        client,
        currentQuote.store_location,
        Array.isArray(currentQuote.line_items) ? currentQuote.line_items : [],
        {
          gift_sku: String(currentQuote.gift_sku || '').trim().toUpperCase() || null,
          gift_qty: Number.parseInt(currentQuote.gift_qty, 10) || 1
        }
      );
    }

    await client.query('DELETE FROM quotes WHERE id = $1', [quoteId]);
    await client.query('COMMIT');
    return res.json({ message: 'Cotización eliminada', id: quoteId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || 'Error al eliminar cotización' });
  } finally {
    client.release();
  }
});

// ─── Helper: Restore stock for a quote ───────────────────────────────────────
async function restockStockForQuote(client, storeLocation, lineItems, giftSelection = null) {
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
        const sku = String(comboItem?.sku || '').toUpperCase();
        const qty = Number(comboItem?.quantity || 0) * rowQty;
        if (!sku || qty <= 0) continue;

        await client.query(
          `UPDATE products
           SET ${warehouseField} = ${warehouseField} + $1,
               last_updated = NOW()
           WHERE sku = $2`,
          [qty, sku]
        );
      }
      continue;
    }

    const sku = String(row?.sku || '').toUpperCase();
    const qty = rowQty;
    if (!sku || qty <= 0) continue;

    await client.query(
      `UPDATE products
       SET ${warehouseField} = ${warehouseField} + $1,
           last_updated = NOW()
       WHERE sku = $2`,
      [qty, sku]
    );
  }

  const giftSku = String(giftSelection?.gift_sku || '').trim().toUpperCase();
  const giftQty = Number.parseInt(giftSelection?.gift_qty, 10);
  if (giftSku && Number.isInteger(giftQty) && giftQty > 0) {
    await client.query(
      `UPDATE products
       SET ${warehouseField} = ${warehouseField} + $1,
           last_updated = NOW()
       WHERE sku = $2`,
      [giftQty, giftSku]
    );
  }
}

module.exports = router;
