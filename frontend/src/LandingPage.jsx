// Public splash page at the site root. One viewport, no scroll: bold
// statement, WhatsApp CTA and a deliberately quiet "Ingresar" for the team.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import logo from './assets/logo.png';

// TODO: replace with the real sales WhatsApp number (country code, no +).
const WHATSAPP_NUMBER = '59170000000';
const WHATSAPP_MESSAGE = 'Hola PCX, quiero conocer sus productos de organización.';

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
      <header className="landing-top">
        <img src={logo} alt="PCX" className="landing-logo" />
        <Link to="/login" className="landing-login">Ingresar</Link>
      </header>

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
          <a
            className="landing-cta"
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`}
            target="_blank"
            rel="noreferrer"
          >
            Escríbenos por WhatsApp
          </a>
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
