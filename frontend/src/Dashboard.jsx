// Inicio: everything at a glance. One overview call feeds role-aware stat
// tiles (ventas de hoy, pedidos por preparar, alertas de stock, seguimientos,
// producción, mi plan) plus the working lists that matter right now.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { canAccessPanel } from './roleAccess';
import { NAV_ITEMS, allowsAny } from './navConfig';
import PerformanceDashboard from './PerformanceDashboard';
import { areaForRole, AREA_LABELS, boliviaToday, campaignIsActive, formatCampaignDate } from './campaignShared';

const formatBs = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')} Bs`;

export default function Dashboard({ token, user, role, access }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState([]);

  const greetingName = user?.display_name || (user?.email ? user.email.split('@')[0] : 'Bienvenido');
  const showPerformance = canAccessPanel(access, 'rendimientoGlobal') || canAccessPanel(access, 'rendimientoIndividual');

  const todayLabel = useMemo(() => {
    const formatted = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, []);

  const quickLinks = useMemo(() => (
    NAV_ITEMS
      .filter((item) => item.path !== '/' && item.path !== '/perfil' && !item.hidden)
      .filter((item) => allowsAny(access, item.navAccess || item.routeAccess))
      .map((item) => ({ to: item.path, label: item.label }))
  ), [access]);

  useEffect(() => {
    let active = true;
    const load = () => {
      apiRequest('/api/dashboard/overview', { token })
        .then((data) => { if (active) setOverview(data); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    const intervalId = setInterval(load, 60000);
    return () => { active = false; clearInterval(intervalId); };
  }, [token]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/campaigns', { token })
      .then((data) => { if (active) setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []); })
      .catch(() => {});
    return () => { active = false; };
  }, [token]);

  // The campaign banner: announced campaigns AND TikTok lives that haven't
  // ended yet, with the viewer's own pending responsibilities front and center.
  const campaignBanner = useMemo(() => {
    const today = boliviaToday();
    // Un live de HOY manda sobre una campaña en curso; después, lo más próximo.
    const urgency = (c) => (c.kind === 'live' && c.start_date === today ? 0 : 1);
    const announced = campaigns
      .filter((c) => c.status === 'anunciada' && String(c.end_date) >= today)
      .sort((a, b) => urgency(a) - urgency(b) || String(a.start_date).localeCompare(String(b.start_date)));
    if (announced.length === 0) return null;
    const campaign = announced[0];
    const myArea = areaForRole(role);
    const myTasks = myArea ? campaign.tasks.filter((t) => t.area === myArea) : [];
    const myPending = myTasks.filter((t) => !t.done).length;
    return {
      campaign,
      active: campaignIsActive(campaign, today),
      myArea,
      myPending,
      myTotal: myTasks.length
    };
  }, [campaigns, role]);

  const tiles = [];
  if (overview?.quotes_today) {
    tiles.push({
      key: 'quotes',
      label: overview.quotes_today.scope === 'team' ? 'Cotizaciones hoy (equipo)' : 'Mis cotizaciones hoy',
      value: overview.quotes_today.count,
      detail: formatBs(overview.quotes_today.total),
      to: '/history'
    });
  }
  if (overview?.pipeline) {
    tiles.push({
      key: 'prepare',
      label: 'Pedidos por preparar',
      value: overview.pipeline.pagado,
      detail: `${overview.pipeline.embalado} embalados · ${overview.pipeline.enviado_hoy} enviados hoy`,
      to: '/pedidos',
      warn: Number(overview.pipeline.pagado) > 0
    });
  }
  if (overview?.stock_alerts !== null && overview?.stock_alerts !== undefined) {
    tiles.push({
      key: 'stock',
      label: 'Alertas de stock',
      value: overview.stock_alerts,
      detail: 'productos bajo mínimo',
      to: '/inventory',
      warn: Number(overview.stock_alerts) > 0
    });
  }
  if (overview?.crm_due !== null && overview?.crm_due !== undefined) {
    tiles.push({
      key: 'crm',
      label: 'Seguimientos de clientes',
      value: overview.crm_due,
      detail: 'vencen hoy o antes',
      to: '/cotizar',
      warn: Number(overview.crm_due) > 0
    });
  }
  if (overview?.production) {
    tiles.push({
      key: 'prod',
      label: 'Producción activa',
      value: overview.production.active_cards,
      detail: `${overview.production.por_recibir} por recibir`,
      to: '/produccion-kanban',
      warn: Number(overview.production.por_recibir) > 0
    });
  }
  if (overview?.my_day) {
    tiles.push({
      key: 'plan',
      label: 'Mi plan de hoy',
      value: `${overview.my_day.done}/${overview.my_day.tasks}`,
      detail: overview.my_day.tasks === 0 ? '¡registra tus tareas!' : 'tareas hechas',
      to: '/calendario',
      warn: overview.my_day.tasks === 0
    });
  }

  return (
    <div className="container dashboard-page">
      <div className="dashboard-hero">
        <div>
          <p className="dashboard-eyebrow">{todayLabel}</p>
          <h2 className="dashboard-title">Hola, {greetingName}</h2>
          <p className="dashboard-subtitle">Todo el negocio de un vistazo.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/calendario')}>
          Plan del día
        </button>
      </div>

      {campaignBanner && (
        <button
          type="button"
          className={`campaign-banner ${campaignBanner.campaign.kind === 'live' ? 'is-live' : ''}`}
          onClick={() => navigate(campaignBanner.campaign.kind === 'live' ? '/live' : '/campanas')}
        >
          <span className="campaign-banner-icon">
            {campaignBanner.campaign.kind === 'live' ? '🔴' : '📣'}
          </span>
          <span className="campaign-banner-body">
            <span className="campaign-banner-title">
              {campaignBanner.campaign.kind === 'live'
                ? `Live TikTok${campaignBanner.campaign.start_date === boliviaToday() ? ' HOY' : ''}: ${campaignBanner.campaign.name}`
                : `${campaignBanner.active ? 'Campaña en curso' : 'Próxima campaña'}: ${campaignBanner.campaign.name}`}
            </span>
            <span className="campaign-banner-detail">
              {campaignBanner.campaign.kind === 'live'
                ? `${formatCampaignDate(campaignBanner.campaign.start_date)}${campaignBanner.campaign.live_time ? ` · ${campaignBanner.campaign.live_time}` : ''}`
                : `${formatCampaignDate(campaignBanner.campaign.start_date)} — ${formatCampaignDate(campaignBanner.campaign.end_date)}`}
              {campaignBanner.myTotal > 0 && (
                campaignBanner.myPending > 0
                  ? ` · ${AREA_LABELS[campaignBanner.myArea]}: ${campaignBanner.myPending} ${campaignBanner.myPending === 1 ? 'tarea pendiente' : 'tareas pendientes'}`
                  : ` · ${AREA_LABELS[campaignBanner.myArea]}: ¡todo listo! ✓`
              )}
            </span>
          </span>
          <span className="campaign-banner-cta">Ver responsabilidades →</span>
        </button>
      )}

      {loading ? (
        <p className="dashboard-muted">Cargando resumen…</p>
      ) : (
        <>
          {tiles.length > 0 && (
            <div className="glance-tiles">
              {tiles.map((tile) => (
                <button key={tile.key} type="button" className={`glance-tile ${tile.warn ? 'is-warn' : ''}`} onClick={() => navigate(tile.to)}>
                  <span className="glance-tile-value">{tile.value}</span>
                  <span className="glance-tile-label">{tile.label}</span>
                  <span className="glance-tile-detail">{tile.detail}</span>
                </button>
              ))}
            </div>
          )}

          <div className="glance-lists">
            {Array.isArray(overview?.to_prepare) && overview.to_prepare.length > 0 && (
              <section className="card dashboard-card">
                <div className="dashboard-card-head">
                  <h3>🔵 Pagados esperando preparación</h3>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/pedidos')}>Ir a Pedidos →</button>
                </div>
                <ul className="glance-list">
                  {overview.to_prepare.map((quote) => (
                    <li key={quote.id}>
                      <strong>#{quote.id} {quote.customer_name}</strong>
                      <span>{quote.store_location} · {formatBs(quote.total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {Array.isArray(overview?.crm_due_list) && overview.crm_due_list.length > 0 && (
              <section className="card dashboard-card">
                <div className="dashboard-card-head">
                  <h3>📞 Seguimientos para hoy</h3>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/cotizar')}>Abrir Clientes →</button>
                </div>
                <ul className="glance-list">
                  {overview.crm_due_list.map((customer) => (
                    <li key={customer.id}>
                      <strong>{customer.name}</strong>
                      <span>{customer.phone || 'sin teléfono'}{customer.note ? ` · ${customer.note}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="card dashboard-card">
              <div className="dashboard-card-head">
                <h3>🗓 Plan del equipo hoy</h3>
                <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>Ver tablero →</button>
              </div>
              {(!overview?.team_day || overview.team_day.length === 0) ? (
                <p className="dashboard-muted">Nadie registró su plan todavía. Empiecen en la reunión de la mañana.</p>
              ) : (
                <ul className="glance-list">
                  {overview.team_day.map((member) => (
                    <li key={member.user_id}>
                      <strong>{member.name}</strong>
                      <span>{member.done}/{member.tasks} tareas hechas</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <section className="card dashboard-card">
        <div className="dashboard-card-head">
          <h3>Acceso rápido</h3>
        </div>
        {quickLinks.length === 0 ? (
          <p className="dashboard-muted">No tienes paneles asignados todavía.</p>
        ) : (
          <div className="dashboard-quick-links is-sleek">
            {quickLinks.map((link) => (
              <button key={link.to} type="button" className="dashboard-quick-link" onClick={() => navigate(link.to)}>
                {link.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {showPerformance && (
        <section className="dashboard-performance">
          <h3 className="dashboard-section-title">Rendimiento</h3>
          <PerformanceDashboard token={token} user={user} role={role} access={access} />
        </section>
      )}
    </div>
  );
}
