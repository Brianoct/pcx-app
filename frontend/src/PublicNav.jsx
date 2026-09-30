// Encabezado compartido de las páginas públicas (inicio, catálogos, contacto,
// carreras): siempre hay camino a Catálogos y Contacto. El acceso del equipo
// («Ingresar») queda discreto al final, salvo en el inicio, donde vive en el
// pie de página.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import logo from './assets/logo.png';

export default function PublicNav({ whatsappUrl = null, links = null, showLogin = true, ctaLabel = 'WhatsApp', dark = false }) {
  const { pathname } = useLocation();
  // En celular (inicio) los enlaces se pliegan detrás de «Menú»; el botón de
  // WhatsApp queda siempre a la vista.
  const [menuOpen, setMenuOpen] = useState(false);
  const item = (to, label) => (
    <Link key={to} to={to} className={`landing-login ${pathname === to ? 'is-current' : ''}`} onClick={() => setMenuOpen(false)}>{label}</Link>
  );
  const scrollTo = (target) => {
    setMenuOpen(false);
    const el = target === 'top' ? document.body : document.getElementById(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <header className={`landing-top public-nav ${dark ? 'is-dark' : ''} ${menuOpen ? 'is-open' : ''}`}>
      <Link to="/" aria-label="PCX — inicio" className="landing-logo-link"><img src={logo} alt="PCX" className="landing-logo" /></Link>
      {dark && (
        <button type="button" className="public-nav-toggle" aria-expanded={menuOpen} aria-label="Menú" onClick={() => setMenuOpen((v) => !v)}>
          {menuOpen ? '✕' : '☰'} <span>Menú</span>
        </button>
      )}
      <nav className="landing-nav">
        {Array.isArray(links)
          ? links.map((link) => (link.to
            ? item(link.to, link.label)
            : <button key={link.target} type="button" className="landing-login" onClick={() => scrollTo(link.target)}>{link.label}</button>))
          : [item('/catalogos', 'Catálogos'), item('/contacto', 'Contacto')]}
        {whatsappUrl && (
          <a className={`landing-login public-nav-wa ${dark ? 'is-pill' : ''}`} href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            {ctaLabel}
          </a>
        )}
        {showLogin && item('/login', 'Ingresar')}
      </nav>
    </header>
  );
}
