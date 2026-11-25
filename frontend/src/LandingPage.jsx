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
  if (campaign.phase === 'after') return null;
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

const Stars = ({ count }) => (
  <span className="lp-stars" aria-label={`${count} estrellas`}>{'★'.repeat(Math.max(0, Math.min(5, Number(count) || 5)))}</span>
);

function Hero({ section, whatsappUrl }) {
  return (
    <section className="lp-hero" id="top">
      <div className="lp-hero-copy">
        {section.eyebrow && <p className="lp-eyebrow">{section.eyebrow}</p>}
        <h1 className="lp-hero-title">
          {section.title} {section.highlight && <span className="lp-accent">{section.highlight}</span>}
        </h1>
        {section.body && <p className="lp-hero-body">{section.body}</p>}
        {Array.isArray(section.bullets) && section.bullets.length > 0 && (
          <ul className="lp-hero-bullets">
            {section.bullets.map((b, i) => (
              <li key={i}><span className="lp-bullet-icon" aria-hidden="true">{b.icon}</span>{b.text}</li>
            ))}
          </ul>
        )}
        <a className="lp-btn lp-btn-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          Cotizar por WhatsApp
        </a>
      </div>
      <div className="lp-hero-lines">
        {(section.lines || []).map((line, i) => (
          <Link key={i} to="/catalogos" className="lp-hero-line" style={{ backgroundImage: `url(${imageSrc(line.image)})` }}>
            <span className="lp-hero-line-name">{line.name}</span>
            <span className="lp-hero-line-tag">{line.tagline}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Facts({ section }) {
  const { prices = {}, materials = {}, stores = {} } = section;
  return (
    <section className="lp-facts" id="tiendas">
      <div className="lp-facts-grid">
        <article className="lp-card">
          <h2 className="lp-card-title">{prices.title}</h2>
          {prices.subtitle && <p className="lp-card-sub">{prices.subtitle}</p>}
          <div className="lp-price-cards">
            {(prices.cards || []).map((card, i) => (
              <div key={i} className="lp-price-card">
                {card.image && <img src={imageSrc(card.image)} alt={card.name} loading="lazy" />}
                <strong>{card.name}</strong>
                <span>{card.range}</span>
              </div>
            ))}
          </div>
          {prices.note && <p className="lp-note">{prices.note}</p>}
        </article>

        <article className="lp-card">
          <h2 className="lp-card-title">{materials.title}</h2>
          <ul className="lp-check-list">
            {(materials.items || []).map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          {Array.isArray(materials.images) && materials.images.filter(Boolean).length > 0 && (
            <div className="lp-material-images">
              {materials.images.filter(Boolean).map((img, i) => <img key={i} src={imageSrc(img)} alt="" loading="lazy" />)}
            </div>
          )}
        </article>

        <article className="lp-card">
          <h2 className="lp-card-title">{stores.title}</h2>
          {stores.subtitle && <p className="lp-card-sub">{stores.subtitle}</p>}
          <ul className="lp-store-list">
            {(stores.items || []).map((store, i) => (
              <li key={i}>
                {store.image && <img src={imageSrc(store.image)} alt={store.city} loading="lazy" />}
                <div>
                  <strong>{store.city}</strong>
                  {store.kind && <em>{store.kind}</em>}
                  {store.address && <span>{store.address}</span>}
                  {store.maps && <a className="lp-store-map" href={store.maps} target="_blank" rel="noopener noreferrer">Cómo llegar en Google Maps →</a>}
                </div>
              </li>
            ))}
          </ul>
          {(stores.note_title || stores.note) && (
            <p className="lp-note lp-note-strong">
              {stores.note_title && <strong>{stores.note_title}</strong>}
              {stores.note && <span>{stores.note}</span>}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function Combos({ section }) {
  const custom = section.custom || {};
  return (
    <section className="lp-combos" id="combos">
      <div className="lp-section-head">
        <h2>{section.title}</h2>
        {section.subtitle && <p>{section.subtitle}</p>}
      </div>
      <div className="lp-combos-grid">
        <div className="lp-combo-items">
          {(section.items || []).map((item, i) => (
            <article key={i} className="lp-combo">
              {item.image && <img src={imageSrc(item.image)} alt={item.name} loading="lazy" />}
              <div className="lp-combo-text">
                <strong>{item.name}</strong>
                {item.desc && <span>{item.desc}</span>}
                {item.price && <em>{item.price}</em>}
              </div>
            </article>
          ))}
        </div>
        <article className="lp-custom">
          {section.image && <img src={imageSrc(section.image)} alt="" loading="lazy" />}
          <div className="lp-custom-text">
            <h3>{custom.title}</h3>
            {custom.body && <p>{custom.body}</p>}
            {custom.cta_label && (String(custom.cta_to || '').startsWith('/')
              ? <Link className="lp-btn lp-btn-outline" to={custom.cta_to}>{custom.cta_label}</Link>
              : <button type="button" className="lp-btn lp-btn-outline" onClick={() => document.getElementById(custom.cta_to || 'cotizar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{custom.cta_label}</button>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

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

function Closing({ section, whatsappUrl }) {
  return (
    <section className="lp-closing" id="contacto-cta">
      {section.tagline && <p className="lp-closing-tagline">{section.tagline}</p>}
      {Array.isArray(section.perks) && section.perks.length > 0 && (
        <ul className="lp-perks">
          {section.perks.map((p, i) => (
            <li key={i}><span className="lp-bullet-icon" aria-hidden="true">{p.icon}</span>{p.text}</li>
          ))}
        </ul>
      )}
      <div className="lp-closing-cta">
        <h2>{section.cta_title}</h2>
        <a className="lp-btn lp-btn-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          {section.cta_label || 'Cotizar por WhatsApp'}
        </a>
      </div>
    </section>
  );
}

const Quote = ({ section, content, preview, campaign }) => <PublicQuote section={section} whatsapp={content.whatsapp} preview={preview} campaign={campaign} />;

const SECTION_COMPONENTS = {
  hero: Hero,
  facts: Facts,
  combos: Combos,
  quote: Quote,
  video: Video,
  gallery: Gallery,
  testimonials: Testimonials,
  closing: Closing
};

// Render puro del contenido: lo usa la página pública y también la vista
// previa del editor de Marketing (con el borrador en vez de lo publicado).
export function LandingContent({ content, preview = false }) {
  const campaign = useMemo(() => getCampaign(), []);
  // Durante la oferta, todo botón genérico de WhatsApp es la vía con asesor.
  const whatsappUrl = campaign.live ? waLink(content.whatsapp, assistedMessage(campaign)) : waUrl(content.whatsapp);
  const sections = (content.sections || []).filter((s) => s && s.enabled !== false);
  return (
    <div className="lp">
      <CampaignStrip campaign={campaign} />
      <PublicNav dark links={content.nav} whatsappUrl={whatsappUrl} ctaLabel="Cotizar por WhatsApp" showLogin={false} />
      <main>
        <Doors campaign={campaign} content={content} preview={preview} />
        {sections.map((section, i) => {
          const Component = SECTION_COMPONENTS[section.type];
          return Component ? <Component key={`${section.type}-${i}`} section={section} content={content} whatsappUrl={whatsappUrl} preview={preview} campaign={campaign} /> : null;
        })}
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
