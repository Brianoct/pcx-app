import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';

// LA MONTAÑA — programa de entrenamiento de élite PCX (6 semanas). Sección
// separada del negocio del día a día, con identidad propia (estilo militar).
// Candidatos con número tipo dorsal, desafíos por semana calificados 0-100 y
// bitácora de instrucción por candidato.

const CITIES = ['Cochabamba', 'Santa Cruz', 'Lima'];
const TOTAL_WEEKS = 6;

const STATUS_META = {
  activo: { label: 'En instrucción', className: 'is-activo' },
  graduado: { label: 'Graduado', className: 'is-graduado' },
  baja: { label: 'Baja', className: 'is-baja' }
};

const pad2 = (n) => String(n).padStart(2, '0');

const weekOf = (startDate) => {
  if (!startDate) return 1;
  const days = Math.floor((Date.now() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000);
  return Math.min(TOTAL_WEEKS, Math.max(1, Math.floor(days / 7) + 1));
};

const scoreClass = (score) => {
  if (score === null || score === undefined) return '';
  if (score >= 80) return 'is-high';
  if (score >= 60) return 'is-mid';
  return 'is-low';
};

const emptyRecruit = (suggestedNumber) => ({
  full_name: '', number: suggestedNumber, phone: '', city: 'Cochabamba',
  objective: '', start_date: new Date().toISOString().slice(0, 10)
});

export default function ForjaPanel({ token }) {
  const toast = useToast();
  const [view, setView] = useState('candidatos'); // candidatos | desafios
  const [candidates, setCandidates] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [enlisting, setEnlisting] = useState(null); // alta form state
  const [drafts, setDrafts] = useState({});         // challengeId -> {score, comment}
  const [noteText, setNoteText] = useState('');
  const [challengeForm, setChallengeForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiRequest('/api/training/candidates', { token }),
      apiRequest('/api/training/challenges', { token })
    ])
      .then(([cand, chal]) => {
        setCandidates(Array.isArray(cand?.candidates) ? cand.candidates : []);
        setChallenges(Array.isArray(chal?.challenges) ? chal.challenges : []);
      })
      .catch((err) => toast.error(err.message || 'No se pudo cargar La Montaña'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback((candidateId) => {
    apiRequest(`/api/training/candidates/${candidateId}`, { token })
      .then((data) => { setDetail(data); setDrafts({}); })
      .catch((err) => toast.error(err.message || 'No se pudo cargar la ficha'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const nextFreeNumber = useMemo(() => {
    const used = new Set(candidates.filter((c) => c.status === 'activo').map((c) => c.number));
    for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
    return 1;
  }, [candidates]);

  const stats = useMemo(() => ({
    activos: candidates.filter((c) => c.status === 'activo').length,
    graduados: candidates.filter((c) => c.status === 'graduado').length,
    bajas: candidates.filter((c) => c.status === 'baja').length
  }), [candidates]);

  const enlist = async () => {
    if (!enlisting?.full_name.trim() || saving) return;
    setSaving(true);
    try {
      await apiRequest('/api/training/candidates', { method: 'POST', token, body: enlisting });
      toast.success(`N° ${pad2(enlisting.number)} enlistado. Bienvenido a La Montaña.`);
      setEnlisting(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo enlistar');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (candidate, status) => {
    const labels = { graduado: '¿Graduar', baja: '¿Dar de baja', activo: '¿Reactivar' };
    if (!window.confirm(`${labels[status]} a N° ${pad2(candidate.number)} ${candidate.full_name}?`)) return;
    let bajaNote = null;
    if (status === 'baja') {
      bajaNote = window.prompt('Motivo de la baja (queda en la bitácora):', '');
      if (bajaNote === null) return;
    }
    try {
      await apiRequest(`/api/training/candidates/${candidate.id}`, { method: 'PATCH', token, body: { status } });
      if (status === 'baja' && bajaNote?.trim()) {
        await apiRequest(`/api/training/candidates/${candidate.id}/notes`, {
          method: 'POST', token, body: { note: `BAJA — ${bajaNote.trim()}` }
        });
      }
      if (status === 'graduado') toast.success(`🎖 N° ${pad2(candidate.number)} ${candidate.full_name} GRADUADO`);
      load();
      if (selectedId === candidate.id) loadDetail(candidate.id);
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar el estado');
    }
  };

  const saveScore = async (challenge) => {
    const draft = drafts[challenge.id];
    const score = Number(draft?.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      toast.error('La nota debe estar entre 0 y 100');
      return;
    }
    try {
      await apiRequest('/api/training/scores', {
        method: 'PUT', token,
        body: { candidate_id: detail.candidate.id, challenge_id: challenge.id, score, comment: draft?.comment || '' }
      });
      toast.success('Calificación registrada');
      loadDetail(detail.candidate.id);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo calificar');
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await apiRequest(`/api/training/candidates/${detail.candidate.id}/notes`, {
        method: 'POST', token, body: { note: noteText.trim() }
      });
      setNoteText('');
      loadDetail(detail.candidate.id);
    } catch (err) {
      toast.error(err.message || 'No se pudo registrar la nota');
    }
  };

  const saveChallenge = async () => {
    if (!challengeForm?.title.trim() || saving) return;
    setSaving(true);
    try {
      if (challengeForm.id) {
        await apiRequest(`/api/training/challenges/${challengeForm.id}`, { method: 'PUT', token, body: challengeForm });
      } else {
        await apiRequest('/api/training/challenges', { method: 'POST', token, body: challengeForm });
      }
      toast.success(challengeForm.id ? 'Desafío actualizado' : 'Desafío agregado al plan');
      setChallengeForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el desafío');
    } finally {
      setSaving(false);
    }
  };

  const removeChallenge = async (challenge) => {
    if (!window.confirm(`¿Retirar "${challenge.title}" del plan? Las notas ya puestas se conservan.`)) return;
    try {
      await apiRequest(`/api/training/challenges/${challenge.id}`, { method: 'DELETE', token });
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo retirar');
    }
  };

  if (loading) return <div className="forja-page"><p className="forja-loading">Cargando La Montaña…</p></div>;

  // ─── Detail view ───────────────────────────────────────────────────────────
  if (selectedId && detail) {
    const { candidate, challenges: chs, notes } = detail;
    const meta = STATUS_META[candidate.status];
    const byWeek = new Map();
    for (const ch of chs) {
      if (!byWeek.has(ch.week)) byWeek.set(ch.week, []);
      byWeek.get(ch.week).push(ch);
    }
    const currentWeek = weekOf(candidate.start_date);
    return (
      <div className="forja-page">
        <button type="button" className="forja-back" onClick={() => setSelectedId(null)}>← Volver al escuadrón</button>

        <div className="forja-detail-head">
          <div className="forja-detail-number">{pad2(candidate.number)}</div>
          <div className="forja-detail-info">
            <h2 className="forja-detail-name">{candidate.full_name}</h2>
            <div className="forja-detail-meta">
              <span className={`forja-status ${meta.className}`}>{meta.label}</span>
              {candidate.city && <span>📍 {candidate.city}</span>}
              {candidate.phone && <span>📞 {candidate.phone}</span>}
              <span>Inicio: {candidate.start_date}</span>
              {candidate.status === 'activo' && <span className="forja-week-chip">SEMANA {currentWeek}/{TOTAL_WEEKS}</span>}
            </div>
            {candidate.objective && <p className="forja-detail-objective">🎯 {candidate.objective}</p>}
          </div>
          <div className="forja-detail-score">
            <span className={`forja-avg ${scoreClass(candidate.avg_score)}`}>
              {candidate.avg_score === null ? '—' : candidate.avg_score}
            </span>
            <small>PROMEDIO · {candidate.scored_count}/{candidate.challenge_count} desafíos</small>
          </div>
        </div>

        <div className="forja-detail-actions">
          {candidate.status === 'activo' && (
            <>
              <button type="button" className="forja-btn is-gold" onClick={() => setStatus(candidate, 'graduado')}>🎖 Graduar</button>
              <button type="button" className="forja-btn is-danger" onClick={() => setStatus(candidate, 'baja')}>Dar de baja</button>
            </>
          )}
          {candidate.status !== 'activo' && (
            <button type="button" className="forja-btn" onClick={() => setStatus(candidate, 'activo')}>Reactivar</button>
          )}
        </div>

        <div className="forja-detail-grid">
          <div className="forja-challenges">
            <h3 className="forja-section-title">DESAFÍOS</h3>
            {chs.length === 0 && (
              <p className="forja-muted">No hay desafíos en el plan todavía. Créalos en la pestaña Desafíos.</p>
            )}
            {[...byWeek.entries()].map(([week, weekChallenges]) => (
              <div key={week} className={`forja-week ${candidate.status === 'activo' && week === currentWeek ? 'is-current' : ''}`}>
                <div className="forja-week-label">
                  SEMANA {week}
                  {candidate.status === 'activo' && week === currentWeek && <span className="forja-now">◉ EN CURSO</span>}
                </div>
                {weekChallenges.map((ch) => {
                  const draft = drafts[ch.id] || { score: ch.score ?? '', comment: ch.comment || '' };
                  return (
                    <div key={ch.id} className="forja-challenge">
                      <div className="forja-challenge-info">
                        <div className="forja-challenge-title">{ch.title}</div>
                        {ch.description && <div className="forja-challenge-desc">{ch.description}</div>}
                        {ch.score !== null && (
                          <div className="forja-challenge-graded">
                            Calificado{ch.graded_by ? ` por ${ch.graded_by}` : ''}
                            {ch.comment ? ` — “${ch.comment}”` : ''}
                          </div>
                        )}
                      </div>
                      <div className="forja-grade">
                        <input
                          type="number" min="0" max="100" placeholder="0-100"
                          value={draft.score}
                          onChange={(e) => setDrafts({ ...drafts, [ch.id]: { ...draft, score: e.target.value } })}
                          className={`forja-score-input ${scoreClass(ch.score)}`}
                        />
                        <input
                          type="text" placeholder="Comentario (opcional)" maxLength={500}
                          value={draft.comment}
                          onChange={(e) => setDrafts({ ...drafts, [ch.id]: { ...draft, comment: e.target.value } })}
                          className="forja-comment-input"
                        />
                        <button type="button" className="forja-btn is-small" onClick={() => saveScore(ch)}>
                          {ch.score === null ? 'Calificar' : 'Actualizar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="forja-log">
            <h3 className="forja-section-title">BITÁCORA</h3>
            <div className="forja-log-add">
              <textarea
                rows={2} maxLength={1000}
                placeholder="Observación del día: actitud, disciplina, avance…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button type="button" className="forja-btn is-small" disabled={!noteText.trim()} onClick={addNote}>
                + Registrar
              </button>
            </div>
            {notes.length === 0 && <p className="forja-muted">Sin registros todavía.</p>}
            <ul className="forja-log-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <span className="forja-log-date">
                    {new Date(n.created_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })}
                    {n.author ? ` · ${n.author}` : ''}
                  </span>
                  <span className="forja-log-text">{n.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ─── Roster / Desafíos views ───────────────────────────────────────────────
  return (
    <div className="forja-page">
      <div className="forja-hero">
        <p className="forja-eyebrow">PROGRAMA DE ÉLITE PCX · CLASIFICADO</p>
        <h2 className="forja-title">LA MONTAÑA</h2>
        <p className="forja-sub">6 semanas. Desafíos reales. Solo los mejores se quedan.</p>
      </div>

      <div className="forja-tabs">
        <button type="button" className={`forja-tab ${view === 'candidatos' ? 'is-active' : ''}`} onClick={() => setView('candidatos')}>
          ESCUADRÓN
        </button>
        <button type="button" className={`forja-tab ${view === 'desafios' ? 'is-active' : ''}`} onClick={() => setView('desafios')}>
          DESAFÍOS ({challenges.length})
        </button>
      </div>

      {view === 'candidatos' && (
        <>
          <div className="forja-stats">
            <div className="forja-stat"><b>{stats.activos}</b><span>EN INSTRUCCIÓN</span></div>
            <div className="forja-stat is-gold"><b>{stats.graduados}</b><span>GRADUADOS</span></div>
            <div className="forja-stat is-baja"><b>{stats.bajas}</b><span>BAJAS</span></div>
            <button type="button" className="forja-btn is-gold forja-enlist-btn" onClick={() => setEnlisting(emptyRecruit(nextFreeNumber))}>
              + ENLISTAR CANDIDATO
            </button>
          </div>

          {enlisting && (
            <div className="forja-enlist">
              <h3 className="forja-section-title">NUEVO CANDIDATO</h3>
              <div className="forja-enlist-grid">
                <label><span>Nombre completo</span>
                  <input type="text" maxLength={120} value={enlisting.full_name} placeholder="Ej: Marco Rojas"
                    onChange={(e) => setEnlisting({ ...enlisting, full_name: e.target.value })} />
                </label>
                <label><span>Número (1-99)</span>
                  <input type="number" min="1" max="99" value={enlisting.number}
                    onChange={(e) => setEnlisting({ ...enlisting, number: Number.parseInt(e.target.value, 10) || '' })} />
                </label>
                <label><span>Teléfono</span>
                  <input type="text" maxLength={40} value={enlisting.phone}
                    onChange={(e) => setEnlisting({ ...enlisting, phone: e.target.value })} />
                </label>
                <label><span>Ciudad</span>
                  <select value={enlisting.city} onChange={(e) => setEnlisting({ ...enlisting, city: e.target.value })}>
                    {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label><span>Inicio de instrucción</span>
                  <input type="date" value={enlisting.start_date}
                    onChange={(e) => setEnlisting({ ...enlisting, start_date: e.target.value })} />
                </label>
                <label className="is-wide"><span>Objetivo (a qué problema apunta)</span>
                  <input type="text" maxLength={300} value={enlisting.objective}
                    placeholder="Ej: liderar la línea Armonía en Santa Cruz"
                    onChange={(e) => setEnlisting({ ...enlisting, objective: e.target.value })} />
                </label>
              </div>
              <div className="forja-enlist-actions">
                <button type="button" className="forja-btn" onClick={() => setEnlisting(null)} disabled={saving}>Cancelar</button>
                <button type="button" className="forja-btn is-gold" onClick={enlist} disabled={saving || !enlisting.full_name.trim()}>
                  {saving ? '…' : 'ENLISTAR'}
                </button>
              </div>
            </div>
          )}

          {candidates.length === 0 && !enlisting && (
            <p className="forja-muted forja-empty">El escuadrón está vacío. Enlista al primer candidato.</p>
          )}

          <div className="forja-roster">
            {candidates.map((c) => {
              const meta = STATUS_META[c.status];
              const progress = c.challenge_count > 0 ? (c.scored_count / c.challenge_count) * 100 : 0;
              return (
                <button type="button" key={c.id} className={`forja-card ${meta.className}`} onClick={() => setSelectedId(c.id)}>
                  <div className="forja-card-number">{pad2(c.number)}</div>
                  <div className="forja-card-body">
                    <div className="forja-card-name">{c.full_name}</div>
                    <div className="forja-card-meta">
                      {c.city || '—'}
                      {c.status === 'activo' && ` · SEMANA ${weekOf(c.start_date)}/${TOTAL_WEEKS}`}
                    </div>
                    <div className="forja-card-bar"><div style={{ width: `${progress}%` }} /></div>
                    <div className="forja-card-foot">
                      <span className={`forja-status ${meta.className}`}>{meta.label}</span>
                      <span className={`forja-card-avg ${scoreClass(c.avg_score)}`}>
                        {c.avg_score === null ? 'S/N' : c.avg_score}
                      </span>
                    </div>
                    {c.last_note && <div className="forja-card-note">“{c.last_note}”</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === 'desafios' && (
        <div className="forja-plan">
          <div className="forja-plan-head">
            <p className="forja-muted">
              El plan de las {TOTAL_WEEKS} semanas. Cada desafío se califica de 0 a 100 en la ficha del candidato.
            </p>
            <button type="button" className="forja-btn is-gold" onClick={() => setChallengeForm({ title: '', week: 1, description: '' })}>
              + NUEVO DESAFÍO
            </button>
          </div>

          {challengeForm && (
            <div className="forja-enlist">
              <h3 className="forja-section-title">{challengeForm.id ? 'EDITAR DESAFÍO' : 'NUEVO DESAFÍO'}</h3>
              <div className="forja-enlist-grid">
                <label className="is-wide"><span>Título</span>
                  <input type="text" maxLength={160} value={challengeForm.title}
                    placeholder="Ej: Armar un tablero T4764 completo en menos de 2 horas"
                    onChange={(e) => setChallengeForm({ ...challengeForm, title: e.target.value })} />
                </label>
                <label><span>Semana</span>
                  <select value={challengeForm.week} onChange={(e) => setChallengeForm({ ...challengeForm, week: Number(e.target.value) })}>
                    {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>Semana {w}</option>
                    ))}
                  </select>
                </label>
                <label className="is-wide"><span>Descripción / criterio de éxito</span>
                  <textarea rows={2} maxLength={1000} value={challengeForm.description}
                    onChange={(e) => setChallengeForm({ ...challengeForm, description: e.target.value })} />
                </label>
              </div>
              <div className="forja-enlist-actions">
                <button type="button" className="forja-btn" onClick={() => setChallengeForm(null)} disabled={saving}>Cancelar</button>
                <button type="button" className="forja-btn is-gold" onClick={saveChallenge} disabled={saving || !challengeForm.title.trim()}>
                  {saving ? '…' : 'GUARDAR'}
                </button>
              </div>
            </div>
          )}

          {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((week) => {
            const weekChallenges = challenges.filter((ch) => ch.week === week);
            return (
              <div key={week} className="forja-week">
                <div className="forja-week-label">SEMANA {week}</div>
                {weekChallenges.length === 0 && <p className="forja-muted">Sin desafíos.</p>}
                {weekChallenges.map((ch) => (
                  <div key={ch.id} className="forja-challenge">
                    <div className="forja-challenge-info">
                      <div className="forja-challenge-title">{ch.title}</div>
                      {ch.description && <div className="forja-challenge-desc">{ch.description}</div>}
                    </div>
                    <div className="forja-grade">
                      <button type="button" className="forja-btn is-small" onClick={() => setChallengeForm({ ...ch })}>Editar</button>
                      <button type="button" className="forja-btn is-small is-danger" onClick={() => removeChallenge(ch)}>Retirar</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
