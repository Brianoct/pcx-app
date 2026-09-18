import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';

// Bono por desempeño: "si uno cae, caemos todos".
// Una puerta del EQUIPO por área (metas que el sistema mide solo: entregas a
// tiempo, rechazos) y metas PERSONALES (mejora diaria, trabajo en grupo,
// velocidad de la estación contra su propia base). Todo en verde = la
// comisión del mes sube unos puntos. Por ahora es una vista previa: no toca
// Comisiones hasta que Brian conecte el tick-up.

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const STATUS_META = {
  green: { label: 'Verde', icon: '✓' },
  red: { label: 'Rojo', icon: '✕' },
  nodata: { label: 'Sin datos', icon: '…' },
  undefined: { label: 'Por definir', icon: '·' }
};
const AREA_ORDER = ['produccion', 'almacen', 'ventas', 'marketing', 'admin', 'general'];

const formatValue = (goal) => {
  if (goal.value === null || goal.value === undefined) return '—';
  return `${goal.value}${goal.unit === '%' || goal.unit.startsWith('%') ? '%' : ''}`;
};
const formatThreshold = (goal) => `${goal.direction === 'gte' ? '≥' : '≤'} ${goal.threshold}${goal.unit === '%' || goal.unit.startsWith('%') ? '%' : ` ${goal.unit}`}`;

const GoalChip = ({ goal }) => (
  <span className={`bono-goal is-${goal.status}`} title={`${goal.label}: ${formatValue(goal)} (meta ${formatThreshold(goal)}) · ${goal.detail || ''}`}>
    <span className="bono-goal-icon" aria-hidden="true">{STATUS_META[goal.status]?.icon}</span>
    <span className="bono-goal-label">{goal.label}</span>
    <span className="bono-goal-value">{formatValue(goal)}</span>
  </span>
);

