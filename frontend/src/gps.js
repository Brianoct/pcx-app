// Parseo de la ubicación que manda el cliente: acepta "lat, lng" pegado de
// WhatsApp/Google Maps o un link de maps con ?q=lat,lng / @lat,lng.
export const parseGpsInput = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const patterns = [
    /[?&]q=(-?\d{1,2}\.\d+)[,%2C+\s]+(-?\d{1,3}\.\d+)/i,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
  }
  return null;
};
