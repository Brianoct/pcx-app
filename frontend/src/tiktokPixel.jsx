// Píxel de TikTok, solo en las páginas públicas (inicio, catálogos, contacto,
// carreras, menús compartidos). Nunca se carga dentro de la app del equipo.
//
// Eventos: PageView en cada página pública; Contact al tocar un botón de
// WhatsApp o llamar; ViewContent al abrir un catálogo PDF; SubmitForm al
// enviar un pedido desde «Arma tu pedido» (el botón lleva data-tt-event).
// Se detectan por delegación de clics, así ningún componente público tiene
// que saber del píxel.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TIKTOK_PIXEL_ID = 'DB36UMJC77UA626EJ80G';

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

const trackEvent = (event, props) => {
  try { window.ttq?.track(event, props || {}); } catch { /* el píxel nunca rompe la página */ }
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

export default function TikTokPixel() {
  const location = useLocation();

  useEffect(() => { loadPixel(); }, []);

  useEffect(() => {
    try { window.ttq?.page(); } catch { /* idem */ }
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