export default function BonoPanel({ token, user }) {
  const navigate = useNavigate();
  const toast = useToast();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draftGoals, setDraftGoals] = useState(null);
  const [draftTick, setDraftTick] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const myId = Number(user?.id);
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest(`/api/bono?month=${month}&year=${year}`, { token });
      setData(result);
      setDraftGoals(result.goals.map((g) => ({ key: g.key, threshold: String(g.threshold), enabled: g.enabled })));
      setDraftTick(String(result.settings?.tick_up_pct ?? 1));
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el bono');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month, year]);

  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta) => {
    const next = new Date(year, month - 1 + delta, 1);
    setMonth(next.getMonth() + 1);
    setYear(next.getFullYear());
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const result = await apiRequest(`/api/bono/goals?month=${month}&year=${year}`, {
        method: 'PUT',
        token,
        body: {
          goals: draftGoals.map((g) => ({ key: g.key, threshold: Number(g.threshold), enabled: g.enabled })),
          tick_up_pct: Number(draftTick)
        }
      });
      setData(result);
      toast.success('Metas guardadas (quedó en la bitácora)');
    } catch (err) {
      toast.error(err.message || 'No se pudieron guardar las metas');
    } finally {
      setSaving(false);
    }
  };

  const people = useMemo(() => (Array.isArray(data?.people) ? data.people : []), [data]);
  const me = people.find((p) => p.user_id === myId) || null;
  const gates = data?.gates || {};
  const qualifying = people.filter((p) => p.qualifies).length;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const peopleByArea = useMemo(() => {
    const map = new Map();
    for (const p of people) {
      if (!map.has(p.area)) map.set(p.area, []);
      map.get(p.area).push(p);
    }
    return AREA_ORDER.filter((a) => map.has(a)).map((a) => ({ area: a, label: map.get(a)[0].area_label, people: map.get(a) }));
  }, [people]);

  const renderPerson = (p) => (
    <li key={p.user_id} className={`bono-person ${p.user_id === myId ? 'is-me' : ''} ${p.qualifies ? 'is-ok' : 'is-no'}`}>
      <div className="bono-person-head">
        <span className="bono-person-name">{p.name}{p.user_id === myId && <em>yo</em>}</span>
        <span className={`bono-person-result ${p.qualifies ? 'is-ok' : 'is-no'}`}>
          {p.qualifies ? `+${data.settings.tick_up_pct} pt${p.pending ? ' · faltan datos' : ''}` : 'sin bono'}
        </span>
      </div>
      <div className="bono-person-goals">
        {p.gate_status === 'red' && <span className="bono-goal is-red" title="La puerta del equipo está en rojo: nadie del área califica este mes"><span className="bono-goal-icon">✕</span><span className="bono-goal-label">Puerta del equipo</span></span>}
        {p.goals.map((g) => <GoalChip key={g.key} goal={g} />)}
        {p.goals.length === 0 && <span className="bono-muted">Sin metas personales definidas para su área todavía.</span>}
      </div>
    </li>
  );

  return (
    <div className="container bono-page">
      <div className="bono-head">
        <div>
          <p className="bono-tagline">Si uno cae, caemos todos. Si todos suben, <strong>la comisión sube</strong>.</p>
          <p className="bono-how">
            Cada mes hay una <strong>puerta del equipo</strong> (metas que el sistema mide solo) y <strong>metas personales</strong>.
            Con todo en verde, la comisión de ese mes sube {data?.settings?.tick_up_pct ?? 1} punto{Number(data?.settings?.tick_up_pct ?? 1) === 1 ? '' : 's'}.
            Nadie declara números: entregas, rechazos, mejoras y bloques en grupo salen de lo que ya registra la app.
          </p>
        </div>
        <div className="bono-nav">
          <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
          <span className="bono-month">{monthLabel}</span>
          <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label="Mes siguiente">›</button>
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setShowConfig((v) => !v)}>
              {showConfig ? 'Cerrar metas' : 'Metas y tick-up'}
            </button>
          )}
        </div>
      </div>

      {data?.preview && (
        <div className="bono-preview-note">
          Vista previa: el tick-up todavía no se aplica en Comisiones. Sirve para calibrar metas y que el equipo se acostumbre a verlo.
        </div>
      )}

      {loading && !data ? (
        <p className="dashboard-muted">Calculando…</p>
      ) : data && (
        <>
          {me && (
            <div className={`bono-me ${me.qualifies ? 'is-ok' : 'is-no'}`}>
              <div className="bono-me-main">
                <span className="bono-me-title">{me.qualifies ? `Vas por +${data.settings.tick_up_pct} punto${Number(data.settings.tick_up_pct) === 1 ? '' : 's'} este mes` : 'Este mes todavía no calificas'}</span>
                <span className="bono-me-sub">
                  {me.gate_status === 'red'
                    ? 'La puerta de tu equipo está en rojo: se levanta entre todos.'
                    : me.goals.some((g) => g.status === 'red')
                      ? 'Tienes una meta personal en rojo. Míralas abajo.'
                      : me.pending ? 'Faltan datos de alguna meta; sigue así.' : 'Todo en verde. Sostenlo hasta fin de mes.'}
                </span>
              </div>
              <div className="bono-me-goals">
                {me.goals.map((g) => <GoalChip key={g.key} goal={g} />)}
              </div>
              <div className="bono-me-actions">
                <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>Plan del día →</button>
                <button type="button" className="dashboard-link" onClick={() => navigate('/mejoras')}>Mejoras →</button>
              </div>
            </div>
          )}

          <h3 className="bono-section-title">Puertas del equipo</h3>
          <div className="bono-gates">
            {AREA_ORDER.filter((a) => gates[a]).map((a) => {
              const gate = gates[a];
              return (
                <div key={a} className={`bono-gate is-${gate.status}`}>
                  <div className="bono-gate-head">
                    <span className="bono-gate-area">{gate.label}</span>
                    <span className={`bono-gate-status is-${gate.status}`}>{STATUS_META[gate.status]?.label}</span>
                  </div>
                  {gate.items.length === 0 ? (
                    <p className="bono-muted">Metas de equipo por definir. Mientras tanto la puerta no bloquea a nadie.</p>
                  ) : (
                    <ul className="bono-gate-list">
                      {gate.items.map((g) => (
                        <li key={g.key} className={`is-${g.status}`}>
                          <span className="bono-goal-icon" aria-hidden="true">{STATUS_META[g.status]?.icon}</span>
                          <span className="bono-gate-goal">
                            <strong>{g.label}</strong>
                            <span>{formatValue(g)} · meta {formatThreshold(g)}{g.detail ? ` · ${g.detail}` : ''}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bono-people-head">
            <h3 className="bono-section-title">Personas</h3>
            <span className="bono-muted">{qualifying} de {people.length} califican · {data.working_days} días hábiles transcurridos</span>
          </div>
          <div className="bono-areas">
            {peopleByArea.map((group) => (
              <section key={group.area} className="card bono-area">
                <h4>{group.label} <span className={`bono-gate-status is-${gates[group.area]?.status || 'undefined'}`}>puerta {STATUS_META[gates[group.area]?.status || 'undefined']?.label.toLowerCase()}</span></h4>
                <ul className="bono-people">{group.people.map(renderPerson)}</ul>
              </section>
            ))}
          </div>

          {isAdmin && showConfig && draftGoals && (
            <section className="card bono-config">
              <div className="bono-people-head">
                <h3 className="bono-section-title">Metas y tick-up (solo Admin)</h3>
                <button type="button" className="btn btn-primary" onClick={saveConfig} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
              </div>
              <label className="bono-config-tick">
                Puntos de comisión al calificar
                <input type="number" min="0" max="50" step="0.5" value={draftTick} onChange={(e) => setDraftTick(e.target.value)} />
              </label>
              <ul className="bono-config-list">
                {data.goals.map((goal) => {
                  const draft = draftGoals.find((g) => g.key === goal.key);
                  return (
                    <li key={goal.key}>
                      <label className="bono-config-enabled">
                        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraftGoals((prev) => prev.map((g) => (g.key === goal.key ? { ...g, enabled: e.target.checked } : g)))} />
                        <span>
                          <strong>{goal.label}</strong> <em>{goal.scope === 'team' ? `puerta · ${goal.area}` : `personal · ${goal.area}`}</em>
                          <small>{goal.description}</small>
                        </span>
                      </label>
                      <span className="bono-config-threshold">
                        {goal.direction === 'gte' ? '≥' : '≤'}
                        <input type="number" min="0" step="1" value={draft.threshold} onChange={(e) => setDraftGoals((prev) => prev.map((g) => (g.key === goal.key ? { ...g, threshold: e.target.value } : g)))} />
                        <span>{goal.unit}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {Array.isArray(data.log) && data.log.length > 0 && (
                <details className="bono-log">
                  <summary>Bitácora de cambios ({data.log.length})</summary>
                  <ul>
                    {data.log.map((entry) => (
                      <li key={entry.id}>
                        <span>{new Date(entry.changed_at).toLocaleString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <strong>{entry.changed_by_name}</strong> cambió <code>{entry.goal_key}</code> {entry.field}: {entry.old_value} → {entry.new_value}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
