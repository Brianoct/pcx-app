const { pool } = require('../db');
const { CUSTOMER_MENU_CATEGORY_ACCESORIOS, CUSTOMER_MENU_CATEGORY_TABLEROS } = require('./customerMenu');
const { normalizeText } = require('./rbac');
const { createHttpError } = require('./util');

const DEFAULT_PRODUCT_CATALOG = [
  { sku: 'T6195R', name: 'Tablero 61x95 Rojo', sf: 330, cf: 383 },
  { sku: 'T6195N', name: 'Tablero 61x95 Negro', sf: 330, cf: 383 },
  { sku: 'T6195AM', name: 'Tablero 61x95 Amarillo', sf: 330, cf: 383 },
  { sku: 'T6195AP', name: 'Tablero 61x95 Azul Petroleo', sf: 330, cf: 383 },
  { sku: 'T6195PL', name: 'Tablero 61x95 Plomo', sf: 330, cf: 383 },
  { sku: 'T9495R', name: 'Tablero 94x95 Rojo', sf: 450, cf: 522 },
  { sku: 'T9495N', name: 'Tablero 94x95 Negro', sf: 450, cf: 522 },
  { sku: 'T9495AM', name: 'Tablero 94x95 Amarillo', sf: 450, cf: 522 },
  { sku: 'T9495AP', name: 'Tablero 94x95 Azul Petroleo', sf: 450, cf: 522 },
  { sku: 'T9495PL', name: 'Tablero 94x95 Plomo', sf: 450, cf: 522 },
  { sku: 'T1099R', name: 'Tablero 10x99 Rojo', sf: 105, cf: 122 },
  { sku: 'T1099N', name: 'Tablero 10x99 Negro', sf: 105, cf: 122 },
  { sku: 'T1099AP', name: 'Tablero 10x99 Azul Petroleo', sf: 105, cf: 122 },
  { sku: 'R40N', name: 'Repisa Grande Negro', sf: 85, cf: 99 },
  { sku: 'R25N', name: 'Repisa Pequeña Negro', sf: 40, cf: 47 },
  { sku: 'D40N', name: 'Desarmador Grande Negro', sf: 70, cf: 82 },
  { sku: 'D22N', name: 'Desarmador Pequeño Negro', sf: 45, cf: 53 },
  { sku: 'L40N', name: 'Llave Grande Negro', sf: 80, cf: 93 },
  { sku: 'L22N', name: 'Llave Pequeño Negro', sf: 50, cf: 58 },
  { sku: 'C15N', name: 'Caja Negro', sf: 48, cf: 56 },
  { sku: 'M08N', name: 'Martillo Negro', sf: 17, cf: 20 },
  { sku: 'A15N', name: 'Amoladora Negro', sf: 30, cf: 35 },
  { sku: 'RR15N', name: 'Repisa/Rollo Negro', sf: 90, cf: 105 },
  { sku: 'G05C', name: 'Gancho 5cm Cromo', sf: 65, cf: 76 },
  { sku: 'G10C', name: 'Gancho 10cm Cromo', sf: 84, cf: 98 }
];

let PRODUCT_CATALOG = [...DEFAULT_PRODUCT_CATALOG];

let PRODUCT_CATALOG_BY_SKU = new Map(
  PRODUCT_CATALOG.map((item) => [String(item.sku || '').toUpperCase(), item.name])
);

let productCatalogInitPromise = null;

const syncProductCatalogBySkuFromRows = (rows = []) => {
  const nextCatalog = rows.map((row) => ({
    sku: String(row.sku || '').toUpperCase(),
    name: String(row.name || '').trim(),
    sf: Number(row.sf ?? row.sf_price ?? 0),
    cf: Number(row.cf ?? row.cf_price ?? 0)
  }));
  PRODUCT_CATALOG = nextCatalog;
  PRODUCT_CATALOG_BY_SKU = new Map(
    nextCatalog.map((item) => [item.sku, item.name || item.sku])
  );
};

