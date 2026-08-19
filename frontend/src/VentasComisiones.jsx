// «Rendimiento de ventas»: el resumen de comisiones del Inicio comercial.
// KPIs del mes con comparación contra el mes anterior, ranking del equipo
// (líderes) con avatar y tendencia de 6 meses, y selector de período.
// La posición se calcula por VENTAS del mes, no por comisión pagada.
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const AVATAR_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1'];
const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const formatBs = (value) => `Bs ${Number(value || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatBsShort = (value) => {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toLocaleString('es-BO', { maximumFractionDigits: 1 })}k`;
  return String(Math.round(n));
};

// Δ contra el mes anterior: null cuando no hay base de comparación.
const deltaPct = (current, previous) => {
  const prev = Number(previous || 0);
  const cur = Number(current || 0);
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
};

function DeltaBadge({ pct, prevLabel }) {
  if (!Number.isFinite(pct) || !prevLabel) return null;
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <span className={`vc-delta is-${dir}`} title={`Comparado con ${prevLabel}`}>
      {dir === 'up' ? `↑ ${pct}% vs ${prevLabel}`
        : dir === 'down' ? `↓ ${Math.abs(pct)}% vs ${prevLabel}`
          : `= igual que ${prevLabel}`}
    </span>
  );
}

// Mini barras de los últimos meses (tendencia). El mes elegido va resaltado.
function TrendBars({ points, highlightLast, money = true }) {
  const max = Math.max(...points.map((p) => Number(p.value || 0)), 1);
  return (
    <span className="vc-trend" aria-hidden="true">
      {points.map((p, index) => (
        <span
          key={`${p.label}-${index}`}
          className={`vc-trend-bar ${highlightLast && index === points.length - 1 ? 'is-current' : ''}`}
          style={{ height: `${Math.max(8, Math.round((Number(p.value || 0) / max) * 100))}%` }}
          title={`${p.label}: ${money ? formatBs(p.value) : p.value}`}
        />
      ))}
    </span>
  );
}

function KpiCard({ icon, iconBg, label, value, hint, delta, prevLabel, progress }) {
  return (
    <div className="vc-kpi">
      <span className="vc-kpi-icon" style={{ background: iconBg }} aria-hidden="true">{icon}</span>
      <span className="vc-kpi-body">
        <span className="vc-kpi-label">{label}</span>
        <span className="vc-kpi-value">{value}</span>
        {hint && <span className="vc-kpi-hint">{hint}</span>}
        {Number.isFinite(progress) && (
          <span className="vc-kpi-bar"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></span>
        )}
        <DeltaBadge pct={delta} prevLabel={prevLabel} />
      </span>
    </div>
  );
}

