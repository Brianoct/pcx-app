// Panel de Ventas: el Inicio del área comercial (activable desde Admin →
// Paneles). KPIs del vendedor, embudo, seguimientos próximos, alertas y —
// para líderes — rendimiento por vendedor. Basado en el requerimiento del
// equipo de ventas (Embudo.pdf).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';

const formatBs = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDate = (text) => {
  if (!text) return '';
  const [, m, d] = String(text).split('-').map(Number);
  return `${d} ${MONTH_SHORT[(m || 1) - 1]}`;
};
const todayText = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const STAGE_LABELS = {
  contactado: 'Contactado',
  cotizado: 'Cotizado',
  negociando: 'Negociando',
  cliente: 'Cliente PCX',
  perdido: 'Perdido'
};

const FUNNEL_COLORS = { contactado: '#3b82f6', cotizado: '#8b5cf6', negociando: '#f59e0b', ganados: '#16a34a' };

export default function VentasDashboard({ token }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      apiRequest('/api/ventas/dashboard', { token })
        .then((res) => { if (active) { setData(res); setError(null); } })
        .catch((err) => { if (active) setError(err.message || 'No se pudo cargar el panel'); });
    };
    load();
    const intervalId = setInterval(load, 60000);
    return () => { active = false; clearInterval(intervalId); };
  }, [token]);

  if (error) return <div className="container home-page"><p className="dashboard-muted">{error}</p></div>;
  if (!data) return <div className="container home-page"><p className="dashboard-muted">Cargando panel de ventas…</p></div>;

  const { sales, funnel, seguimientos, alerts, goals, per_vendor: perVendor, scope } = data;
  const today = todayText();

  const tiles = [
    {
      key: 'mes_bs',
      label: scope === 'team' ? 'Ventas del mes · equipo' : 'Mis ventas del mes',
      value: formatBs(sales.sold_month_bs),
      detail: goals ? `Meta ${formatBs(goals.monthly_target_bs)} (${sales.goal_bs_pct ?? 0}%)` : `${sales.sold_month} cerradas`,
      to: '/history',
      progress: sales.goal_bs_pct
    },
    {
      key: 'mes_units',
      label: 'Ventas cerradas',
      value: sales.sold_month,
      detail: goals
        ? `Meta ${goals.monthly_units_expected} · mín ${goals.monthly_units_min} · sobresaliente ${goals.monthly_units_high}`
        : 'este mes',
      to: '/history',
      progress: sales.goal_units_pct,
      warn: goals ? sales.sold_month < goals.monthly_units_min : false
    },
    {
      key: 'pendientes',
      label: 'Cotizaciones pendientes',
      value: sales.pending_count,
      detail: `${formatBs(sales.pending_bs)} por cerrar`,
      to: '/history',
      warn: sales.pending_stale > 0
    },
    {
      key: 'seguimientos',
      label: 'Seguimientos',
      value: seguimientos.hoy + seguimientos.vencidos,
      detail: seguimientos.vencidos > 0 ? `${seguimientos.vencidos} vencidos` : 'para hoy',
      to: '/crm',
      warn: seguimientos.vencidos > 0
    },
    {
      key: 'semana',
      label: 'Esta semana',
      value: sales.sold_week,
      detail: `${formatBs(sales.sold_week_bs)} · hoy ${sales.sold_today}`,
      to: '/history'
    },
    {
      key: 'nuevos',
      label: 'Clientes nuevos',
      value: funnel.nuevos_mes,
      detail: goals ? `Meta ${goals.monthly_new_customers} este mes` : 'este mes',
      to: '/crm'
    }
  ];

  const funnelRows = [
    { key: 'contactado', label: 'Contactados', value: funnel.contactado, color: FUNNEL_COLORS.contactado },
    { key: 'cotizado', label: 'Cotizados', value: funnel.cotizado, color: FUNNEL_COLORS.cotizado },
    { key: 'negociando', label: 'Negociando', value: funnel.negociando, color: FUNNEL_COLORS.negociando },
    { key: 'ganados', label: 'Ganados (mes)', value: funnel.ganados_mes, color: FUNNEL_COLORS.ganados }
  ];
  const funnelMax = Math.max(...funnelRows.map((r) => r.value), 1);
  const closedTotal = funnel.ganados_mes + funnel.perdidos_mes;
  const winRate = closedTotal > 0 ? Math.round((funnel.ganados_mes / closedTotal) * 100) : null;

  const alertRows = [
    alerts.seguimientos_vencidos > 0 && {
      key: 'vencidos',
      text: `${alerts.seguimientos_vencidos} ${alerts.seguimientos_vencidos === 1 ? 'seguimiento vencido' : 'seguimientos vencidos'}`,
      to: '/crm'
    },
    alerts.cotizaciones_sin_respuesta > 0 && {
      key: 'sin_respuesta',
      text: `${alerts.cotizaciones_sin_respuesta} ${alerts.cotizaciones_sin_respuesta === 1 ? 'cotización sin respuesta hace 3+ días' : 'cotizaciones sin respuesta hace 3+ días'}`,
      to: '/history'
    },
    alerts.sin_siguiente_paso > 0 && {
      key: 'sin_paso',
      text: `${alerts.sin_siguiente_paso} ${alerts.sin_siguiente_paso === 1 ? 'cliente abierto sin próximo seguimiento' : 'clientes abiertos sin próximo seguimiento'}`,
      to: '/crm'
    },
    alerts.sin_contacto_7d > 0 && {
      key: 'sin_contacto',
      text: `${alerts.sin_contacto_7d} ${alerts.sin_contacto_7d === 1 ? 'negociación sin contacto hace 7+ días' : 'negociaciones sin contacto hace 7+ días'}`,
      to: '/crm'
    }
  ].filter(Boolean);

  return (
    <div className="container dashboard-page home-page">
      <header className="home-hero">
        <div>
          <h2 className="home-title">Panel de Ventas</h2>
          <p className="home-subtitle">
            {scope === 'team' ? 'Todo el equipo comercial de un vistazo.' : 'Tu día comercial: primero los seguimientos, después el cierre.'}
          </p>
        </div>
        <div className="home-hero-side">
          <button type="button" className="btn btn-secondary vd-crm-btn" onClick={() => navigate('/crm')}>
            Clientes
          </button>
          <button type="button" className="btn btn-primary home-cta" onClick={() => navigate('/cotizar')}>
            + Nueva cotización
          </button>
        </div>
      </header>

      <div className="home-tiles vd-tiles">
        {tiles.map((tile) => (
          <button key={tile.key} type="button" className={`home-tile ${tile.warn ? 'is-warn' : ''}`} onClick={() => navigate(tile.to)}>
            <span className="home-tile-value">{tile.value}</span>
            <span className="home-tile-label">{tile.label}</span>
            <span className="home-tile-detail">{tile.detail}</span>
            {Number.isFinite(tile.progress) && (
              <span className="vd-tile-bar"><span style={{ width: `${Math.min(100, Math.max(0, tile.progress))}%` }} /></span>
            )}
          </button>
        ))}
      </div>

      <div className="home-grid">
        <section className="home-card">
          <div className="home-card-head">
            <div>
              <h3>Embudo comercial</h3>
              <p className="home-card-sub">
                {winRate !== null ? `Tasa de cierre del mes: ${winRate}% · ${funnel.perdidos_mes} perdidos` : 'Clientes por etapa'}
              </p>
            </div>
            <button type="button" className="dashboard-link" onClick={() => navigate('/crm')}>Ver embudo →</button>
          </div>
          <div className="home-stages">
            {funnelRows.map((row) => (
              <div key={row.key} className="home-stage-row">
                <span className="home-stage-label">{row.label}</span>
                <div className="home-stage-track">
                  <div className="home-stage-bar" style={{ width: `${Math.max(6, Math.round((row.value / funnelMax) * 100))}%`, background: row.color }} />
                </div>
                <span className="home-stage-count">{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="home-card">
          <div className="home-card-head">
            <div>
              <h3>Seguimientos próximos</h3>
              <p className="home-card-sub">Así nadie olvida hacer seguimiento</p>
            </div>
            <button type="button" className="dashboard-link" onClick={() => navigate('/crm')}>Ver Clientes →</button>
          </div>
          {seguimientos.proximos.length === 0 ? (
            <p className="dashboard-muted">Sin seguimientos agendados. Agenda el próximo paso de cada cliente abierto.</p>
          ) : (
            <ul className="vd-followups">
              {seguimientos.proximos.map((item) => {
                const overdue = item.follow_up_at < today;
                const isToday = item.follow_up_at === today;
                return (
                  <li key={item.id} className={overdue ? 'is-overdue' : ''}>
                    <span className="vd-followup-main">
                      <strong>{item.name}</strong>
                      <small>{item.follow_up_note || STAGE_LABELS[item.pipeline_stage] || ''}</small>
                    </span>
                    <span className={`vd-followup-date ${overdue ? 'is-overdue' : ''}`}>
                      {overdue ? `Venció ${shortDate(item.follow_up_at)}` : isToday ? 'Hoy' : shortDate(item.follow_up_at)}
                    </span>
                    {item.phone && (
                      <a
                        className="vd-followup-wa"
                        href={`https://wa.me/${String(item.phone).replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir WhatsApp"
                      >
                        WA
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {alertRows.length > 0 && (
          <section className="home-card vd-alerts">
            <div className="home-card-head">
              <div>
                <h3>⚠ Alertas</h3>
                <p className="home-card-sub">Cada seguimiento hoy es una venta mañana</p>
              </div>
            </div>
            <ul className="vd-alert-list">
              {alertRows.map((row) => (
                <li key={row.key}>
                  <button type="button" onClick={() => navigate(row.to)}>{row.text} ›</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {goals && (
          <section className="home-card">
            <div className="home-card-head">
              <div>
                <h3>Cumplimiento de metas</h3>
                <p className="home-card-sub">Del mes en curso</p>
              </div>
            </div>
            <div className="vd-goals">
              <div className="vd-goal-row">
                <span className="vd-goal-label">Ventas (Bs)</span>
                <div className="vd-goal-track"><div style={{ width: `${Math.min(100, sales.goal_bs_pct || 0)}%` }} /></div>
                <span className="vd-goal-value">{formatBs(sales.sold_month_bs)} / {formatBs(goals.monthly_target_bs)}</span>
              </div>
              <div className="vd-goal-row">
                <span className="vd-goal-label">Ventas cerradas</span>
                <div className="vd-goal-track"><div style={{ width: `${Math.min(100, sales.goal_units_pct || 0)}%` }} /></div>
                <span className="vd-goal-value">{sales.sold_month} / {goals.monthly_units_expected}</span>
              </div>
              <div className="vd-goal-row">
                <span className="vd-goal-label">Clientes nuevos</span>
                <div className="vd-goal-track">
                  <div style={{ width: `${Math.min(100, goals.monthly_new_customers > 0 ? Math.round((funnel.nuevos_mes / goals.monthly_new_customers) * 100) : 0)}%` }} />
                </div>
                <span className="vd-goal-value">{funnel.nuevos_mes} / {goals.monthly_new_customers}</span>
              </div>
              <p className="vd-goal-note">
                Mínima {goals.monthly_units_min} · Esperada {goals.monthly_units_expected} · Sobresaliente {goals.monthly_units_high} (bono)
              </p>
            </div>
          </section>
        )}

        {Array.isArray(perVendor) && perVendor.length > 0 && (
          <section className="home-card vd-vendors">
            <div className="home-card-head">
              <div>
                <h3>Rendimiento por vendedor</h3>
                <p className="home-card-sub">Mes en curso · cumplimiento vs meta de {goals?.monthly_units_expected ?? '—'} ventas</p>
              </div>
            </div>
            <div className="vd-vendor-table-wrap">
              <table className="vd-vendor-table">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Cotizaciones</th>
                    <th>Ventas</th>
                    <th>Ventas (Bs)</th>
                    <th>Conversión</th>
                    <th>Cumplimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {perVendor.map((row) => (
                    <tr key={row.vendor}>
                      <td className="vd-vendor-name">{row.vendor}</td>
                      <td>{row.quotes_month}</td>
                      <td>{row.sold_month}</td>
                      <td>{formatBs(row.sold_month_bs)}</td>
                      <td>{row.conversion_pct !== null ? `${row.conversion_pct}%` : '—'}</td>
                      <td>
                        <span className="vd-goal-track vd-vendor-track">
                          <span style={{ width: `${Math.min(100, row.goal_pct || 0)}%` }} />
                        </span>
                        <small>{row.goal_pct !== null ? `${row.goal_pct}%` : '—'}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
