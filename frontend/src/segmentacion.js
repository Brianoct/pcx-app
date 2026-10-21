// Copia de backend/lib/segmentacion.js (misma lista, mismas claves).
export const USOS = [
  { key: 'taller_mecanico', label: 'Taller mecánico' },
  { key: 'industria', label: 'Fábrica o industria' },
  { key: 'empresa_oficina', label: 'Oficina o empresa' },
  { key: 'ferreteria_revendedor', label: 'Ferretería o reventa' },
  { key: 'hogar', label: 'Casa o garaje' },
  { key: 'institucion_publica', label: 'Institución pública' },
  { key: 'otro', label: 'Otro' }
];

export const ORIGENES = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'google', label: 'Google' },
  { key: 'referido', label: 'Referido' },
  { key: 'tienda_fisica', label: 'Tienda física' },
  { key: 'feria_evento', label: 'Feria o evento' },
  { key: 'vendedor_visita', label: 'Visita de vendedor' },
  { key: 'cliente_recurrente', label: 'Cliente recurrente' },
  { key: 'otro', label: 'Otro' }
];

export const usoLabel = (key) => (USOS.find((u) => u.key === key) || {}).label || '';
export const origenLabel = (key) => (ORIGENES.find((o) => o.key === key) || {}).label || '';
