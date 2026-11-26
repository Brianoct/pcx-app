// Página de inicio pública (pcxind.com). El diseño (grilla, colores,
// tipografía) vive aquí; el contenido —textos, fotos, precios, orden y
// visibilidad de secciones— llega de /api/site/home y lo edita Marketing
// desde la app sin tocar código. Mientras carga (o si la API falla) se
// muestra el contenido inicial embebido, así el visitante nunca ve una
// página en blanco.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicNav from './PublicNav';
import { apiRequest } from './apiClient';
import { DEFAULT_HOME } from './siteDefaults';
import { imageSrc, videoEmbedUrl } from './siteMedia';
import PublicQuote from './PublicQuote';
import { getCampaign } from './cyberMonday';

const waUrl = (whatsapp) => {
  const number = String(whatsapp?.number || '').replace(/\D/g, '');
  const message = String(whatsapp?.message || '');
  return `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
};

const waLink = (whatsapp, message) => {
  const number = String(whatsapp?.number || '').replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
};

const assistedMessage = (campaign) => (campaign.live
  ? `Hola PCX, quiero que un asesor me ayude con mi pedido de Cyber Monday (${campaign.assistedPercent}% de descuento con asesor).`
  : 'Hola PCX, quiero que un asesor me ayude a armar mi pedido.');

// Franja superior: anuncia la oferta antes de que empiece y mientras dura.
function CampaignStrip({ campaign }) {
  if (!campaign.live && !campaign.teaser) return null;
  return (
    <div className={`lp-cm-strip ${campaign.live ? 'is-live' : ''}`} role="note">
      {campaign.live
        ? <><strong>Cyber Monday</strong> · {campaign.selfPercent}% armando tu pedido aquí · {campaign.assistedPercent}% con un asesor · hasta el miércoles 2 de diciembre</>
        : <><strong>Cyber Monday</strong> · {campaign.datesLabel} · hasta {campaign.selfPercent}% de descuento</>}
    </div>
  );
}

// Las dos formas de comprar: con un asesor por WhatsApp o armando el pedido
// uno mismo. Es lo primero que ve el visitante.
function Doors({ campaign, content, preview }) {
  const goToQuote = () => document.getElementById('cotizar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section className="lp-cm" id="comprar">
      <div className="lp-cm-head">
        <p className="lp-eyebrow">{campaign.live ? `Cyber Monday · ${campaign.datesLabel}` : 'Tableros organizadores PCX'}</p>
        <h2 className="lp-cm-title">Compra tu tablero como prefieras.</h2>
        <p className="lp-cm-sub">
          {campaign.live
            ? `Arma tu pedido aquí y llévate ${campaign.selfPercent}% de descuento, o pídele ayuda a un asesor y llévate ${campaign.assistedPercent}%.`
            : 'Te ayuda un asesor por WhatsApp, o armas tu pedido tú mismo y lo envías a ventas.'}
          {' '}En los dos casos confirmamos envío y forma de pago antes de cobrar.
        </p>
      </div>
      <div className="lp-cm-doors">
        <article className="lp-cm-door">
          {campaign.live && <span className="lp-cm-badge is-soft">{campaign.assistedPercent}% de descuento</span>}
          <h3>Que un asesor me ayude</h3>
          <p>Cuéntanos qué quieres ordenar y te armamos el pedido.</p>
          <ul>
            <li>Te recomienda medida, color y accesorios</li>
            <li>Te envía la cotización lista</li>
          </ul>
          <a
            className="lp-btn lp-cm-btn-wa"
            data-tt-event="Contact"
            href={preview ? undefined : waLink(content.whatsapp, assistedMessage(campaign))}
            target="_blank"
            rel="noopener noreferrer"
          >
            Hablar por WhatsApp
          </a>
        </article>
        <article className="lp-cm-door is-main">
          {campaign.live && <span className="lp-cm-badge">{campaign.selfPercent}% de descuento</span>}
          <h3>Armar mi pedido</h3>
          <p>Mira los productos con precio, elige y envía el pedido a ventas.</p>
          <ul>
            <li>Precios a la vista</li>
            <li>Eliges tableros y accesorios a tu ritmo</li>
          </ul>
          <button type="button" className="lp-btn lp-cm-btn-main" onClick={goToQuote}>Ver productos</button>
        </article>
      </div>
    </section>
  );
}

// ── Lo que el cliente necesita saber para decidir ─────────────────────────
// Datos del negocio (no del editor del sitio): si cambian, se cambian aquí.
const GUIDE_LINES = [
  { name: 'PCX Acero', text: 'Para herramientas: talleres mecánicos, garajes, carpinterías y fábricas.' },
  { name: 'PCX Armonía', text: 'Para la casa y la oficina: escritorio y home office, cocina, entrada con llaves y bolsos, manualidades y costura, cuarto de los niños, baño y lavandería.' }
];
const GUIDE_SIZES = [
  { place: 'Garaje de casa', pick: '1 tablero grande (94x95 cm) o 2 medianos (61x95 cm)' },
  { place: 'Taller pequeño', pick: '2 tableros grandes (94x95 cm)' },
  { place: 'Escobas, trapeadores, trapos o mochilas', pick: 'El tablero angosto (10x99 cm)' }
];
const GUIDE_FACTS = [
  { title: 'Se montan uno al lado del otro', text: 'Puedes cubrir toda una pared y ampliar más adelante.' },
  { title: 'Cada tablero soporta de 30 a 40 kg', text: 'Acero al carbono con pintura electrostática.' },
  { title: 'No incluye tornillos ni tarugos', text: 'Dependen del tipo de pared. Los consigues en cualquier ferretería.' }
];
const INFO_ITEMS = [
  { q: '¿Hacen envíos?', a: 'A toda Bolivia. La mayoría llega al día siguiente. El envío lo paga el cliente y suele costar entre 40 y 60 Bs.' },
  { q: '¿Puedo recoger o pedir entrega en mi ciudad?', a: 'En Cochabamba y Santa Cruz puedes recoger tu pedido o pedir entrega dentro de la ciudad, que cuesta entre 30 y 65 Bs.' },
  { q: '¿Cómo pago?', a: 'Con QR o en efectivo. El pago se hace antes del envío.' },
  { q: '¿Dan factura?', a: 'Sí, si la pides. Los precios de la página son sin factura; con factura el precio cambia y te lo confirmamos al cotizar.' },
  { q: '¿Y si algo llega dañado?', a: 'Te enviamos la pieza nueva.' }
];

function Guide() {
  return (
    <section className="lp-sell" id="elegir">
      <div className="lp-section-head">
        <h2>Cómo elegir</h2>
        <p>Lo que necesitas saber antes de comprar.</p>
      </div>
      <div className="lp-sell-grid is-two">
        {GUIDE_LINES.map((line) => (
          <article key={line.name} className="lp-sell-card">
            <h3>{line.name}</h3>
            <p>{line.text}</p>
          </article>
        ))}
      </div>
      <div className="lp-sell-sizes">
        <h3>¿Qué tamaño necesito?</h3>
        <dl>
          {GUIDE_SIZES.map((row) => (
            <div key={row.place}><dt>{row.place}</dt><dd>{row.pick}</dd></div>
          ))}
        </dl>
      </div>
      <div className="lp-sell-grid">
        {GUIDE_FACTS.map((fact) => (
          <article key={fact.title} className="lp-sell-card">
            <h3>{fact.title}</h3>
            <p>{fact.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Info({ stores }) {
  const places = (stores?.items || []).filter((store) => store && store.city);
  return (
    <section className="lp-sell" id="info">
      <div className="lp-section-head">
        <h2>Envíos, pagos y entregas</h2>
      </div>
      <dl className="lp-info-list">
        {INFO_ITEMS.map((item) => (
          <div key={item.q}><dt>{item.q}</dt><dd>{item.a}</dd></div>
        ))}
      </dl>
      {places.length > 0 && (
        <p className="lp-info-places" id="tiendas">
          <strong>Dónde estamos:</strong>{' '}
          {places.map((store, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {store.maps
                ? <a href={store.maps} target="_blank" rel="noopener noreferrer">{store.city}</a>
                : store.city}
              {store.address ? `, ${store.address}` : ''}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

// Menú corto: solo lo que ayuda a comprar.
const SELL_NAV = [
  { label: 'Productos', target: 'cotizar' },
  { label: 'Cómo elegir', target: 'elegir' },
  { label: 'Talleres reales', target: 'galeria' },
  { label: 'Envíos y pagos', target: 'info' },
  { label: 'Contacto', to: '/contacto' }
];

const Stars = ({ count }) => (
  <span className="lp-stars" aria-label={`${count} estrellas`}>{'★'.repeat(Math.max(0, Math.min(5, Number(count) || 5)))}</span>
);

function Video({ section }) {
  const embed = videoEmbedUrl(section.url);
  if (!embed) return null;
  return (
    <section className="lp-video" id="video">
      <div className="lp-video-copy">
        {section.badge && <span className="lp-badge">{section.badge}</span>}
        <h2>{section.title}</h2>
        {section.intro && <p>{section.intro}</p>}
        {Array.isArray(section.bullets) && section.bullets.length > 0 && (
          <ul className="lp-check-list">{section.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        )}
      </div>
      <div className="lp-video-frame">
        <iframe src={embed} title={section.title || 'Video PCX'} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        {section.caption && <p className="lp-video-caption">{section.caption}</p>}
      </div>
    </section>
  );
}

function Gallery({ section }) {
  const items = (section.items || []).filter((it) => it.before || it.after || it.image);
  if (items.length === 0) return null;
  return (
    <section className="lp-gallery" id="galeria">
      <div className="lp-section-head">
        <h2>{section.title}</h2>
        {section.subtitle && <p>{section.subtitle}</p>}
      </div>
      <div className="lp-gallery-grid">
        {items.map((item, i) => (
          <figure key={i} className="lp-gallery-item">
            {item.before && item.after ? (
              <div className="lp-before-after">
                <div><img src={imageSrc(item.before)} alt="Antes" loading="lazy" /><span>Antes</span></div>
                <div><img src={imageSrc(item.after)} alt="Después" loading="lazy" /><span>Después</span></div>
              </div>
            ) : (
              <img src={imageSrc(item.after || item.before || item.image)} alt={item.caption || ''} loading="lazy" />
            )}
            {item.caption && <figcaption>{item.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}

function Testimonials({ section }) {
  const items = section.items || [];
  if (items.length === 0) return null;
  return (
    <section className="lp-testimonials" id="testimonios">
      <div className="lp-section-head">
        <h2>{section.title}</h2>
      </div>
      <div className="lp-testimonial-grid">
        {items.map((t, i) => (
          <blockquote key={i} className="lp-testimonial">
            <Stars count={t.stars} />
            <p>“{t.quote}”</p>
            <footer>
              {t.photo ? <img src={imageSrc(t.photo)} alt="" loading="lazy" /> : <span className="lp-avatar" aria-hidden="true">{String(t.name || '?').slice(0, 1)}</span>}
              <span>
                <strong>{t.name}</strong>
                <small>{[t.role, t.city].filter(Boolean).join(' · ')}</small>
              </span>
            </footer>
          </blockquote>
        ))}
      </div>
    </section>
  );
}

const Quote = ({ section, content, preview, campaign }) => <PublicQuote section={section} whatsapp={content.whatsapp} preview={preview} campaign={campaign} />;

// Render puro del contenido: lo usa la página pública y también la vista
// previa del editor de Marketing (con el borrador en vez de lo publicado).
export function LandingContent({ content, preview = false }) {
  const campaign = useMemo(() => getCampaign(), []);
  // Durante la oferta, todo botón genérico de WhatsApp es la vía con asesor.
  const whatsappUrl = campaign.live ? waLink(content.whatsapp, assistedMessage(campaign)) : waUrl(content.whatsapp);
  // El inicio vende: dos puertas, catálogo, cómo elegir, talleres reales,
  // envíos y pagos, y testimonios. Del contenido que edita Marketing se usan
  // solo esas secciones; el resto (portada, rangos de precio, cierre) ya no
  // se muestra.
  const enabled = (content.sections || []).filter((s) => s && s.enabled !== false);
  const pick = (type) => enabled.find((s) => s.type === type) || null;
  const quote = pick('quote');
  const video = pick('video');
  const gallery = pick('gallery');
  const testimonialsRaw = pick('testimonials');
  const testimonials = testimonialsRaw ? { ...testimonialsRaw, items: (testimonialsRaw.items || []).slice(0, 3) } : null;
  const stores = pick('facts')?.stores || null;
  // La galería no se dibuja sin fotos: su enlace del menú tampoco.
  const hasGallery = Boolean(gallery && (gallery.items || []).some((it) => it.before || it.after || it.image));
  const navLinks = SELL_NAV.filter((link) => link.target !== 'galeria' || hasGallery);
  const shared = { content, whatsappUrl, preview, campaign };
  return (
    <div className="lp">
      <CampaignStrip campaign={campaign} />
      <PublicNav dark links={navLinks} whatsappUrl={whatsappUrl} ctaLabel="Cotizar por WhatsApp" showLogin={false} />
      <main>
        <Doors campaign={campaign} content={content} preview={preview} />
        {quote && <Quote section={quote} {...shared} />}
        <Guide />
        {video && <Video section={video} {...shared} />}
        {gallery && <Gallery section={gallery} {...shared} />}
        <Info stores={stores} />
        {testimonials && <Testimonials section={testimonials} {...shared} />}
      </main>
      <footer className="lp-footer">
        <span>{content.footer?.text || 'PCX · Hecho en Bolivia'}</span>
        <nav className="lp-footer-links">
          <Link to="/catalogos">Catálogos</Link>
          <Link to="/contacto">Contacto</Link>
          <Link to="/carreras">Trabaja con nosotros</Link>
          <Link to="/login" className="lp-footer-login">Ingresar</Link>
        </nav>
      </footer>
    </div>
  );
}

export default function LandingPage() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    let alive = true;
    apiRequest('/api/site/home')
      .then((data) => { if (alive && data?.content) setContent(data.content); })
      .catch(() => { /* se queda el contenido inicial */ });
    return () => { alive = false; };
  }, []);

  const resolved = useMemo(() => content || DEFAULT_HOME, [content]);
  return <LandingContent content={resolved} />;
}
