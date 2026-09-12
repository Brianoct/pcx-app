// Public splash page at the site root. One viewport, no scroll: bold
// statement, WhatsApp CTA and a deliberately quiet "Ingresar" for the team.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicNav from './PublicNav';

const WHATSAPP_NUMBER = '59169618264';
const WHATSAPP_MESSAGE = 'Hola PCX, quiero conocer sus productos de organización.';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

// Portadas de los dos catálogos: el visitante llega a los productos desde el
// inicio en un clic (antes solo existía el botón de WhatsApp).
const CATALOG_COVERS = [
  { key: 'acero', name: 'PCX Acero', line: 'Línea Industrial', cover: '/catalogos/acero-cover.jpg' },
  { key: 'armonia', name: 'PCX Armonía', line: 'Línea Hogar', cover: '/catalogos/armonia-cover.jpg' }
];

// The three words the brand stands on.
const ROTATING_WORDS = ['ordenado.', 'eficiente.', 'inspirador.'];

export default function LandingPage() {
  const [wordIndex, setWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        setWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
        setWordVisible(true);
      }, 320);
    }, 2600);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="landing">
      <PublicNav />

      <main className="landing-hero">
        <p className="landing-eyebrow">Sistemas de organización para tu taller</p>
        <h1 className="landing-title">
          Un espacio de trabajo
          <span className={`landing-word ${wordVisible ? 'is-in' : 'is-out'}`}>
            {ROTATING_WORDS[wordIndex]}
          </span>
        </h1>
        <p className="landing-sub">
          Fabricamos tableros, soportes y repisas que ponen cada herramienta en su lugar —
          para que tu equipo trabaje mejor y tu espacio inspire.
        </p>
        <div className="landing-actions">
          <a className="landing-cta" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
            Escríbenos por WhatsApp
          </a>
          <Link className="landing-cta landing-cta-secondary" to="/catalogos">
            Ver catálogos
          </Link>
        </div>

        <div className="landing-catalog-row" aria-label="Catálogos">
          {CATALOG_COVERS.map((cat) => (
            <Link key={cat.key} to="/catalogos" className="landing-catalog-mini">
              <img src={cat.cover} alt={`Portada ${cat.name}`} loading="lazy" />
              <span>
                <strong>{cat.name}</strong>
                <small>{cat.line}</small>
              </span>
            </Link>
          ))}
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
