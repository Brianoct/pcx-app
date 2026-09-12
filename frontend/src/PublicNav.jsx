// Encabezado compartido de las páginas públicas (inicio, catálogos, contacto,
// carreras): siempre hay camino a Catálogos y Contacto, y el acceso del
// equipo («Ingresar») queda discreto al final.
import { Link, useLocation } from 'react-router-dom';
import logo from './assets/logo.png';

export default function PublicNav({ whatsappUrl = null }) {
  const { pathname } = useLocation();
  const item = (to, label) => (
    <Link to={to} className={`landing-login ${pathname === to ? 'is-current' : ''}`}>{label}</Link>
  );
  return (
    <header className="landing-top public-nav">
      <Link to="/" aria-label="PCX — inicio"><img src={logo} alt="PCX" className="landing-logo" /></Link>
      <nav className="landing-nav">
        {item('/catalogos', 'Catálogos')}
        {item('/contacto', 'Contacto')}
        {whatsappUrl && (
          <a className="landing-login public-nav-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        )}
        {item('/login', 'Ingresar')}
      </nav>
    </header>
  );
}
