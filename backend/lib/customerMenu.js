const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const CUSTOMER_MENU_IMAGE_DIR = path.resolve(__dirname, 'customer-menu-images');

const LEGACY_MENU_IMAGE_DIR = path.resolve(__dirname, '../frontend/public/menu-images');

if (!fsSync.existsSync(CUSTOMER_MENU_IMAGE_DIR)) {
  fsSync.mkdirSync(CUSTOMER_MENU_IMAGE_DIR, { recursive: true });
}

const CUSTOMER_MENU_CATEGORY_TABLEROS = 'Tableros';

const CUSTOMER_MENU_CATEGORY_ACCESORIOS = 'Accesorios';

const CUSTOMER_MENU_CATEGORIES = [CUSTOMER_MENU_CATEGORY_TABLEROS, CUSTOMER_MENU_CATEGORY_ACCESORIOS];

const CUSTOMER_MENU_TOKEN_PURPOSE = 'customer_menu_share';

const CUSTOMER_MENU_TOKEN_TTL = process.env.CUSTOMER_MENU_TOKEN_TTL || '30d';

const CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const CUSTOMER_MENU_IMAGE_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const ensureCustomerMenuImageDir = async () => {
  await fs.mkdir(CUSTOMER_MENU_IMAGE_DIR, { recursive: true });
};

const getRequestOrigin = (req) => {
  const forwardedProtoRaw = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHostRaw = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProtoRaw || req.protocol || 'http';
  const host = forwardedHostRaw || String(req.headers.host || '').trim();
  return host ? `${protocol}://${host}` : '';
};

const toCustomerMenuImageAbsoluteUrl = (req, relativePath) => {
  const origin = getRequestOrigin(req);
  if (!origin) return relativePath;
  return `${origin}${relativePath}`;
};

const normalizeLegacyMenuImagePath = (rawPath = '') => {
  const value = String(rawPath || '').trim();
  if (!value) return null;
  const normalized = value.split('?')[0].split('#')[0].trim();
  if (/^\/menu-images\/.+/i.test(normalized)) return normalized;
  const absoluteLegacyMatch = normalized.match(/\/menu-images\/([^/?#]+)$/i);
  if (absoluteLegacyMatch?.[1]) {
    return `/menu-images/${absoluteLegacyMatch[1]}`;
  }
  return null;
};

const rewriteLegacyMenuImagePath = (rawPath = '') => normalizeLegacyMenuImagePath(rawPath) || String(rawPath || '').trim();

const resolveCatalogLocalImagePath = (rawPath = '') => {
  const value = String(rawPath || '').trim();
  if (!value) return null;
  if (value.startsWith('/customer-menu-images/')) {
    return value.split('?')[0].split('#')[0].trim();
  }
  const rewritten = rewriteLegacyMenuImagePath(value);
  if (rewritten.startsWith('/customer-menu-images/') || rewritten.startsWith('/menu-images/')) {
    return rewritten.split('?')[0].split('#')[0].trim();
  }
  return null;
};

const getCatalogImageAbsolutePath = (relativePath = '') => {
  const safeRelativePath = String(relativePath || '').trim();
  if (!safeRelativePath || safeRelativePath.includes('..')) return null;
  if (safeRelativePath.startsWith('/customer-menu-images/')) {
    const filename = path.basename(safeRelativePath);
    return path.join(CUSTOMER_MENU_IMAGE_DIR, filename);
  }
  if (safeRelativePath.startsWith('/menu-images/')) {
    const filename = path.basename(safeRelativePath);
    const preferredPath = path.join(CUSTOMER_MENU_IMAGE_DIR, filename);
    if (fsSync.existsSync(preferredPath)) return preferredPath;
    return path.join(LEGACY_MENU_IMAGE_DIR, filename);
  }
  return null;
};

const normalizeCatalogImageUrl = (req, rawPath = '', fallbackSku = '') => {
  const value = String(rawPath || '').trim();
  if (!value) return null;
  const rewritten = rewriteLegacyMenuImagePath(value);
  if (rewritten.startsWith('/customer-menu-images/') || rewritten.startsWith('/menu-images/')) {
    const sku = String(fallbackSku || '').trim().toUpperCase();
    if (sku) {
      return toCustomerMenuImageAbsoluteUrl(req, `/api/public/menu-image/${encodeURIComponent(sku)}`);
    }
    return toCustomerMenuImageAbsoluteUrl(req, rewritten);
  }
  return value;
};

module.exports = {
  CUSTOMER_MENU_CATEGORIES,
  CUSTOMER_MENU_CATEGORY_ACCESORIOS,
  CUSTOMER_MENU_CATEGORY_TABLEROS,
  CUSTOMER_MENU_IMAGE_ALLOWED_EXTENSIONS,
  CUSTOMER_MENU_IMAGE_DIR,
  CUSTOMER_MENU_IMAGE_MIME_TO_EXT,
  CUSTOMER_MENU_TOKEN_PURPOSE,
  CUSTOMER_MENU_TOKEN_TTL,
  LEGACY_MENU_IMAGE_DIR,
  ensureCustomerMenuImageDir,
  getCatalogImageAbsolutePath,
  getRequestOrigin,
  normalizeCatalogImageUrl,
  normalizeLegacyMenuImagePath,
  resolveCatalogLocalImagePath,
  rewriteLegacyMenuImagePath,
  toCustomerMenuImageAbsoluteUrl
};
