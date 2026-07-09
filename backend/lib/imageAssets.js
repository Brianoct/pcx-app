// Shared decoder for base64 image data URLs stored in the DB (user avatars/QRs
// and product catalog photos). Uploads are client-downscaled to tens of KB;
// storing bytes in Postgres avoids Render's ephemeral disk wiping them on
// deploy. Serving URLs use an unguessable capability token so plain <img> tags
// work without auth headers.
const ASSET_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const decodeImageDataUrl = (dataUrl, { maxBytes = 5 * 1024 * 1024 } = {}) => {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error('Formato de imagen inválido. Usa JPG, PNG o WEBP.');
    err.statusCode = 400;
    throw err;
  }
  const mime = String(match[1] || '').toLowerCase();
  if (!ASSET_MIMES.has(mime)) {
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
  if (buffer.length > maxBytes) {
    const err = new Error('La imagen supera el tamaño permitido. Usa una imagen más liviana.');
    err.statusCode = 400;
    throw err;
  }
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, buffer };
};

module.exports = { ASSET_MIMES, decodeImageDataUrl };
