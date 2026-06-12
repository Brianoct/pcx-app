const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { CUSTOMER_MENU_CATEGORIES, CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS, CUSTOMER_MENU_IMAGE_DIR, CUSTOMER_MENU_IMAGE_MIME_TO_EXT, CUSTOMER_MENU_TOKEN_PURPOSE, LEGACY_MENU_IMAGE_DIR, ensureCustomerMenuImageDir, getCatalogImageAbsolutePath, normalizeCatalogImageUrl, resolveCatalogLocalImagePath, rewriteLegacyMenuImagePath, toCustomerMenuImageAbsoluteUrl } = require('../lib/customerMenu');
const { resolveInventoryScopeByCity } = require('../lib/inventory');
const { inferProductMenuCategory, loadProductCatalogRows, normalizeProductSku } = require('../lib/products');
const { parseAndNormalizeQuoteRows } = require('../lib/quotes');
const { canAccessPanel, normalizeText } = require('../lib/rbac');
const { loadUserContext, resolveUserDisplayName } = require('../lib/users');
const { normalizeDepartmentLabel } = require('../lib/util');

const router = express.Router();

const loadCustomerMenuEditorContext = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'menu_cliente')) {
    res.status(403).json({ error: 'No tienes permiso para gestionar el catálogo de clientes' });
    return null;
  }
  return userContext;
};

// ─── CUSTOMER PUBLIC MENU (sales share link + public ordering) ───────────────
router.get('/api/customer-menu/images', authenticateToken, async (req, res) => {
  const userContext = await loadCustomerMenuEditorContext(req, res);
  if (!userContext) return;

  try {
    await ensureCustomerMenuImageDir();
    const ownFiles = await fs.readdir(CUSTOMER_MENU_IMAGE_DIR, { withFileTypes: true });
    const legacyFiles = await fs.readdir(LEGACY_MENU_IMAGE_DIR, { withFileTypes: true }).catch(() => []);

    const ownImages = ownFiles
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => {
        const encoded = encodeURIComponent(name);
        const relativePath = `/customer-menu-images/${encoded}`;
        return {
          name,
          source: 'subidas',
          relative_path: relativePath,
          image_url: toCustomerMenuImageAbsoluteUrl(req, relativePath)
        };
      });

    const legacyImages = legacyFiles
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => {
        const legacyPath = `/menu-images/${encodeURIComponent(name)}`;
        const canonicalPath = rewriteLegacyMenuImagePath(legacyPath);
        return {
          name,
          source: 'menu-images',
          relative_path: canonicalPath,
          image_url: toCustomerMenuImageAbsoluteUrl(req, canonicalPath)
        };
      });

    const merged = [...ownImages, ...legacyImages].sort((a, b) => (
      `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`)
    ));
    return res.json(merged);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudieron listar imágenes del catálogo' });
  }
});

router.post('/api/customer-menu/images', authenticateToken, async (req, res) => {
  const userContext = await loadCustomerMenuEditorContext(req, res);
  if (!userContext) return;

  try {
    const rawFilename = String(req.body?.filename || '').trim();
    const dataUrl = String(req.body?.data_url || '').trim();
    if (!rawFilename || !dataUrl) {
      return res.status(400).json({ error: 'Debes enviar filename y data_url' });
    }

    const dataUrlMatch = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!dataUrlMatch) {
      return res.status(400).json({ error: 'Formato de imagen inválido' });
    }
    const mimeType = String(dataUrlMatch[1] || '').toLowerCase();
    const base64Payload = String(dataUrlMatch[2] || '').replace(/\s+/g, '');
    const mimeExt = CUSTOMER_MENU_IMAGE_MIME_TO_EXT[mimeType];
    if (!mimeExt || !CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(mimeExt)) {
      return res.status(400).json({ error: 'Formato no soportado. Usa JPG, PNG, WEBP o GIF' });
    }

    const sourceExt = path.extname(rawFilename).toLowerCase();
    const finalExt = CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS.has(sourceExt) ? sourceExt : mimeExt;
    const baseName = path.basename(rawFilename, path.extname(rawFilename))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'catalogo';
    const finalFilename = `${Date.now()}-${baseName}${finalExt}`;
    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Imagen vacía' });
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'La imagen supera 8MB' });
    }

    await ensureCustomerMenuImageDir();
    const absolutePath = path.join(CUSTOMER_MENU_IMAGE_DIR, finalFilename);
    await fs.writeFile(absolutePath, buffer);

    const relativePath = `/customer-menu-images/${encodeURIComponent(finalFilename)}`;
    return res.status(201).json({
      filename: finalFilename,
      relative_path: relativePath,
      image_url: toCustomerMenuImageAbsoluteUrl(req, relativePath),
      uploaded_by: resolveUserDisplayName(userContext, 'Usuario')
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudo subir la imagen' });
  }
});

