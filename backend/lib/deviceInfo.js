// Etiqueta legible del dispositivo a partir del User-Agent. Android expone la
// marca/modelo (ej. "SM-A525F" = Samsung A52); iPhone solo dice "iPhone".
// Es una pista para el admin, no una identificación infalible: el device_id
// (generado por el frontend) es la señal fuerte.
const deviceLabelFromUserAgent = (userAgent) => {
  const ua = String(userAgent || '');
  if (!ua) return 'Desconocido';

  const androidMatch = ua.match(/Android [\d.]+;\s*([^;)]+)/i);
  if (androidMatch) {
    // "SM-A525F Build/RP1A..." -> "SM-A525F"
    const model = androidMatch[1].replace(/\s*Build\/.*$/i, '').trim();
    return model ? `Android · ${model}` : 'Android';
  }
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Windows NT/i.test(ua)) return 'PC · Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'PC · Linux';
  return 'Desconocido';
};

module.exports = { deviceLabelFromUserAgent };
