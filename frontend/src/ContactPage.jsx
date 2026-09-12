// Página pública de contacto del sitio principal. Desde aquí se llega a la
// página de convocatorias ("Trabaja con nosotros").
import { Link } from 'react-router-dom';
import PublicNav from './PublicNav';

const WHATSAPP_NUMBER = '59169618264';
const WHATSAPP_MESSAGE = 'Hola PCX, quiero conocer sus productos de organización.';
const PHONE_DISPLAY = '+591 696 18264';

// Sedes (direcciones confirmadas por Brian, 2026-09-12). El enlace abre el
// punto en Google Maps con la dirección tal cual, para navegar hasta ahí.
const SEDES = [
  {
    key: 'cbba',
    title: 'Fábrica PCX · Cochabamba',
    address: 'Av. Elías Meneses y Llaunquenquiri, Zona El Paso',
    city: 'Cochabamba, Bolivia'
  },
  {
    key: 'scz',
    title: 'Sucursal · Santa Cruz',
    address: 'Av. Prefecto Rivas y Lagunillas, Zona Alto San Pedro',
    city: 'Santa Cruz de la Sierra, Bolivia'
  }
];
const mapsUrl = (sede) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${sede.address}, ${sede.city}`)}`;

// Horario de atención (confirmado por Brian, 2026-09-12).
const HORARIO = [
  { days: 'Lunes a jueves', hours: '8:00 – 12:00 y 13:00 – 17:00' },
  { days: 'Viernes', hours: '8:00 – 16:00' }
];

export default function ContactPage() {
  return (
    <div className="public-page">
      <PublicNav />

      <main className="public-main">
        <p className="landing-eyebrow">Contacto</p>
        <h1 className="public-title">Hablemos</h1>
        <p className="landing-sub">
          Estamos en Cochabamba y Santa Cruz (Bolivia).
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
            <span className="public-card-text">{PHONE_DISPLAY} — ventas y consultas</span>
          </a>

          {/* Llamada directa: funciona sin WhatsApp Web (en el celular abre el marcador). */}
          <a className="public-card" href={`tel:+${WHATSAPP_NUMBER}`}>
            <span className="public-card-icon">📞</span>
            <span className="public-card-title">Llamar</span>
            <span className="public-card-text">{PHONE_DISPLAY} — toca para llamar</span>
          </a>

          <div className="public-card">
            <span className="public-card-icon">🕗</span>
            <span className="public-card-title">Horario de atención</span>
            <span className="public-card-text public-card-lines">
              {HORARIO.map((h) => (
                <span key={h.days}><strong>{h.days}:</strong> {h.hours}</span>
              ))}
            </span>
          </div>

          {SEDES.map((sede) => (
            <a key={sede.key} className="public-card" href={mapsUrl(sede)} target="_blank" rel="noopener noreferrer">
              <span className="public-card-icon">📍</span>
              <span className="public-card-title">{sede.title}</span>
              <span className="public-card-text">
                {sede.address}
                <br />
                {sede.city}
                <br />
                <span className="public-card-link">Cómo llegar en Google Maps →</span>
              </span>
            </a>
          ))}

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
        <span>Cochabamba · Santa Cruz</span>
      </footer>
    </div>
  );
}