// Short, stable, per-seller share codes (replaces long JWT links).
const SHORT_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generateShortCode = (length = 8) => {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return out;
};

const getOrCreateShareCode = async (sellerUserId) => {
  const existing = await pool.query(
    'SELECT code FROM customer_menu_links WHERE seller_user_id = $1',
    [sellerUserId]
  );
  if (existing.rowCount > 0) return existing.rows[0].code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateShortCode();
    try {
      await pool.query(
        'INSERT INTO customer_menu_links (code, seller_user_id) VALUES ($1, $2)',
        [candidate, sellerUserId]
      );
      return candidate;
    } catch (err) {
      if (err.code !== '23505') throw err;
      // Either a code collision (retry) or another request created the
      // seller's link first (reuse it).
      const raced = await pool.query(
        'SELECT code FROM customer_menu_links WHERE seller_user_id = $1',
        [sellerUserId]
      );
      if (raced.rowCount > 0) return raced.rows[0].code;
    }
  }
  throw new Error('No se pudo generar un código de enlace único');
};

// Resolves both short codes and legacy JWT tokens to a seller id (or null).
const resolveShareTokenSellerId = async (shareToken) => {
  const token = String(shareToken || '').trim();
  if (!token) return null;
  if (!token.includes('.')) {
    const linkRes = await pool.query(
      'SELECT seller_user_id FROM customer_menu_links WHERE code = $1',
      [token]
    );
    if (linkRes.rowCount === 0) return null;
    return Number(linkRes.rows[0].seller_user_id);
  }
  // Legacy JWT links keep working until they expire.
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.purpose !== CUSTOMER_MENU_TOKEN_PURPOSE) return null;
    const sellerUserId = Number.parseInt(decoded?.seller_user_id, 10);
    return Number.isInteger(sellerUserId) && sellerUserId > 0 ? sellerUserId : null;
  } catch {
    return null;
  }
};

router.post('/api/customer-menu/share-link', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'menu_cliente')) {
    return res.status(403).json({ error: 'No tienes permiso para generar enlaces de catálogo' });
  }

  try {
    const code = await getOrCreateShareCode(userContext.id);
    const requestOrigin = String(req.headers.origin || '').trim();
    const publicBase = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || requestOrigin || 'http://localhost:5173').trim();
    const shareUrl = `${publicBase.replace(/\/+$/, '')}/#/catalogo/${code}`;
    return res.json({
      share_token: code,
      share_url: shareUrl,
      seller: {
        id: userContext.id,
        display_name: resolveUserDisplayName(userContext, 'Vendedor')
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'No se pudo generar el enlace de catálogo' });
  }
});

