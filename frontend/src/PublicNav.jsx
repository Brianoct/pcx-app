// Encabezado compartido de las páginas públicas (inicio, catálogos, contacto,
// carreras): siempre hay camino a Catálogos y Contacto. El acceso del equipo
// («Ingresar») queda discreto al final, salvo en el inicio, donde vive en el
// pie de página.
import { Link, useLocation } from 'react-router-dom';
import logo from './assets/logo.png';

export default function PublicNav({ whatsappUrl = null, links = null, showLogin = true, ctaLabel = 'WhatsApp', dark = false }) {
  const { pathname } = useLocation();
  const item = (to, label) => (
    <Link key={to} to={to} className={`landing-login ${pathname === to ? 'is-current' : ''}`}>{label}</Link>
  );
  const scrollTo = (target) => {
    const el = target === 'top' ? document.body : document.getElementById(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <header className={`landing-top public-nav ${dark ? 'is-dark' : ''}`}>
      <Link to="/" aria-label="PCX — inicio"><img src={logo} alt="PCX" className="landing-logo" /></Link>
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
