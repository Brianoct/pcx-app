// Página pública de convocatorias ("Trabaja con nosotros"). El admin publica
// los puestos desde Admin → Usuarios → Convocatorias; postular es por WhatsApp.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from './apiClient';
import logo from './assets/logo.png';

// Las postulaciones van directo al WhatsApp de Brian (no al de ventas).
const WHATSAPP_NUMBER = '59167405778';

export default function CareersPage() {
  const [postings, setPostings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('/api/careers')
      .then((data) => { if (active) setPostings(Array.isArray(data?.postings) ? data.postings : []); })
      .catch(() => { if (active) setError('No se pudieron cargar las convocatorias. Intenta de nuevo.'); });
    return () => { active = false; };
  }, []);

  const applyLink = (posting) => {
    const msg = `Hola PCX, quiero postular al puesto de ${posting.title}${posting.location ? ` (${posting.location})` : ''}.`;
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="public-page">
      <header className="landing-top">
        <Link to="/"><img src={logo} alt="PCX" className="landing-logo" /></Link>
        <Link to="/login" className="landing-login">Ingresar</Link>
      </header>

      <main className="public-main">
        <p className="landing-eyebrow">Trabaja con nosotros</p>
        <h1 className="public-title">Súmate al equipo PCX</h1>
        <p className="landing-sub">
          Fabricamos sistemas de organización en Bolivia y crecemos hacia Perú.
          Buscamos gente que quiera hacer las cosas bien.
        </p>

        {error && <div className="public-error">{error}</div>}
        {postings === null && !error && <p className="public-loading">Cargando convocatorias…</p>}

        {postings !== null && postings.length === 0 && (
          <div className="public-empty">
            <p><strong>Por ahora no tenemos convocatorias abiertas.</strong></p>
            <p>
              Igual nos encanta conocer gente buena: {' '}
              <a href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola PCX, quiero dejar mis datos para futuras convocatorias.')}`} target="_blank" rel="noreferrer">
                déjanos tus datos por WhatsApp
              </a>.
            </p>
          </div>
        )}

        <div className="career-list">
          {(postings || []).map((posting) => (
            <article key={posting.id} className="career-card">
              <div className="career-card-head">
                <h2 className="career-card-title">{posting.title}</h2>
                <div className="career-card-tags">
                  {posting.area && <span className="career-tag">{posting.area}</span>}
                  {posting.location && <span className="career-tag is-loc">📍 {posting.location}</span>}
                  {posting.employment_type && <span className="career-tag is-type">{posting.employment_type}</span>}
                </div>
              </div>
              {posting.description && <p className="career-card-desc">{posting.description}</p>}
              {posting.requirements && (
                <div className="career-card-reqs">
                  <strong>Requisitos:</strong>
                  <ul>
                    {posting.requirements.split('\n').filter((line) => line.trim()).map((line, i) => (
                      <li key={i}>{line.trim().replace(/^[-•]\s*/, '')}</li>
                    ))}
                  </ul>
                </div>
              )}
              <a className="career-apply" href={applyLink(posting)} target="_blank" rel="noreferrer">
                Postular por WhatsApp
              </a>
            </article>
          ))}
        </div>

        <p className="public-backlink"><Link to="/contacto">← Volver a Contacto</Link></p>
      </main>

      <footer className="landing-footer">
        <span>PCX · Hecho en Bolivia</span>
        <span className="landing-footer-dot">·</span>
        <span>Cochabamba · Santa Cruz · Lima</span>
      </footer>
    </div>
  );
}
