// Inicio: everything at a glance. One overview call feeds role-aware stat
// tiles (ventas de hoy, pedidos por preparar, alertas de stock, seguimientos,
// producción, mi plan) plus the working lists that matter right now.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { canAccessPanel } from './roleAccess';
import { allowsAny } from './navConfig';
import PerformanceDashboard from './PerformanceDashboard';
import { areaForRole, AREA_LABELS, boliviaToday, campaignIsActive, formatCampaignDate } from './campaignShared';

const formatBs = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')} Bs`;

const STAGE_LABELS = {
  impresion_3d: 'Impresión 3D',
  corte_laser: 'Corte láser',
  punzonado: 'Punzonado',
  plegado: 'Plegado',
  soldado: 'Soldado',
  lavado: 'Lavado',
  pintado: 'Pintado',
  embalado: 'Embalado',
  recepcion: 'Recepción'
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);

const minuteLabel = (minute) => {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

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

  const canQuote = allowsAny(access, ['cotizar']);

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
    const delta = overview.quotes_today.count - (overview.quotes_today.yesterday_count || 0);
    tiles.push({
      key: 'quotes',
      label: overview.quotes_today.scope === 'team' ? 'Cotizaciones hoy (equipo)' : 'Mis cotizaciones hoy',
      value: overview.quotes_today.count,
      detail: overview.quotes_today.sold_count > 0
        ? `${formatBs(overview.quotes_today.total)} · ${overview.quotes_today.sold_count} cobradas (${formatBs(overview.quotes_today.sold_total)})`
        : formatBs(overview.quotes_today.total),
      trend: delta === 0
        ? { text: 'igual que ayer', dir: 'flat' }
        : { text: `${Math.abs(delta)} vs ayer`, dir: delta > 0 ? 'up' : 'down' },
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
    const sinStock = Number(overview.stock_sin_stock || 0);
    tiles.push({
      key: 'stock',
      label: 'Bajo mínimo',
      value: overview.stock_alerts,
      detail: sinStock > 0 ? `${sinStock} sin stock en alguna sede` : 'ninguno agotado',
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
  // El timeline de producción: etapas en orden de ruta, con el cuello de
  // botella (la etapa con más lotes) resaltado.
  const stageRows = useMemo(() => {
    if (!Array.isArray(overview?.production_stages)) return null;
    const byStage = Object.fromEntries(overview.production_stages.map((s) => [s.stage, s]));
    const rows = STAGE_ORDER
      .map((stage) => ({ stage, label: STAGE_LABELS[stage], count: byStage[stage]?.count || 0, stuck: byStage[stage]?.stuck || 0 }))
      .filter((row) => row.count > 0);
    const max = Math.max(...rows.map((r) => r.count), 0);
    return rows.length > 0 ? { rows, max } : null;
  }, [overview]);

  const myDay = overview?.my_day || null;
  const planPct = myDay && myDay.tasks > 0 ? Math.round((myDay.done / myDay.tasks) * 100) : 0;
  const stuckLots = stageRows?.rows.reduce((sum, row) => sum + Number(row.stuck || 0), 0) || 0;
  const attentionItems = [];

  if (Number(overview?.stock_alerts || 0) > 0) {
    const outOfStock = Number(overview?.stock_sin_stock || 0);
    attentionItems.push({
      key: 'stock',
      title: `${overview.stock_alerts} productos bajo mínimo`,
      detail: outOfStock > 0 ? `${outOfStock} sin stock en alguna sede` : 'Revisar reposición',
      to: '/inventory',
      urgent: outOfStock > 0
    });
  }
  if (stuckLots > 0) {
    attentionItems.push({
      key: 'stuck',
      title: `${stuckLots} ${stuckLots === 1 ? 'lote detenido' : 'lotes detenidos'}`,
      detail: 'Más de 48 horas sin movimiento',
      to: '/produccion-kanban',
      urgent: true
    });
  }
  if (Number(overview?.crm_due || 0) > 0) {
    attentionItems.push({
      key: 'crm',
      title: `${overview.crm_due} seguimientos vencen hoy`,
      detail: 'Clientes esperando una respuesta',
      to: '/cotizar'
    });
  }
  if (Number(overview?.pipeline?.pagado || 0) > 0) {
    attentionItems.push({
      key: 'prepare',
      title: `${overview.pipeline.pagado} pedidos por preparar`,
      detail: `${overview.pipeline.embalado || 0} ya están embalados`,
      to: '/pedidos'
    });
  }

  return (
    <div className="container dashboard-page focus-dashboard">
      <header className="focus-hero">
        <div>
          <p className="dashboard-eyebrow">{todayLabel}</p>
          <h2 className="dashboard-title">Buenos días, {greetingName}</h2>
          <p className="dashboard-subtitle">Primero lo importante; el resto queda a un clic.</p>
        </div>
        {canQuote ? (
          <button type="button" className="btn btn-primary focus-primary-action" onClick={() => navigate('/cotizar')}>
            + Nueva cotización
          </button>
        ) : (
          <button type="button" className="btn btn-primary focus-primary-action" onClick={() => navigate('/calendario')}>
            Abrir mi plan
          </button>
        )}
      </header>

      {loading ? (
        <p className="dashboard-muted">Cargando resumen…</p>
      ) : (
        <>
          {tiles.length > 0 && (
            <section className="focus-summary" aria-label="Resumen del negocio">
              {tiles.map((tile) => (
                <button key={tile.key} type="button" className="focus-summary-item" onClick={() => navigate(tile.to)}>
                  <span className="focus-summary-label">{tile.label}</span>
                  <span className="focus-summary-value">{tile.value}</span>
                  <span className="focus-summary-detail">{tile.detail}</span>
                  {tile.trend && (
                    <span className={`glance-tile-trend is-${tile.trend.dir}`}>
                      {tile.trend.dir === 'up' ? '↑' : tile.trend.dir === 'down' ? '↓' : '='} {tile.trend.text}
                    </span>
                  )}
                </button>
              ))}
            </section>
          )}

          <div className="focus-columns">
            <div className="focus-main-column">
              <section className="focus-section">
                <div className="dashboard-card-head">
                  <h3>Lo que requiere una decisión</h3>
                </div>
                {attentionItems.length === 0 ? (
                  <p className="focus-clear-state">Todo está al día. No hay alertas operativas pendientes.</p>
                ) : (
                  <div className="focus-attention-list">
                    {attentionItems.map((item) => (
                      <button key={item.key} type="button" className={`focus-attention-row ${item.urgent ? 'is-urgent' : ''}`} onClick={() => navigate(item.to)}>
                        <span className="focus-attention-dot" aria-hidden="true" />
                        <span className="focus-attention-copy">
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <span className="focus-row-arrow" aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {myDay && (
                <section className={`focus-section focus-myday ${myDay.tasks === 0 ? 'is-empty' : ''}`}>
                  <div className="dashboard-card-head">
                    <h3>Mi día · {myDay.done}/{myDay.tasks}</h3>
                    <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>
                      {myDay.tasks === 0 ? 'Planificar mi día →' : 'Abrir plan →'}
                    </button>
                  </div>
                  {myDay.tasks === 0 ? (
                    <p className="dashboard-muted">Sin tareas registradas todavía.</p>
                  ) : (
                    <>
                      <div className="dash-myplan-progress">
                        <div className="dash-myplan-bar"><div className="dash-myplan-fill" style={{ width: `${planPct}%` }} /></div>
                        <strong>{planPct}%</strong>
                      </div>
                      <ul className="focus-task-list">
                        {(myDay.items || []).map((item) => (
                          <li key={item.id} className={item.done ? 'is-done' : ''}>
                            <span className="dash-myplan-time">{minuteLabel(item.start_minute)}</span>
                            <span className="focus-task-check" aria-hidden="true">{item.done ? '✓' : ''}</span>
                            <span className="dash-myplan-title">{item.title}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}

              {(Array.isArray(overview?.to_prepare) && overview.to_prepare.length > 0) && (
                <section className="focus-section">
                  <div className="dashboard-card-head">
                    <h3>Pagados esperando preparación</h3>
                    <button type="button" className="dashboard-link" onClick={() => navigate('/pedidos')}>Ir a Pedidos →</button>
                  </div>
                  <ul className="focus-detail-list">
                    {overview.to_prepare.map((quote) => (
                      <li key={quote.id}><strong>#{quote.id} {quote.customer_name}</strong><span>{quote.store_location} · {formatBs(quote.total)}</span></li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <aside className="focus-side-column">
              {stageRows && (
                <section className="focus-factory-card">
                  <div className="dashboard-card-head">
                    <h3>Fábrica ahora</h3>
                    <button type="button" className="dashboard-link" onClick={() => navigate('/produccion-kanban')}>Ver Kanban →</button>
                  </div>
                  <div className="dash-stages">
                    {stageRows.rows.map((row) => (
                      <div key={row.stage} className="dash-stage-row">
                        <span className="dash-stage-label">{row.label}</span>
                        <div className="dash-stage-track">
                          <div className={`dash-stage-bar ${row.count === stageRows.max && row.stage !== 'recepcion' ? 'is-bottleneck' : ''}`} style={{ width: `${Math.max(8, Math.round((row.count / stageRows.max) * 100))}%` }} />
                        </div>
                        <span className="dash-stage-count">{row.count}{row.stuck > 0 && <em title="Lotes sin moverse hace más de 48 horas"> · {row.stuck} +48h</em>}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {campaignBanner && allowsAny(access, ['campanas_live', 'admin']) && (
                <button type="button" className={`focus-campaign ${campaignBanner.campaign.kind === 'live' ? 'is-live' : ''}`} onClick={() => navigate(campaignBanner.campaign.kind === 'live' ? '/live' : '/campanas')}>
                  <span className="focus-campaign-label">{campaignBanner.campaign.kind === 'live' ? 'Live' : campaignBanner.active ? 'En curso' : 'Próxima'}</span>
                  <strong>{campaignBanner.campaign.name}</strong>
                  <span>{campaignBanner.campaign.kind === 'live'
                    ? `${formatCampaignDate(campaignBanner.campaign.start_date)}${campaignBanner.campaign.live_time ? ` · ${campaignBanner.campaign.live_time}` : ''}`
                    : `${formatCampaignDate(campaignBanner.campaign.start_date)} — ${formatCampaignDate(campaignBanner.campaign.end_date)}`}</span>
                  {campaignBanner.myTotal > 0 && <small>{campaignBanner.myPending > 0 ? `${AREA_LABELS[campaignBanner.myArea]}: ${campaignBanner.myPending} pendientes` : `${AREA_LABELS[campaignBanner.myArea]}: todo listo ✓`}</small>}
                </button>
              )}

              <section className="focus-team-card">
                <div className="dashboard-card-head">
                  <h3>Plan del equipo</h3>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>Ver →</button>
                </div>
                {(!overview?.team_day || overview.team_day.length === 0) ? (
                  <p className="dashboard-muted">Nadie registró su plan todavía.</p>
                ) : (
                  <ul className="focus-detail-list compact">
                    {overview.team_day.map((member) => (
                      <li key={member.user_id}><strong>{member.name}</strong><span>{member.done}/{member.tasks} hechas</span></li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      {showPerformance && (
        <section className="dashboard-performance focus-performance">
          <h3 className="dashboard-section-title">Rendimiento</h3>
          <PerformanceDashboard token={token} user={user} role={role} access={access} />
        </section>
      )}
    </div>
  );
}
