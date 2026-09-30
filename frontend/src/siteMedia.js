// Ayudas para el contenido del sitio público (fotos y video), compartidas
// entre la página de inicio y el editor de Marketing.
import { API_BASE } from './apiClient';

// Las fotos subidas desde el editor viven en el backend (/api/site-assets/…);
// las que vienen con la app (/catalogos, /menu-images) las sirve el frontend.
export const imageSrc = (path) => {
  const value = String(path || '').trim();
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  if (value.startsWith('/api/')) return `${API_BASE}${value}`;
  return value;
};

// Enlace de YouTube / TikTok → URL embebible. Marketing pega el enlace normal.
export const videoEmbedUrl = (url) => {
  const value = String(url || '').trim();
  if (!value) return '';
  const yt = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const tk = value.match(/tiktok\.com\/.*\/video\/(\d+)/);
  if (tk) return `https://www.tiktok.com/embed/v2/${tk[1]}`;
  // Solo YouTube o TikTok: cualquier otro enlace no se incrusta.
  return '';
};