export default function VentasComisiones({ token, goals = null }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    apiRequest(`/api/ventas/comisiones?month=${month}&year=${year}`, { token })
      .then((res) => { if (active) { setData(res); setError(null); } })
      .catch((err) => { if (active) setError(err.message || 'No se pudo cargar el resumen'); });
    return () => { active = false; };
  }, [token, month, year]);

  const isTeam = data?.scope === 'team';
  const history = useMemo(() => (Array.isArray(data?.history) ? data.history : []), [data]);
  const currentMonth = history[history.length - 1] || null;
  const previousMonth = history[history.length - 2] || null;
  const prevLabel = previousMonth ? previousMonth.label.toLowerCase() : '';
  // Las metas aplican al mes en curso: mirando un mes pasado no se muestran.
  const isCurrentPeriod = month === now.getMonth() + 1 && year === now.getFullYear();
  const metaBsPct = goals && Number(goals.monthly_target_bs) > 0
    ? Math.round((Number(data?.me?.sales || 0) / Number(goals.monthly_target_bs)) * 100)
    : null;
  const metaUnitsPct = goals && Number(goals.monthly_units_expected) > 0
    ? Math.round((Number(data?.me?.closed || 0) / Number(goals.monthly_units_expected)) * 100)
    : null;

  // Serie del gráfico de comparación: equipo para líderes, propia para asesores.
  const seriesKey = isTeam ? 'team' : 'my';
  const salesSeries = history.map((h) => ({ label: h.label, value: h[`${seriesKey}_sales`] }));
  const commissionSeries = history.map((h) => ({ label: h.label, value: h[`${seriesKey}_commission`] }));

  if (error) {
    // Sin acceso o error: la tarjeta no estorba en el Inicio.
    return null;
  }

  return (
    <section className="home-card vc-card">
      <div className="home-card-head vc-head">
        <div className="vc-head-title">
          <h3>📊 Rendimiento de ventas</h3>
          <p className="home-card-sub">Comisiones del período y comparación con meses anteriores</p>
        </div>
        <div className="vc-period">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {!data ? (
        <p className="dashboard-muted">Cargando comisiones…</p>
      ) : (
        <>
          <div className="vc-kpis">
            {isTeam ? (
              <>
                <KpiCard
                  icon="📈" iconBg="#dcfce7"
                  label="Ventas del equipo"
                  value={formatBs(data.team?.sales)}
                  delta={deltaPct(currentMonth?.team_sales, previousMonth?.team_sales)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon="💼" iconBg="#dbeafe"
                  label="Comisiones"
                  value={formatBs(data.team?.commission)}
                  hint="Suma de reglas por rol"
                  delta={deltaPct(currentMonth?.team_commission, previousMonth?.team_commission)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon="🤝" iconBg="#fef3c7"
                  label="Cierres del mes"
                  value={String(data.team?.closed ?? 0)}
                  delta={deltaPct(currentMonth?.team_closed, previousMonth?.team_closed)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon="⭐" iconBg="#ffedd5"
                  label="Mejor en ventas"
                  value={data.team?.top_seller ? data.team.top_seller.name : 'Sin datos'}
                  hint={data.team?.top_seller ? formatBs(data.team.top_seller.sales) : 'Aún sin ventas este mes'}
                />
              </>
            ) : (
              <>
                <KpiCard
                  icon="📈" iconBg="#dcfce7"
                  label="Mis ventas"
                  value={formatBs(data.me?.sales)}
                  hint={goals && isCurrentPeriod
                    ? `Meta ${Math.round(Number(goals.monthly_target_bs)).toLocaleString('es-BO')} Bs (${metaBsPct ?? 0}%)`
                    : undefined}
                  progress={goals && isCurrentPeriod ? metaBsPct : undefined}
                  delta={deltaPct(currentMonth?.my_sales, previousMonth?.my_sales)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon="💼" iconBg="#dbeafe"
                  label="Mi comisión"
                  value={formatBs(data.me?.commission)}
                  hint={data.me?.rule || ''}
                  delta={deltaPct(currentMonth?.my_commission, previousMonth?.my_commission)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon="🤝" iconBg="#fef3c7"
                  label="Mis cierres"
                  value={String(data.me?.closed ?? 0)}
                  hint={goals && isCurrentPeriod
                    ? `Meta ${goals.monthly_units_expected} · mín ${goals.monthly_units_min} · sobresaliente ${goals.monthly_units_high}`
                    : undefined}
                  progress={goals && isCurrentPeriod ? metaUnitsPct : undefined}
                  delta={deltaPct(currentMonth?.my_closed, previousMonth?.my_closed)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon="🏪" iconBg="#ede9fe"
                  label="Ventas del área"
                  value={formatBs(currentMonth?.team_sales)}
                  hint={`${currentMonth?.team_closed ?? 0} cierres del área`}
                  delta={deltaPct(currentMonth?.team_sales, previousMonth?.team_sales)}
                  prevLabel={prevLabel}
                />
                <KpiCard
                  icon={data.me?.is_top ? '⭐' : '🎯'} iconBg="#ffedd5"
                  label="Mi plan de comisión"
                  value={data.me?.is_top ? `${data.settings?.top_percent}%` : `${data.settings?.regular_percent}%`}
                  hint={data.me?.is_top ? '¡Eres quien va mejor en ventas!' : `Mejor en ventas gana ${data.settings?.top_percent}%`}
                />
              </>
            )}
          </div>

          <div className="vc-compare">
            <div className="vc-compare-block">
              <span className="vc-compare-title">{isTeam ? 'Ventas del equipo · últimos 6 meses' : 'Mis ventas · últimos 6 meses'}</span>
              <div className="vc-compare-chart">
                {salesSeries.map((point, index) => {
                  const max = Math.max(...salesSeries.map((p) => Number(p.value || 0)), 1);
                  const isCurrent = index === salesSeries.length - 1;
                  return (
                    <div key={point.label} className={`vc-col ${isCurrent ? 'is-current' : ''}`} title={`${point.label}: ${formatBs(point.value)}`}>
                      <span className="vc-col-value">{formatBsShort(point.value)}</span>
                      <span className="vc-col-track">
                        <span className="vc-col-bar" style={{ height: `${Math.max(6, Math.round((Number(point.value || 0) / max) * 100))}%` }} />
                      </span>
                      <span className="vc-col-label">{point.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="vc-compare-block">
              <span className="vc-compare-title">{isTeam ? 'Comisiones · últimos 6 meses' : 'Mi comisión · últimos 6 meses'}</span>
              <div className="vc-compare-chart is-commission">
                {commissionSeries.map((point, index) => {
                  const max = Math.max(...commissionSeries.map((p) => Number(p.value || 0)), 1);
                  const isCurrent = index === commissionSeries.length - 1;
                  return (
                    <div key={point.label} className={`vc-col ${isCurrent ? 'is-current' : ''}`} title={`${point.label}: ${formatBs(point.value)}`}>
                      <span className="vc-col-value">{formatBsShort(point.value)}</span>
                      <span className="vc-col-track">
                        <span className="vc-col-bar" style={{ height: `${Math.max(6, Math.round((Number(point.value || 0) / max) * 100))}%` }} />
                      </span>
                      <span className="vc-col-label">{point.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {isTeam && Array.isArray(data.rows) && data.rows.length > 0 && (
            <div className="vc-table-wrap">
              <table className="vc-table">
                <thead>
                  <tr>
                    <th className="vc-th-pos">#</th>
                    <th>Vendedor</th>
                    <th>Plan de comisión</th>
                    <th className="vc-th-num">Cierres</th>
                    <th className="vc-th-num">Ventas</th>
                    <th className="vc-th-num">Comisión del mes</th>
                    <th>Tendencia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={row.user_id} className={row.is_top ? 'is-top' : ''}>
                      <td className="vc-td-pos">
                        <span className={`vc-pos ${index === 0 ? 'is-first' : ''}`}>{index + 1}</span>
                      </td>
                      <td>
                        <span className="vc-seller">
                          <span className="vc-avatar" style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}>
                            {String(row.name || '?').trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="vc-seller-info">
                            <strong>{row.name}{row.is_top ? ' ⭐' : ''}</strong>
                            <small>{row.role_label}</small>
                          </span>
                        </span>
                      </td>
                      <td className="vc-td-rule">{row.rule}</td>
                      <td className="vc-td-num">{row.closed}</td>
                      <td className="vc-td-num">{formatBs(row.sales)}</td>
                      <td className="vc-td-num vc-td-commission">{formatBs(row.commission)}</td>
                      <td className="vc-td-trend">
                        <TrendBars points={(row.monthly || []).map((m) => ({ label: m.label, value: m.sales }))} highlightLast />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="vc-note">
            ℹ️ La posición se calcula por ventas del mes. El mejor en ventas gana {data.settings?.top_percent}% y los asesores {data.settings?.regular_percent}%; el líder gana {data.settings?.lider_percent}% del equipo + propias.
          </p>
        </>
      )}
    </section>
  );
}
