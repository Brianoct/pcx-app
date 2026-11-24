import { useEffect, useState } from 'react';
import { apiRequest } from '../apiClient';

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const money = (value) => `${Number(value || 0).toFixed(2)} Bs`;
const pts = (value) => `+${Number(value || 0).toFixed(2).replace(/\.?0+$/, '')}`;
const STATUS_ICON = { green: '✓', red: '✕', nodata: '–' };

// Incentivos de ventas por esfuerzo, en simulación. Admin ajusta las reglas y
// ve cuánto habría ganado cada persona. No cambia Comisiones ni Pagos, y el
// equipo de ventas no ve esta pantalla.
function IncentivosPanel({ token }) {
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const apply = (payload) => {
    setData(payload);
    setDraft({
      cap_pct: payload.settings.cap_pct,
      min_cases: payload.settings.min_cases,
      rules: payload.rules.map((r) => ({ ...r }))
    });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await apiRequest(`/api/admin/sales-incentives?month=${period.month}&year=${period.year}`, { token });
        if (active) apply(payload);
      } catch (err) {
        if (active) setError(err.message || 'No se pudo cargar la simulación');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, period.month, period.year]);

  const shiftPeriod = (delta) => {
    setMessage('');
    setPeriod((prev) => {
      const d = new Date(prev.year, prev.month - 1 + delta, 1);
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    });
  };

  const setRule = (key, field, value) => {
    setMessage('');
    setDraft((prev) => ({ ...prev, rules: prev.rules.map((r) => (r.key === key ? { ...r, [field]: value } : r)) }));
  };

  const dirty = Boolean(data && draft) && JSON.stringify({
    cap_pct: Number(draft.cap_pct), min_cases: Number(draft.min_cases),
    rules: draft.rules.map((r) => [r.key, Number(r.threshold), r.param === null ? null : Number(r.param), Number(r.bump_pct), r.enabled])
  }) !== JSON.stringify({
    cap_pct: data.settings.cap_pct, min_cases: data.settings.min_cases,
    rules: data.rules.map((r) => [r.key, r.threshold, r.param, r.bump_pct, r.enabled])
  });

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = await apiRequest(`/api/admin/sales-incentives?month=${period.month}&year=${period.year}`, {
        method: 'PUT',
        token,
        body: {
          cap_pct: Number(draft.cap_pct),
          min_cases: Number(draft.min_cases),
          rules: draft.rules.map((r) => ({
            key: r.key, threshold: Number(r.threshold), bump_pct: Number(r.bump_pct), enabled: r.enabled,
            ...(r.param === null ? {} : { param: Number(r.param) })
          }))
        }
      });
      apply(payload);
      setMessage('Reglas guardadas. La simulación se recalculó.');
    } catch (err) {
      setError(err.message || 'No se pudieron guardar las reglas');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <div className="card" style={{ color: '#78716c' }}>Calculando simulación…</div>;
  if (!data) return <div className="card" style={{ borderColor: '#ef4444', color: '#b91c1c' }}>{error}</div>;

  const monthLabel = `${MONTH_NAMES[period.month - 1]} ${period.year}`;
  const maxPossible = draft.rules.filter((r) => r.enabled).reduce((sum, r) => sum + Number(r.bump_pct || 0), 0);

  return (
    <div className="card incent-page">
      <div className="incent-banner">
        <strong>Simulación.</strong> Nada de esto se paga ni aparece para el equipo. Muestra cuánto
        habría ganado cada persona de ventas con estas reglas, para ajustarlas antes de decidir.
      </div>

      <div className="payroll-head">
        <div>
          <h3 style={{ margin: 0 }}>Incentivos por esfuerzo</h3>
          <p className="incent-sub">
            Cada regla mide algo que la app registra sola. Quien pasa el umbral suma puntos a su
            comisión del mes sobre sus ventas cobradas. La comisión base no baja nunca.
          </p>
        </div>
        <div className="payroll-period">
          <button type="button" className="payroll-period-btn" onClick={() => shiftPeriod(-1)} aria-label="Mes anterior">‹</button>
          <span className="payroll-period-label">{monthLabel}</span>
          <button type="button" className="payroll-period-btn" onClick={() => shiftPeriod(1)} aria-label="Mes siguiente">›</button>
        </div>
      </div>

      <div className="incent-kpis">
        <div className="incent-kpi"><span>Ventas cobradas del equipo</span><strong>{money(data.totals.sales)}</strong></div>
        <div className="incent-kpi"><span>Comisión base</span><strong>{money(data.totals.base_commission)}</strong></div>
        <div className="incent-kpi is-extra"><span>Costo extra simulado</span><strong>{money(data.totals.extra)}</strong><small>{data.totals.extra_pct_of_sales}% de las ventas</small></div>
      </div>

      <h4 className="incent-title">Reglas</h4>
      <div className="incent-rules">
        {draft.rules.map((rule) => (
          <div key={rule.key} className={`incent-rule ${rule.enabled ? '' : 'is-off'}`}>
            <label className="incent-rule-head">
              <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule(rule.key, 'enabled', e.target.checked)} />
              <span>{rule.label}</span>
            </label>
            <p className="incent-rule-desc">{rule.description}</p>
            <div className="incent-rule-fields">
              {rule.param !== null && (
                <label>Plazo
                  <span className="incent-input"><input type="number" min="1" step="1" value={rule.param} onChange={(e) => setRule(rule.key, 'param', e.target.value)} aria-label={`Plazo de ${rule.label}`} /><em>{rule.param_unit}</em></span>
                </label>
              )}
              <label>Umbral
                <span className="incent-input"><input type="number" min="0" max="100" step="5" value={rule.threshold} onChange={(e) => setRule(rule.key, 'threshold', e.target.value)} aria-label={`Umbral de ${rule.label}`} /><em>% de los casos</em></span>
              </label>
              <label>Sube la comisión
                <span className="incent-input"><input type="number" min="0" max="20" step="0.1" value={rule.bump_pct} onChange={(e) => setRule(rule.key, 'bump_pct', e.target.value)} aria-label={`Puntos de ${rule.label}`} /><em>puntos</em></span>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="incent-settings">
        <label>Tope de puntos extra por mes
          <span className="incent-input"><input type="number" min="0" max="50" step="0.1" value={draft.cap_pct} onChange={(e) => { setMessage(''); setDraft((p) => ({ ...p, cap_pct: e.target.value })); }} aria-label="Tope de puntos" /><em>puntos</em></span>
        </label>
        <label>Mínimo de casos para juzgar una regla
          <span className="incent-input"><input type="number" min="1" max="100" step="1" value={draft.min_cases} onChange={(e) => { setMessage(''); setDraft((p) => ({ ...p, min_cases: e.target.value })); }} aria-label="Mínimo de casos" /><em>casos</em></span>
        </label>
        <span className="incent-max">Las reglas activas suman hasta {pts(maxPossible)} puntos.</span>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Guardando…' : 'Guardar y recalcular'}
        </button>
      </div>
      {message && <p className="incent-ok">{message}</p>}
      {error && <p className="incent-error">{error}</p>}

      <h4 className="incent-title">Cómo le habría ido a cada persona en {monthLabel}</h4>
      {data.people.length === 0 && <p className="incent-sub">No hay personas activas en Ventas.</p>}
      <div className="incent-people">
        {data.people.map((p) => (
          <div key={p.user_id} className="incent-person">
            <div className="incent-person-head">
              <div>
                <div className="incent-person-name">{p.name}</div>
                <div className="incent-person-role">{p.role} · {p.base_source}</div>
              </div>
              <div className="incent-person-money">
                <span>Base <strong>{money(p.base_commission)}</strong></span>
                <span className="incent-plus">{pts(p.bump_pct)} pts{p.capped ? ' (tope)' : ''} <strong>+{money(p.extra)}</strong></span>
                <span className="incent-total">Con incentivos <strong>{money(p.simulated_commission)}</strong></span>
              </div>
            </div>
            <div className="incent-items">
              {p.items.map((item) => (
                <div key={item.key} className={`incent-item is-${item.status}`}>
                  <span className="incent-item-icon">{STATUS_ICON[item.status]}</span>
                  <span className="incent-item-label">{item.label}</span>
                  <span className="incent-item-value">{item.value === null ? 'sin casos' : `${item.value}%`}<small> / meta {item.threshold}%</small></span>
                  <span className="incent-item-detail">{item.detail}</span>
                  <span className="incent-item-bump">{item.status === 'green' ? pts(item.bump_pct) : '0'}</span>
                </div>
              ))}
            </div>
            <div className="incent-person-foot">Ventas cobradas del mes: {money(p.sales)}</div>
          </div>
        ))}
      </div>

      <p className="incent-note">
        “Seguimiento” y “Respuesta rápida” solo ven los mensajes que pasan por el WhatsApp de la app.
        “Cobro rápido” empieza a contar desde que existe la fecha real de cobro. Los meses anteriores
        aparecen sin casos.
      </p>
    </div>
  );
}

export default IncentivosPanel;