router.get('/api/public/menu/:shareToken', async (req, res) => {
  const shareToken = String(req.params.shareToken || '').trim();
  if (!shareToken) return res.status(400).json({ error: 'Token de catálogo inválido' });

  try {
    const sellerUserId = await resolveShareTokenSellerId(shareToken);
    if (!sellerUserId) {
      return res.status(400).json({ error: 'Enlace de catálogo inválido o vencido' });
    }

    const sellerRes = await pool.query(
      `SELECT id, email, display_name, role, panel_access, city, is_active
       FROM users
       WHERE id = $1`,
      [sellerUserId]
    );
    if (sellerRes.rowCount === 0 || sellerRes.rows[0].is_active === false) {
      return res.status(404).json({ error: 'Vendedor no disponible para este enlace' });
    }
    const seller = sellerRes.rows[0];
    if (!canAccessPanel(seller.panel_access, seller.role, 'menu_cliente')) {
      return res.status(403).json({ error: 'Este enlace no corresponde a un usuario autorizado' });
    }

    const cityScope = resolveInventoryScopeByCity(seller.city || '');
    const defaultStore = cityScope?.canonical || 'Cochabamba';
    const productRows = await loadProductCatalogRows({ includeInactive: false });
    const products = productRows
      .map((row) => ({
        sku: String(row.sku || '').toUpperCase(),
        name: String(row.name || '').trim(),
        price: Number(row.sf || 0),
        price_sf: Number(row.sf || 0),
        price_cf: Number(row.cf || row.sf || 0),
        image_url: normalizeCatalogImageUrl(req, String(row.image_url || '').trim(), String(row.sku || '')),
        category: inferProductMenuCategory(row)
      }))
      .sort((a, b) => {
        const catA = CUSTOMER_MENU_CATEGORIES.indexOf(a.category);
        const catB = CUSTOMER_MENU_CATEGORIES.indexOf(b.category);
        if (catA !== catB) return catA - catB;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      });

    return res.json({
      seller: {
        id: seller.id,
        display_name: resolveUserDisplayName(seller, 'Vendedor')
      },
      default_store: defaultStore,
      categories: CUSTOMER_MENU_CATEGORIES,
      products
    });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(410).json({ error: 'Este enlace expiró. Pide uno nuevo al vendedor.' });
    }
    if (err?.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }
    console.error(err);
    return res.status(500).json({ error: 'No se pudo cargar el catálogo compartido' });
  }
});

router.get('/api/public/menu-image/:sku', async (req, res) => {
  const sku = String(req.params.sku || '').trim().toUpperCase();
  if (!sku) {
    return res.status(400).json({ error: 'SKU inválido' });
  }

  try {
    const productRes = await pool.query(
      `SELECT image_url
       FROM products
       WHERE UPPER(sku) = $1
       LIMIT 1`,
      [sku]
    );
    if (productRes.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const rawImageUrl = String(productRes.rows[0]?.image_url || '').trim();
    const localRelativePath = resolveCatalogLocalImagePath(rawImageUrl);
    if (!localRelativePath) {
      return res.status(404).json({ error: 'Imagen no disponible' });
    }

    const localFilePath = getCatalogImageAbsolutePath(localRelativePath);
    if (!localFilePath) {
      return res.status(404).json({ error: 'Imagen no disponible' });
    }

    const extension = path.extname(localFilePath).toLowerCase();
    const mimeByExt = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    };
    const contentType = mimeByExt[extension] || 'application/octet-stream';
    const imageBuffer = await fs.readFile(localFilePath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(imageBuffer);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Imagen no disponible' });
    }
    console.error(err);
    return res.status(500).json({ error: 'No se pudo cargar la imagen' });
  }
});

