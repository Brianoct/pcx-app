// "Resumen de la mañana" — el analista nocturno de PCX en la página Estadísticas.
// Muestra el último resumen generado (titular + alertas priorizadas) y permite
// generarlo al instante. El texto y las cifras vienen ya calculados del backend.
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './apiClient';

const SEVERITY_META = {
  alta: { icon: '🔴', label: 'Urgente', cls: 'is-alta' },
  media: { icon: '🟡', label: 'Atención', cls: 'is-media' },
  buena: { icon: '🟢', label: 'Buena', cls: 'is-buena' },
  info: { icon: '🔵', label: 'Info', cls: 'is-info' }
};

const formatWhen = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-BO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function MorningBrief({ token }) {
  const [brief, setBrief] = useState(null);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiRequest('/api/admin/daily-brief/latest', { token })
      .then((data) => { setBrief(data?.brief || null); setAi(data?.ai || null); setError(''); })
      .catch((err) => setError(err.message || 'No se pudo cargar'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const generateNow = async () => {
    setGenerating(true);
    setError('');
    try {
      const data = await apiRequest('/api/admin/daily-brief/run', { method: 'POST', token });
      setBrief(data?.brief || null);
      setAi(data?.ai || null);
    } catch (err) {
      setError(err.message || 'No se pudo generar el resumen');
    } finally {
      setGenerating(false);
    }
  };

  const flags = Array.isArray(brief?.flags) ? brief.flags : [];
  const bodyLines = String(brief?.body_md || '').split('\n');
  const providerLabel = brief?.provider === 'template'
    ? 'Resumen automático'
    : `Redactado por IA${brief?.model ? ` · ${brief.model}` : ''}`;

  return (
    <section className="morning-brief-card">
      <div className="morning-brief-head">
        <div>
          <p className="morning-brief-eyebrow">☀️ Resumen de la mañana</p>
          <h3 className="morning-brief-headline">
            {loading ? 'Cargando…' : (brief?.headline || 'Aún no hay resumen de hoy')}
          </h3>
        </div>
        <button type="button" className="btn btn-primary morning-brief-btn" onClick={generateNow} disabled={generating}>
          {generating ? 'Generando…' : (brief ? 'Actualizar' : 'Generar ahora')}
        </button>
      </div>

      {error && <div className="camp-error">{error}</div>}

      {!loading && !brief && !error && (
        <p className="morning-brief-empty">
          El analista corre cada mañana. Genera el primero con el botón de arriba.
        </p>
      )}

      {brief && (
        <>
          {flags.length > 0 && (
            <ul className="morning-brief-flags">
              {flags.map((flag, index) => {
                const meta = SEVERITY_META[flag.severity] || SEVERITY_META.info;
                return (
                  <li key={index} className={`morning-brief-flag ${meta.cls}`}>
                    <span className="morning-brief-flag-icon" title={meta.label}>{meta.icon}</span>
                    <span>{flag.text}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="morning-brief-body">
            {bodyLines.map((line, index) => (
              line.trim()
                ? <p key={index}>{line}</p>
                : <div key={index} className="morning-brief-gap" />
            ))}
          </div>

          <div className="morning-brief-foot">
            <span>{providerLabel}</span>
            {brief.generated_at && <span>Generado {formatWhen(brief.generated_at)}</span>}
            {ai && !ai.configured && (
              <span className="morning-brief-hint">💡 Conecta una IA para un resumen redactado</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
