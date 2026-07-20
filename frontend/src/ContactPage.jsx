// Página pública de contacto del sitio principal. Desde aquí se llega a la
// página de convocatorias ("Trabaja con nosotros").
import { Link } from 'react-router-dom';
import logo from './assets/logo.png';

const WHATSAPP_NUMBER = '59169618264';
const WHATSAPP_MESSAGE = 'Hola PCX, quiero conocer sus productos de organización.';

export default function ContactPage() {
  return (
    <div className="public-page">
      <header className="landing-top">
        <Link to="/"><img src={logo} alt="PCX" className="landing-logo" /></Link>
        <Link to="/login" className="landing-login">Ingresar</Link>
      </header>

      <main className="public-main">
        <p className="landing-eyebrow">Contacto</p>
        <h1 className="public-title">Hablemos</h1>
        <p className="landing-sub">
          Estamos en Cochabamba y Santa Cruz (Bolivia) y en Lima (Perú).
          Escríbenos y te respondemos en el día.
        </p>

        <div className="public-cards">
          <a
            className="public-card"
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="public-card-icon">💬</span>
            <span className="public-card-title">WhatsApp</span>
            <span className="public-card-text">+591 696 18264 — ventas y consultas</span>
          </a>

          <div className="public-card">
            <span className="public-card-icon">📍</span>
            <span className="public-card-title">Sedes</span>
            <span className="public-card-text">Cochabamba · Santa Cruz · Lima</span>
          </div>

          <Link className="public-card is-careers" to="/carreras">
            <span className="public-card-icon">🛠️</span>
            <span className="public-card-title">Trabaja con nosotros</span>
            <span className="public-card-text">
              Mira las convocatorias abiertas y súmate al equipo PCX →
            </span>
          </Link>
        </div>
      </main>

      <footer className="landing-footer">
        <span>PCX · Hecho en Bolivia</span>
        <span className="landing-footer-dot">·</span>
        <span>Cochabamba · Santa Cruz · Lima</span>
      </footer>
    </div>
  );
}
