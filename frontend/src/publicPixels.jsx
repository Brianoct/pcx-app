// Píxeles de TikTok y Meta, solo en las páginas públicas (inicio, catálogos,
// contacto, carreras, menús compartidos). Nunca se cargan dentro de la app
// del equipo.
//
// Eventos (los mismos hechos, con el nombre que usa cada plataforma):
//   página pública        → TikTok PageView   · Meta PageView
//   WhatsApp / llamar     → TikTok Contact    · Meta Contact
//   abrir catálogo PDF    → TikTok ViewContent· Meta ViewContent
//   enviar pedido         → TikTok SubmitForm · Meta Lead
// Se detectan por delegación de clics, así ningún componente público tiene
// que saber de los píxeles.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const TIKTOK_PIXEL_ID = 'DB36UMJC77UA626EJ80G';
const META_PIXEL_ID = '1987406648882571';

const META_EVENT = { PageView: 'PageView', Contact: 'Contact', ViewContent: 'ViewContent', SubmitForm: 'Lead' };

const loadPixel = () => {
  if (typeof window === 'undefined' || window.ttq) return window.ttq;
  const w = window; const d = document; const t = 'ttq';
  w.TiktokAnalyticsObject = t;
  const ttq = w[t] = w[t] || [];
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
  ttq.setAndDefer = function (target, method) {
    target[method] = function () { target.push([method].concat(Array.prototype.slice.call(arguments, 0))); };
  };
  for (let i = 0; i < ttq.methods.length; i += 1) ttq.setAndDefer(ttq, ttq.methods[i]);
  ttq.instance = function (id) {
    const e = ttq._i[id] || [];
    for (let n = 0; n < ttq.methods.length; n += 1) ttq.setAndDefer(e, ttq.methods[n]);
    return e;
  };
  ttq.load = function (id, options) {
    const url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = url;
    ttq._t = ttq._t || {}; ttq._t[id] = Date.now();
    ttq._o = ttq._o || {}; ttq._o[id] = options || {};
    const script = d.createElement('script');
    script.type = 'text/javascript'; script.async = true; script.src = `${url}?sdkid=${id}&lib=${t}`;
    const first = d.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(script, first);
  };
  ttq.load(TIKTOK_PIXEL_ID);
  return ttq;
};

const loadMeta = () => {
  if (typeof window === 'undefined' || window.fbq) return window.fbq;
  const f = window; const b = document;
  const n = f.fbq = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
  if (!f._fbq) f._fbq = n;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  const t = b.createElement('script'); t.async = true; t.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const s = b.getElementsByTagName('script')[0]; s.parentNode.insertBefore(t, s);
  f.fbq('init', META_PIXEL_ID);
  return f.fbq;
};

const trackEvent = (event, props) => {
  try { window.ttq?.track(event, props || {}); } catch { /* el píxel nunca rompe la página */ }
  try { window.fbq?.('track', META_EVENT[event] || event, props || {}); } catch { /* idem */ }
};

// Qué evento corresponde a un clic en un enlace/botón público.
const eventForElement = (el) => {
  const explicit = el.getAttribute('data-tt-event');
  if (explicit) return { event: explicit, props: { content_name: el.textContent.trim().slice(0, 80) } };
  const href = String(el.getAttribute('href') || '');
  if (/wa\.me|whatsapp/i.test(href) || href.startsWith('tel:')) return { event: 'Contact', props: { content_name: el.textContent.trim().slice(0, 80) } };
  if (/\.pdf(\?|$)/i.test(href)) return { event: 'ViewContent', props: { content_type: 'catalogo', content_name: href.split('/').pop() } };
  return null;
};

export default function PublicPixels() {
  const location = useLocation();
  const lastPath = useRef(null);

  useEffect(() => { loadPixel(); loadMeta(); }, []);

  // Una vista por ruta (el doble montaje de desarrollo no la repite).
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    try { window.ttq?.page(); } catch { /* idem */ }
    try { window.fbq?.('track', 'PageView'); } catch { /* idem */ }
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e) => {
      const el = e.target.closest('a[href], [data-tt-event]');
      if (!el) return;
      const hit = eventForElement(el);
      if (hit) trackEvent(hit.event, hit.props);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
