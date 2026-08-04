// Inicio "Tu operación, hoy": un escritorio en calma. Tiles blancos con
// alerta roja cuando algo pide acción, prioridades del día con checkbox,
// carga de fábrica por etapa y los pendientes que importan ahora mismo.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { canAccessPanel } from './roleAccess';
import { allowsAny } from './navConfig';
import PerformanceDashboard from './PerformanceDashboard';
import VentasDashboard from './VentasDashboard';
import { useToast } from './ui/toastContext';
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

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const AVATAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1'];

const minuteLabel = (minute) => {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export default function Dashboard({ token, user, role, access, features }) {
  // Inicio por área: si el admin activó el Panel de Ventas, el equipo
  // comercial ve su tablero en lugar del Inicio genérico.
  if (features?.panel_ventas && areaForRole(role) === 'ventas') {
    return <VentasDashboard token={token} user={user} />;
  }
  return <GeneralDashboard token={token} user={user} role={role} access={access} />;
}

function GeneralDashboard({ token, user, role, access }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState([]);

  const showPerformance = canAccessPanel(access, 'rendimientoGlobal') || canAccessPanel(access, 'rendimientoIndividual');
  const canQuote = allowsAny(access, ['cotizar']);

  const dateChip = useMemo(() => {
    const now = new Date();
    return `${now.getDate()} ${MONTH_SHORT[now.getMonth()]}`;
  }, []);

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
      label: overview.quotes_today.scope === 'team' ? 'Cotizaciones · equipo' : 'Mis cotizaciones',
      value: overview.quotes_today.count,
      detail: overview.quotes_today.sold_count > 0
        ? `${formatBs(overview.quotes_today.total)} · ${overview.quotes_today.sold_count} cobradas`
        : `hoy · ${formatBs(overview.quotes_today.total)}`,
      trend: delta === 0
        ? { text: 'igual que ayer', dir: 'flat' }
        : { text: `${Math.abs(delta)} vs ayer`, dir: delta > 0 ? 'up' : 'down' },
      to: '/history'
    });
  }
  if (overview?.pipeline) {
    tiles.push({
      key: 'prepare',
      label: 'Por preparar',
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
      detail: sinStock > 0 ? `${sinStock} sin stock` : 'ninguno agotado',
      to: '/inventory',
      warn: Number(overview.stock_alerts) > 0
    });
  }
  if (overview?.crm_due !== null && overview?.crm_due !== undefined) {
    tiles.push({
      key: 'crm',
      label: 'Seguimientos',
      value: overview.crm_due,
      detail: 'vencen hoy o antes',
      to: '/cotizar',
      warn: Number(overview.crm_due) > 0
    });
  }
  if (overview?.production) {
    tiles.push({
      key: 'prod',
      label: 'En producción',
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

  const bottleneck = useMemo(() => {
    if (!stageRows) return null;
    const candidates = stageRows.rows.filter((r) => r.stage !== 'recepcion');
    if (candidates.length < 2) return null;
    return candidates.find((r) => r.count === stageRows.max) || null;
  }, [stageRows]);

  const myDay = overview?.my_day || null;

  // Checkbox directo en Inicio: marcar hecha sin abrir el Plan del día.
  const toggleMyTask = async (item) => {
    try {
      const data = await apiRequest(`/api/day-plan/${item.id}`, {
        method: 'PATCH',
        token,
        body: { is_done: !item.done }
      });
      const nowDone = Boolean(data?.task?.is_done);
      setOverview((prev) => {
        if (!prev?.my_day) return prev;
        const items = (prev.my_day.items || []).map((t) => (t.id === item.id ? { ...t, done: nowDone } : t));
        const done = prev.my_day.done + (nowDone ? 1 : -1);
        return { ...prev, my_day: { ...prev.my_day, done: Math.max(0, done), items } };
      });
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar la tarea');
    }
  };

  const teamDay = Array.isArray(overview?.team_day) ? overview.team_day : [];
  const teamTasks = teamDay.reduce((sum, m) => sum + Number(m.tasks || 0), 0);
  const teamDone = teamDay.reduce((sum, m) => sum + Number(m.done || 0), 0);

  return (
    <div className="container dashboard-page home-page">
      <header className="home-hero">
        <div>
          <h2 className="home-title">Tu operación, hoy</h2>
          <p className="home-subtitle">Lo importante primero; el detalle está a un clic.</p>
        </div>
        <div className="home-hero-side">
          <span className="home-date-chip">📅 {dateChip}</span>
          {canQuote ? (
            <button type="button" className="btn btn-primary home-cta" onClick={() => navigate('/cotizar')}>
              + Nueva cotización
            </button>
          ) : (
            <button type="button" className="btn btn-primary home-cta" onClick={() => navigate('/calendario')}>
              Abrir mi plan
            </button>
          )}
        </div>
      </header>

      {campaignBanner && allowsAny(access, ['campanas_live', 'admin']) && (
        <button
          type="button"
          className={`home-campaign ${campaignBanner.campaign.kind === 'live' ? 'is-live' : ''}`}
          onClick={() => navigate(campaignBanner.campaign.kind === 'live' ? '/live' : '/campanas')}
        >
          <span className="home-campaign-icon" aria-hidden="true">
            {campaignBanner.campaign.kind === 'live' ? '🔴' : '🎉'}
          </span>
          <span className="home-campaign-body">
            <strong>
              {campaignBanner.campaign.kind === 'live'
                ? `Live TikTok${campaignBanner.campaign.start_date === boliviaToday() ? ' HOY' : ''}: ${campaignBanner.campaign.name}`
                : `${campaignBanner.campaign.name} · ${formatCampaignDate(campaignBanner.campaign.kind === 'live' ? campaignBanner.campaign.start_date : campaignBanner.campaign.end_date)}`}
            </strong>
            <span>
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
          <span className="home-campaign-cta">Ver responsabilidades →</span>
        </button>
      )}

      {loading ? (
        <p className="dashboard-muted">Cargando resumen…</p>
      ) : (
        <>
          {tiles.length > 0 && (
            <div className="home-tiles">
              {tiles.map((tile) => (
                <button key={tile.key} type="button" className={`home-tile ${tile.warn ? 'is-warn' : ''}`} onClick={() => navigate(tile.to)}>
                  <span className="home-tile-value">{tile.value}</span>
                  <span className="home-tile-label">{tile.label}</span>
                  <span className="home-tile-detail">{tile.detail}</span>
                  {tile.trend && (
                    <span className={`glance-tile-trend is-${tile.trend.dir}`}>
                      {tile.trend.dir === 'up' ? '↑' : tile.trend.dir === 'down' ? '↓' : '='} {tile.trend.text}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="home-grid">
            {myDay && (
              <section className="home-card">
                <div className="home-card-head">
                  <div>
                    <h3>Prioridades de hoy</h3>
                    {myDay.tasks > 0 && (
                      <p className="home-card-sub">{myDay.done} de {myDay.tasks} {myDay.done === 1 ? 'completada' : 'completadas'}</p>
                    )}
                  </div>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>
                    {myDay.tasks === 0 ? 'Planificar mi día →' : 'Ver plan →'}
                  </button>
                </div>
                {myDay.tasks === 0 ? (
                  <p className="dashboard-muted">Sin tareas registradas todavía.</p>
                ) : (
                  <ul className="home-task-list">
                    {(myDay.items || []).map((item) => (
                      <li key={item.id} className={item.done ? 'is-done' : ''}>
                        <label className="home-task-main">
                          <input
                            type="checkbox"
                            checked={Boolean(item.done)}
                            onChange={() => toggleMyTask(item)}
                          />
                          <span className="home-task-title">{item.title}</span>
                        </label>
                        <span className="home-task-time">{minuteLabel(item.start_minute)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {stageRows && (
              <section className="home-card">
                <div className="home-card-head">
                  <div>
                    <h3>Producción</h3>
                    <p className="home-card-sub">Carga actual por etapa</p>
                  </div>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/produccion-kanban')}>Ver tablero →</button>
                </div>
                <div className="home-stages">
                  {stageRows.rows.map((row) => (
                    <div key={row.stage} className="home-stage-row">
                      <span className="home-stage-label">{row.label}</span>
                      <div className="home-stage-track">
                        <div
                          className={`home-stage-bar ${bottleneck && row.stage === bottleneck.stage ? 'is-bottleneck' : ''}`}
                          style={{ width: `${Math.max(8, Math.round((row.count / stageRows.max) * 100))}%` }}
                        />
                      </div>
                      <span className="home-stage-count">
                        {row.count}
                        {row.stuck > 0 && <em title="Lotes sin moverse hace más de 48 horas"> · {row.stuck} +48h</em>}
                      </span>
                    </div>
                  ))}
                </div>
                {bottleneck && (
                  <p className="home-stage-note">{bottleneck.label} concentra la mayor carga del día.</p>
                )}
              </section>
            )}

            {Array.isArray(overview?.to_prepare) && overview.to_prepare.length > 0 && (
              <section className="home-card">
                <div className="home-card-head">
                  <div>
                    <h3>Pedidos esperando preparación</h3>
                    <p className="home-card-sub">Pagados listos para armar</p>
                  </div>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/pedidos')}>Ir a Pedidos →</button>
                </div>
                <ul className="home-detail-list">
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
              <section className="home-card">
                <div className="home-card-head">
                  <div>
                    <h3>Seguimientos para hoy</h3>
                    <p className="home-card-sub">Clientes esperando una respuesta</p>
                  </div>
                  <button type="button" className="dashboard-link" onClick={() => navigate('/cotizar')}>Abrir Clientes →</button>
                </div>
                <ul className="home-detail-list">
                  {overview.crm_due_list.map((customer) => (
                    <li key={customer.id}>
                      <strong>{customer.name}</strong>
                      <span>{customer.phone || 'sin teléfono'}{customer.note ? ` · ${customer.note}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="home-card">
              <div className="home-card-head">
                <div>
                  <h3>Equipo</h3>
                  <p className="home-card-sub">Plan de hoy</p>
                </div>
                <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>Ver equipo →</button>
              </div>
              {teamDay.length === 0 ? (
                <p className="dashboard-muted">Nadie registró su plan todavía.</p>
              ) : (
                <>
                  <div className="home-team-row">
                    <span className="home-team-avatars">
                      {teamDay.slice(0, 5).map((member, index) => (
                        <span
                          key={member.user_id}
                          className="home-team-avatar"
                          style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                          title={member.name}
                        >
                          {String(member.name || '?').trim().charAt(0).toUpperCase()}
                        </span>
                      ))}
                    </span>
                    <span className="home-team-summary">
                      {teamDay.length} {teamDay.length === 1 ? 'persona' : 'personas'} · {teamDone}/{teamTasks} tareas hechas
                    </span>
                  </div>
                  <ul className="home-detail-list compact">
                    {teamDay.map((member) => (
                      <li key={member.user_id}>
                        <strong>{member.name}</strong>
                        <span>{member.done}/{member.tasks} hechas</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}

      {showPerformance && (
        <section className="dashboard-performance home-performance">
          <h3 className="dashboard-section-title">Rendimiento</h3>
          <PerformanceDashboard token={token} user={user} role={role} access={access} />
        </section>
      )}
    </div>
  );
}