const ensureProductCatalogReady = async () => {
  if (!productCatalogInitPromise) {
    productCatalogInitPromise = (async () => {
      // Schema lives in migrations; this only seeds defaults and warms the
      // in-memory catalog cache.
      for (const item of DEFAULT_PRODUCT_CATALOG) {
        await pool.query(
          `INSERT INTO products (sku, name, sf_price, cf_price, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT (sku) DO UPDATE
           SET name = CASE
                 WHEN products.name IS NULL OR BTRIM(products.name) = ''
                   THEN EXCLUDED.name
                 ELSE products.name
               END,
               sf_price = CASE
                 WHEN products.sf_price IS NULL OR products.sf_price = 0
                   THEN EXCLUDED.sf_price
                 ELSE products.sf_price
               END,
               cf_price = CASE
                 WHEN products.cf_price IS NULL OR products.cf_price = 0
                   THEN EXCLUDED.cf_price
                 ELSE products.cf_price
               END`,
          [item.sku, item.name, Number(item.sf || 0), Number(item.cf || 0)]
        );
      }

      const rowsResult = await pool.query(
        `SELECT sku, name, sf_price, cf_price, is_gift_eligible, menu_category, image_url
         FROM products
         WHERE is_active = TRUE
         ORDER BY UPPER(name) ASC, UPPER(sku) ASC`
      );
      syncProductCatalogBySkuFromRows(rowsResult.rows || []);
    })();
  }
  await productCatalogInitPromise;
};

const loadProductCatalogRows = async ({ includeInactive = false } = {}) => {
  await ensureProductCatalogReady();
  const whereClause = includeInactive ? '' : 'WHERE is_active = TRUE';
  const result = await pool.query(
    `SELECT sku, name, description, sf_price, cf_price, is_active, is_gift_eligible, menu_category, image_url
     FROM products
     ${whereClause}
     ORDER BY UPPER(name) ASC, UPPER(sku) ASC`
  );
  const rows = (result.rows || []).map((row) => ({
    sku: String(row.sku || '').toUpperCase(),
    name: String(row.name || '').trim(),
    description: String(row.description || '').trim() || null,
    sf: Number(row.sf_price || 0),
    cf: Number(row.cf_price || 0),
    is_active: Boolean(row.is_active),
    is_gift_eligible: Boolean(row.is_gift_eligible),
    menu_category: String(row.menu_category || '').trim() || null,
    image_url: String(row.image_url || '').trim() || null
  }));
  if (!includeInactive) {
    syncProductCatalogBySkuFromRows(rows);
  }
  return rows;
};

const normalizeProductSku = (value = '') => String(value || '').trim().toUpperCase();

const PRODUCT_SKU_REGEX = /^[A-Z0-9_-]{2,30}$/;

const validateProductSku = (value) => {
  const sku = normalizeProductSku(value);
  if (!sku) throw createHttpError(400, 'SKU requerido');
  if (!PRODUCT_SKU_REGEX.test(sku)) {
    throw createHttpError(400, 'SKU inválido. Usa 2-30 caracteres A-Z, 0-9, guion o guion bajo');
  }
  return sku;
};

const parseProductPrice = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, `${label} debe ser un número mayor o igual a 0`);
  }
  return parsed;
};

const normalizeProductPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const hasName = Object.prototype.hasOwnProperty.call(src, 'name');
  const hasSf = Object.prototype.hasOwnProperty.call(src, 'sf') || Object.prototype.hasOwnProperty.call(src, 'sf_price');
  const hasCf = Object.prototype.hasOwnProperty.call(src, 'cf') || Object.prototype.hasOwnProperty.call(src, 'cf_price');
  const hasIsActive = Object.prototype.hasOwnProperty.call(src, 'is_active');
  const hasIsGiftEligible = Object.prototype.hasOwnProperty.call(src, 'is_gift_eligible');
  const hasMenuCategory = Object.prototype.hasOwnProperty.call(src, 'menu_category');
  const hasImageUrl = Object.prototype.hasOwnProperty.call(src, 'image_url');
  const hasDescription = Object.prototype.hasOwnProperty.call(src, 'description');

  if (!partial && (!hasName || !hasSf || !hasCf)) {
    throw createHttpError(400, 'Debes enviar name, sf y cf');
  }
  if (partial && !hasName && !hasSf && !hasCf && !hasIsActive && !hasIsGiftEligible && !hasMenuCategory && !hasImageUrl && !hasDescription) {
    throw createHttpError(400, 'No se enviaron cambios para actualizar');
  }

  const normalized = {};
  if (hasName) {
    const name = String(src.name || '').trim();
    if (!name) throw createHttpError(400, 'Nombre de producto requerido');
    if (name.length > 120) throw createHttpError(400, 'Nombre de producto demasiado largo (máx 120)');
    normalized.name = name;
  }
  if (hasDescription) {
    const description = String(src.description || '').trim();
    if (description.length > 1000) throw createHttpError(400, 'Descripción demasiado larga (máx 1000)');
    normalized.description = description || null;
  }
  if (hasSf) normalized.sf_price = parseProductPrice(src.sf ?? src.sf_price, 'Precio SF');
  if (hasCf) normalized.cf_price = parseProductPrice(src.cf ?? src.cf_price, 'Precio CF');
  if (hasIsActive) {
    if (typeof src.is_active === 'boolean') {
      normalized.is_active = src.is_active;
    } else {
      const activeRaw = normalizeText(String(src.is_active));
      if (['true', '1', 'si', 'yes', 'activo', 'active'].includes(activeRaw)) {
        normalized.is_active = true;
      } else if (['false', '0', 'no', 'inactivo', 'inactive'].includes(activeRaw)) {
        normalized.is_active = false;
      } else {
        throw createHttpError(400, 'is_active debe ser booleano');
      }
    }
  }
  if (hasIsGiftEligible) {
    if (typeof src.is_gift_eligible === 'boolean') {
      normalized.is_gift_eligible = src.is_gift_eligible;
    } else {
      const giftRaw = normalizeText(String(src.is_gift_eligible));
      if (['true', '1', 'si', 'yes', 'activo', 'active'].includes(giftRaw)) {
        normalized.is_gift_eligible = true;
      } else if (['false', '0', 'no', 'inactivo', 'inactive'].includes(giftRaw)) {
        normalized.is_gift_eligible = false;
      } else {
        throw createHttpError(400, 'is_gift_eligible debe ser booleano');
      }
    }
  }
  if (hasMenuCategory) {
    const raw = String(src.menu_category || '').trim();
    if (!raw) {
      normalized.menu_category = null;
    } else {
      const key = normalizeText(raw);
      if (['tablero', 'tableros', 'boards', 'board'].includes(key)) {
        normalized.menu_category = CUSTOMER_MENU_CATEGORY_TABLEROS;
      } else if (['accesorio', 'accesorios', 'accessory', 'accessories'].includes(key)) {
        normalized.menu_category = CUSTOMER_MENU_CATEGORY_ACCESORIOS;
      } else {
        throw createHttpError(400, 'menu_category inválida. Usa Tableros o Accesorios');
      }
    }
  }
  if (hasImageUrl) {
    const urlValue = String(src.image_url || '').trim();
    if (!urlValue) {
      normalized.image_url = null;
    } else {
      const isHttpUrl = /^https?:\/\//i.test(urlValue);
      const isRelativePath = /^\/[a-zA-Z0-9/_\-.%]+$/.test(urlValue) && !urlValue.includes('..');
      if (!isHttpUrl && !isRelativePath) {
        throw createHttpError(400, 'image_url debe ser URL http(s) o ruta local iniciando con /');
      }
      if (urlValue.length > 500) {
        throw createHttpError(400, 'image_url demasiado larga (máx 500)');
      }
      normalized.image_url = urlValue;
    }
  }
  return normalized;
};

const inferProductMenuCategory = (productRow = {}) => {
  const explicit = normalizeText(productRow.menu_category || '');
  if (explicit) {
    if (explicit === 'tablero' || explicit === 'tableros' || explicit === 'board' || explicit === 'boards') {
      return CUSTOMER_MENU_CATEGORY_TABLEROS;
    }
    if (explicit === 'accesorio' || explicit === 'accesorios' || explicit === 'accessory' || explicit === 'accessories') {
      return CUSTOMER_MENU_CATEGORY_ACCESORIOS;
    }
  }
  const sku = String(productRow.sku || '').toUpperCase();
  const name = normalizeText(productRow.name || '');
  if (sku.startsWith('T') || name.includes('tablero')) return CUSTOMER_MENU_CATEGORY_TABLEROS;
  return CUSTOMER_MENU_CATEGORY_ACCESORIOS;
};

const loadProductNameMap = async () => {
  await ensureProductCatalogReady();
  if (!PRODUCT_CATALOG_BY_SKU || PRODUCT_CATALOG_BY_SKU.size === 0) {
    await loadProductCatalogRows();
  }
  return PRODUCT_CATALOG_BY_SKU;
};

module.exports = {
  DEFAULT_PRODUCT_CATALOG,
  PRODUCT_CATALOG,
  PRODUCT_CATALOG_BY_SKU,
  PRODUCT_SKU_REGEX,
  ensureProductCatalogReady,
  inferProductMenuCategory,
  loadProductCatalogRows,
  loadProductNameMap,
  normalizeProductPayload,
  normalizeProductSku,
  parseProductPrice,
  productCatalogInitPromise,
  syncProductCatalogBySkuFromRows,
  validateProductSku
};
