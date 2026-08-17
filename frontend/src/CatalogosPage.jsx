// Página pública de catálogos: el link que Ventas comparte por WhatsApp.
// El cliente abre, hojea el catálogo de cada línea (PDF) y tiene el botón de
// WhatsApp siempre a mano para pedir el suyo. Sin login, sin datos privados.
import { Link } from 'react-router-dom';
import logo from './assets/logo.png';

const WHATSAPP_NUMBER = '59169618264';
const WHATSAPP_MESSAGE = 'Hola PCX, vi su catálogo y quiero más información.';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const CATALOGS = [
  {
    key: 'acero',
    name: 'PCX Acero',
    badge: 'Línea Industrial',
    tagline: 'Precisión. Resistencia. Durabilidad.',
    description: 'Tableros metálicos y organización para talleres, industria y trabajo pesado.',
    pdf: '/catalogos/acero.pdf',
    cover: '/catalogos/acero-cover.jpg',
    pages: 6,
    accent: '#dc2626',
    theme: 'is-acero'
  },
  {
    key: 'armonia',
    name: 'PCX Armonía',
    badge: 'Línea Hogar',
    tagline: 'Orden que se ve bien en casa.',
    description: 'Tableros y accesorios de organización para el hogar, cocina y espacios pequeños.',
    pdf: '/catalogos/armonia.pdf',
    cover: '/catalogos/armonia-cover.jpg',
    pages: 6,
    accent: '#b45309',
    theme: 'is-armonia'
  }
];

export default function CatalogosPage() {
  return (
    <div className="public-page catalogs-page">
      <header className="landing-top">
        <Link to="/"><img src={logo} alt="PCX" className="landing-logo" /></Link>
        <Link to="/contacto" className="landing-login">Contacto</Link>
      </header>

      <main className="public-main catalogs-main">
        <p className="landing-eyebrow">Catálogos 2026</p>
        <h1 className="public-title">Nuestros catálogos</h1>
        <p className="landing-sub">
          Toca un catálogo para hojearlo. Cuando encuentres lo tuyo,
          escríbenos por WhatsApp y te lo cotizamos en el día.
        </p>

        <div className="catalog-grid">
          {CATALOGS.map((cat) => (
            <a
              key={cat.key}
              className={`catalog-card ${cat.theme}`}
              href={cat.pdf}
              target="_blank"
              rel="noreferrer"
            >
              <span className="catalog-cover-wrap">
                <img
                  src={cat.cover}
                  alt={`Portada del catálogo ${cat.name}`}
                  className="catalog-cover"
                  loading="lazy"
                />
                <span className="catalog-badge" style={{ background: cat.accent }}>{cat.badge}</span>
              </span>
              <span className="catalog-card-body">
                <span className="catalog-card-name">{cat.name}</span>
                <span className="catalog-card-tagline">{cat.tagline}</span>
                <span className="catalog-card-desc">{cat.description}</span>
                <span className="catalog-card-cta" style={{ background: cat.accent }}>
                  Ver catálogo
                  <span aria-hidden="true"> →</span>
                </span>
                <span className="catalog-card-meta">PDF · {cat.pages} páginas · gratis</span>
              </span>
            </a>
          ))}
        </div>

        <div className="catalog-help">
          <div className="catalog-help-text">
            <strong>¿Ya viste algo que te gustó?</strong>
            <span>Mándanos el nombre o una captura del producto y te pasamos precio y envío.</span>
          </div>
          <a className="catalog-wa-btn" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            <span className="catalog-wa-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="22" height="22" fill="currentColor">
                <path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.6.8 5 2.3 7L4 29l7.3-2.2c1.5.8 3.1 1.2 4.7 1.2 6.6 0 12-5.3 12-11.9C28 8.3 22.6 3 16 3zm0 21.8c-1.5 0-2.9-.4-4.2-1.1l-.3-.2-4.3 1.3 1.3-4.1-.2-.3c-1.3-1.6-2-3.6-2-5.6C6.3 9.5 10.6 5.2 16 5.2s9.7 4.3 9.7 9.7-4.3 9.9-9.7 9.9zm5.4-7.3c-.3-.1-1.7-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a7.9 7.9 0 0 1-4-3.5c-.3-.5.3-.5.9-1.7.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7 2 .9 2.8.9 3.8.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
              </svg>
            </span>
            Escríbenos por WhatsApp
          </a>
        </div>
      </main>

      <a
        className="catalog-wa-float"
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Contactar a PCX por WhatsApp"
        title="Escríbenos por WhatsApp"
      >
        <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden="true">
          <path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.6.8 5 2.3 7L4 29l7.3-2.2c1.5.8 3.1 1.2 4.7 1.2 6.6 0 12-5.3 12-11.9C28 8.3 22.6 3 16 3zm0 21.8c-1.5 0-2.9-.4-4.2-1.1l-.3-.2-4.3 1.3 1.3-4.1-.2-.3c-1.3-1.6-2-3.6-2-5.6C6.3 9.5 10.6 5.2 16 5.2s9.7 4.3 9.7 9.7-4.3 9.9-9.7 9.9zm5.4-7.3c-.3-.1-1.7-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a7.9 7.9 0 0 1-4-3.5c-.3-.5.3-.5.9-1.7.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.2 3.4 5.4 4.7 2 .9 2.8.9 3.8.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
        </svg>
      </a>

      <footer className="landing-footer">
        <span>PCX · Hecho en Bolivia</span>
        <span className="landing-footer-dot">·</span>
        <span>Cochabamba · Santa Cruz · Lima</span>
      </footer>
    </div>
  );
}
