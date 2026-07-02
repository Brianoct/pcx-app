const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

// Where employee avatars and payment QR images live on disk. Served statically
// at /employee-assets (see app.js), mirroring the customer-menu image setup.
const EMPLOYEE_ASSET_DIR = path.resolve(__dirname, 'employee-assets');

if (!fsSync.existsSync(EMPLOYEE_ASSET_DIR)) {
  fsSync.mkdirSync(EMPLOYEE_ASSET_DIR, { recursive: true });
}

const EMPLOYEE_ASSET_ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const EMPLOYEE_ASSET_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

const ensureEmployeeAssetDir = async () => {
  await fs.mkdir(EMPLOYEE_ASSET_DIR, { recursive: true });
};

// Decode a base64 image data URL and persist it. Returns the served relative
// path. `kind` (avatar|qr) and `userId` make filenames stable-ish and traceable.
const saveEmployeeAsset = async ({ dataUrl, kind, userId }) => {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error('Formato de imagen inválido. Usa JPG, PNG o WEBP.');
    err.statusCode = 400;
    throw err;
  }
  const mime = String(match[1] || '').toLowerCase();
  const ext = EMPLOYEE_ASSET_MIME_TO_EXT[mime];
  if (!ext || !EMPLOYEE_ASSET_ALLOWED_EXTENSIONS.has(ext)) {
    const err = new Error('Formato no soportado. Usa JPG, PNG o WEBP.');
    err.statusCode = 400;
    throw err;
  }
  const buffer = Buffer.from(String(match[2] || '').replace(/\s+/g, ''), 'base64');
  if (!buffer || buffer.length === 0) {
    const err = new Error('Imagen vacía.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > 5 * 1024 * 1024) {
    const err = new Error('La imagen supera 5MB. Usa una imagen más liviana.');
    err.statusCode = 400;
    throw err;
  }

  await ensureEmployeeAssetDir();
  const safeKind = kind === 'qr' ? 'qr' : 'avatar';
  const filename = `${safeKind}-${Number(userId) || 'u'}-${Date.now()}${ext}`;
  await fs.writeFile(path.join(EMPLOYEE_ASSET_DIR, filename), buffer);
  return `/employee-assets/${encodeURIComponent(filename)}`;
};

// Best-effort delete of a previously stored asset (ignores anything outside the
// asset dir or already-missing files) so replacing an image doesn't orphan it.
const deleteEmployeeAsset = async (relativePath) => {
  const raw = String(relativePath || '').trim();
  if (!raw.startsWith('/employee-assets/')) return;
  const filename = decodeURIComponent(raw.slice('/employee-assets/'.length));
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return;
  await fs.unlink(path.join(EMPLOYEE_ASSET_DIR, filename)).catch(() => {});
};

module.exports = {
  EMPLOYEE_ASSET_DIR,
  deleteEmployeeAsset,
  ensureEmployeeAssetDir,
  saveEmployeeAsset
};
