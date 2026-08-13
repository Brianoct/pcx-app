// Panel de Marketing: el Inicio del área de marketing (activable desde
// Admin → Paneles, igual que el Panel de Ventas). Ventas por destino como en
// Estadísticas, vistazo del calendario, resumen de Campañas/Lives/Promos y el
// mismo CRM que usa Ventas (embudo + seguimientos).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import BoliviaSalesMap from './BoliviaSalesMap';

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

const AGENDA_TYPE_META = {
  campana: { label: 'Campaña', color: '#7c3aed' },
  live: { label: 'Live', color: '#dc2626' },
  evento: { label: 'Evento', color: '#0e7490' }
};

export default function MarketingDashboard({ token }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      apiRequest('/api/marketing/dashboard', { token })
        .then((res) => { if (active) { setData(res); setError(null); } })
        .catch((err) => { if (active) setError(err.message || 'No se pudo cargar el panel'); });
    };
    load();
    const intervalId = setInterval(load, 60000);
    return () => { active = false; clearInterval(intervalId); };
  }, [token]);

  if (error) return <div className="container home-page"><p className="dashboard-muted">{error}</p></div>;
  if (!data) return <div className="container home-page"><p className="dashboard-muted">Cargando panel de marketing…</p></div>;

  const { geo, agenda, campaigns, promos, funnel, seguimientos } = data;
  const today = todayText();

  const tiles = [
    {
      key: 'campanas',
      icon: '📣',
      label: 'Campañas activas',
      value: campaigns.activas,
      detail: `${campaigns.borradores} en borrador · ${campaigns.finalizadas_mes} finalizadas este mes`,
      to: '/campanas'
    },
    {
      key: 'live',
      icon: '🎥',
      label: 'Próximo Live',
      value: campaigns.proximo_live ? shortDate(campaigns.proximo_live.start_date) : '—',
      detail: campaigns.proximo_live
        ? `${campaigns.proximo_live.name}${campaigns.proximo_live.live_time ? ` · ${campaigns.proximo_live.live_time}` : ''}`
        : 'Sin live agendado',
      to: '/live'
    },
    {
      key: 'promos',
      icon: '🎟️',
      label: 'Cupones canjeados · mes',
      value: promos.cupones_canjeados_mes,
      detail: `${promos.cupones_emitidos_mes} emitidos · ${promos.herramientas_activas} promos activas`,
      to: '/promos'
    },
    {
      key: 'inversion',
      icon: '💸',
      label: 'Inversión del mes',
      value: formatBs(campaigns.inversion_mes_bs),
      detail: 'Costos de campañas registrados',
      to: '/marketing-inversion'
    },
    {
      key: 'seguimientos',
      icon: '📞',
      label: 'Seguimientos CRM',
      value: seguimientos.hoy + seguimientos.vencidos,
      detail: seguimientos.vencidos > 0 ? `${seguimientos.vencidos} vencidos` : 'para hoy',
      to: '/crm',
      warn: seguimientos.vencidos > 0
    },
    {
      key: 'nuevos',
      icon: '👥',
      label: 'Clientes nuevos · mes',
      value: funnel.nuevos_mes,
      detail: `${funnel.ganados_mes} ganados · ${funnel.perdidos_mes} perdidos`,
      to: '/crm'
    }
  ];

  const funnelRows = [
    { key: 'contactado', label: 'Contactados', value: funnel.contactado, color: FUNNEL_COLORS.contactado },
    { key: 'cotizado', label: 'Cotizados', value: funnel.cotizado, color: FUNNEL_COLORS.cotizado },
    { key: 'negociando', label: 'Negociando', value: funnel.negociando, color: FUNNEL_COLORS.negociando },
    { key: 'ganados', label: 'Ganados (mes)', value: funnel.ganados_mes, color: FUNNEL_COLORS.ganados }
  ];
  const funnelMax = Math.max(...funnelRows.map((row) => row.value), 1);
  const closedTotal = funnel.ganados_mes + funnel.perdidos_mes;
  const winRate = closedTotal > 0 ? Math.round((funnel.ganados_mes / closedTotal) * 100) : null;

  return (
    <div className="container dashboard-page home-page">
      <header className="home-hero">
        <div>
          <h2 className="home-title">Panel de Marketing</h2>
        </div>
        <div className="home-hero-side">
          <button type="button" className="btn btn-secondary vd-crm-btn" onClick={() => navigate('/crm')}>
            Clientes
          </button>
          <button type="button" className="btn btn-primary home-cta" onClick={() => navigate('/marketing-calendario')}>
            Ver calendario
          </button>
        </div>
      </header>

      <div className="home-tiles vd-tiles">
        {tiles.map((tile) => (
          <button key={tile.key} type="button" className={`home-tile ${tile.warn ? 'is-warn' : ''}`} onClick={() => navigate(tile.to)}>
            <span className="vd-tile-top">
              <span className="vd-tile-icon" aria-hidden="true">{tile.icon}</span>
            </span>
            <span className="home-tile-value">{tile.value}</span>
            <span className="home-tile-label">{tile.label}</span>
            <span className="home-tile-detail">{tile.detail}</span>
          </button>
        ))}
      </div>

      <div className="home-grid">
        <section className="home-card">
          <div className="home-card-head">
            <div>
              <h3>Agenda · próximos 14 días</h3>
              <p className="home-card-sub">Campañas, lives y eventos del área</p>
            </div>
            <button type="button" className="dashboard-link" onClick={() => navigate('/marketing-calendario')}>Ver calendario →</button>
          </div>
          {agenda.length === 0 ? (
            <p className="dashboard-muted">Nada agendado en las próximas dos semanas. Planifica la siguiente campaña en el calendario.</p>
          ) : (
            <ul className="mkd-agenda">
              {agenda.map((item) => {
                const meta = AGENDA_TYPE_META[item.type] || AGENDA_TYPE_META.evento;
                const started = item.date <= today;
                return (
                  <li key={`${item.type}-${item.id}`}>
                    <span className="mkd-agenda-chip" style={{ background: meta.color }}>{meta.label}</span>
                    <span className="mkd-agenda-main">
                      <strong>{item.title}</strong>
                      {item.end_date && item.end_date !== item.date && (
                        <small>{shortDate(item.date)} – {shortDate(item.end_date)}</small>
                      )}
                    </span>
                    <span className="mkd-agenda-date">
                      {started && item.end_date && item.end_date >= today
                        ? 'En curso'
                        : item.date === today
                          ? `Hoy${item.time ? ` · ${item.time}` : ''}`
                          : `${shortDate(item.date)}${item.time ? ` · ${item.time}` : ''}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="home-card">
          <div className="home-card-head">
            <div>
              <h3>Campañas · Lives · Promos</h3>
              <p className="home-card-sub">Resumen del área</p>
            </div>
          </div>
          <ul className="mkd-summary">
            <li>
              <button type="button" onClick={() => navigate('/campanas')}>
                <span>📣 Campañas activas</span>
                <strong>{campaigns.activas}</strong>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => navigate('/live')}>
                <span>🎥 Lives anunciados</span>
                <strong>{campaigns.lives_pendientes}</strong>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => navigate('/promos')}>
                <span>🎁 Promos activas</span>
                <strong>{promos.herramientas_activas}</strong>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => navigate('/promos')}>
                <span>🎟️ Cupones emitidos / canjeados (mes)</span>
                <strong>{promos.cupones_emitidos_mes} / {promos.cupones_canjeados_mes}</strong>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => navigate('/marketing-inversion')}>
                <span>💸 Inversión registrada (mes)</span>
                <strong>{formatBs(campaigns.inversion_mes_bs)}</strong>
              </button>
            </li>
          </ul>
        </section>

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
              <p className="home-card-sub">El CRM completo, igual que Ventas</p>
            </div>
            <button type="button" className="dashboard-link" onClick={() => navigate('/crm')}>Ver Clientes →</button>
          </div>
          {seguimientos.proximos.length === 0 ? (
            <p className="dashboard-muted">Sin seguimientos agendados.</p>
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

        <div className="mkd-map-span">
          <BoliviaSalesMap
            salesByDepartment={geo.salesByDepartment}
            topLocations={geo.topLocations}
            title="Ventas del mes · Departamento → Ciudad"
          />
        </div>
      </div>
    </div>
  );
}