router.post('/api/public/menu/:shareToken/order', async (req, res) => {
  const shareToken = String(req.params.shareToken || '').trim();
  if (!shareToken) return res.status(400).json({ error: 'Token de catálogo inválido' });
  try {
    const sellerUserId = await resolveShareTokenSellerId(shareToken);
    if (!sellerUserId) {
      return res.status(400).json({ error: 'Enlace de catálogo inválido o vencido' });
    }

    const sellerRes = await pool.query(
      `SELECT id, email, display_name, role, panel_access, city, is_active
       FROM users
       WHERE id = $1`,
      [sellerUserId]
    );
    if (sellerRes.rowCount === 0 || sellerRes.rows[0].is_active === false) {
      return res.status(404).json({ error: 'Vendedor no disponible para este enlace' });
    }
    const seller = sellerRes.rows[0];
    if (!canAccessPanel(seller.panel_access, seller.role, 'menu_cliente')) {
      return res.status(403).json({ error: 'Este enlace no corresponde a un usuario autorizado' });
    }

    const customerName = String(req.body?.customer_name || '').trim();
    const customerPhone = String(req.body?.customer_phone || '').trim();
    const department = normalizeDepartmentLabel(req.body?.department || '');
    const provincia = normalizeDepartmentLabel(req.body?.provincia || '');
    const customerNotes = String(req.body?.notes || '').trim();
    const ventaTypeRaw = normalizeText(req.body?.venta_type || 'sf').replace(/\s+/g, '');
    const ventaType = ventaTypeRaw === 'cf' || ventaTypeRaw === 'confactura'
      ? 'cf'
      : (ventaTypeRaw === 'sf' || ventaTypeRaw === 'sinfactura' ? 'sf' : '');
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!customerName || !customerPhone) {
      return res.status(400).json({ error: 'Completa nombre y teléfono para enviar el pedido' });
    }
    if (!ventaType) {
      return res.status(400).json({ error: 'Selecciona si el pedido es con factura o sin factura' });
    }
    if (!department && !provincia) {
      return res.status(400).json({ error: 'Selecciona departamento o provincia para enviar el pedido' });
    }
    if (department && provincia) {
      return res.status(400).json({ error: 'Envía solo departamento o provincia, no ambos' });
    }
    if (customerName.length > 120) {
      return res.status(400).json({ error: 'Nombre demasiado largo (máx 120)' });
    }
    if (customerPhone.length > 30) {
      return res.status(400).json({ error: 'Teléfono inválido (máx 30)' });
    }
    if (customerNotes.length > 600) {
      return res.status(400).json({ error: 'Notas demasiado largas (máx 600)' });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos un producto al pedido' });
    }

    const qtyBySku = new Map();
    for (const item of rawItems) {
      const sku = normalizeProductSku(item?.sku || '');
      const qty = Number.parseInt(item?.qty, 10);
      if (!sku || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Hay productos inválidos en el pedido' });
      }
      qtyBySku.set(sku, (qtyBySku.get(sku) || 0) + qty);
    }
    const skus = [...qtyBySku.keys()];
    const productsRes = await pool.query(
      `SELECT sku, name, sf_price, cf_price
       FROM products
       WHERE UPPER(sku) = ANY($1::text[])
         AND is_active = TRUE`,
      [skus]
    );
    if (productsRes.rowCount !== skus.length) {
      return res.status(400).json({ error: 'Uno o más productos ya no están disponibles' });
    }
    const productsBySku = new Map(
      productsRes.rows.map((row) => [String(row.sku || '').toUpperCase(), row])
    );
    const lineItems = skus.map((sku) => {
      const product = productsBySku.get(sku);
      const qty = Number(qtyBySku.get(sku) || 0);
      const unitPrice = ventaType === 'cf'
        ? Number(product?.cf_price || product?.sf_price || 0)
        : Number(product?.sf_price || 0);
      return {
        sku,
        displayName: String(product?.name || sku),
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
        isCombo: false,
        comboItems: []
      };
    });
    const normalizedLineItems = parseAndNormalizeQuoteRows(lineItems);
    const subtotal = normalizedLineItems.reduce((sum, row) => sum + Number(row.lineTotal || 0), 0);
    const total = subtotal;
    const cityScope = resolveInventoryScopeByCity(seller.city || '');
    const storeLocation = cityScope?.canonical || 'Cochabamba';
    const vendorName = resolveUserDisplayName(seller, 'Vendedor');

    const insertResult = await pool.query(
      `INSERT INTO quotes (
        user_id, customer_name, customer_phone, department, provincia, shipping_notes,
        alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent, line_items, subtotal,
        total, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id, created_at`,
      [
        seller.id,
        customerName,
        customerPhone,
        department || null,
        provincia || null,
        customerNotes || null,
        null,
        null,
        storeLocation,
        vendorName,
        ventaType,
        0,
        JSON.stringify(normalizedLineItems),
        subtotal,
        total,
        'Cotizado'
      ]
    );

    return res.status(201).json({
      message: 'Pedido enviado correctamente',
      quote_id: insertResult.rows[0]?.id || null,
      created_at: insertResult.rows[0]?.created_at || null,
      seller_name: vendorName
    });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(410).json({ error: 'Este enlace expiró. Pide uno nuevo al vendedor.' });
    }
    if (err?.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Enlace de catálogo inválido' });
    }
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'No se pudo enviar el pedido' });
  }
});

module.exports = router;
