import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { canAccessPanel } from './roleAccess';
import { NAV_ITEMS, allowsAny } from './navConfig';
import PerformanceDashboard from './PerformanceDashboard';
import {
  DEFAULT_TYPE_MAP,
  STATUS_LABELS,
  buildTypeMap,
  formatDateShort,
  toDateText
} from './calendarShared';

const QUICK_LINK_HINTS = {
  '/cotizar': 'Genera cotizaciones para clientes',
  '/history': 'Revisa cotizaciones registradas',
  '/pedidos': 'Gestiona pedidos del almacén',
  '/inventory': 'Controla el inventario',
  '/gastos': 'Registra y revisa gastos',
  '/produccion-kanban': 'Tablero de producción',
  '/proyectos': 'Proyectos y tareas',
  '/combos': 'Combos de marketing',
  '/cupones': 'Cupones de descuento',
  '/calendario': 'Calendario centralizado del equipo',
  '/admin': 'Configuración y administración',
  '/dashboard': 'Estadísticas globales'
};

export default function Dashboard({ token, user, role, access }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [typeList, setTypeList] = useState(null);
  const [loading, setLoading] = useState(true);

  const greetingName = user?.display_name || (user?.email ? user.email.split('@')[0] : 'Bienvenido');
  const showPerformance = canAccessPanel(access, 'rendimientoGlobal') || canAccessPanel(access, 'rendimientoIndividual');

  const quickLinks = useMemo(() => {
    return NAV_ITEMS
      .filter((item) => item.path !== '/' && item.path !== '/perfil')
      .filter((item) => allowsAny(access, item.navAccess || item.routeAccess))
      .map((item) => ({ to: item.path, label: item.label, hint: QUICK_LINK_HINTS[item.path] || '' }));
  }, [access]);

  const typeMap = useMemo(() => (typeList ? buildTypeMap(typeList) : DEFAULT_TYPE_MAP), [typeList]);

  useEffect(() => {
    let active = true;
    const today = new Date();
    const start = toDateText(today);
    const end = toDateText(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 28));
    const load = async () => {
      setLoading(true);
      try {
        const [eventsData, summaryData, typesData] = await Promise.all([
          apiRequest(`/api/calendar/events?start=${start}&end=${end}`, { token }).catch(() => []),
          apiRequest(`/api/calendar/summary?year=${today.getFullYear()}`, { token }).catch(() => null),
          apiRequest('/api/calendar/types', { token }).catch(() => null)
        ]);
        if (!active) return;
        const upcoming = (Array.isArray(eventsData) ? eventsData : [])
          .filter((ev) => String(ev.end_date || ev.start_date).slice(0, 10) >= start)
          .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
          .slice(0, 6);
        setEvents(upcoming);
        setSummary(summaryData);
        if (Array.isArray(typesData) && typesData.length) setTypeList(typesData);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [token]);

  return (
    <div className="container dashboard-page">
      <div className="dashboard-hero">
        <div>
          <p className="dashboard-eyebrow">Centro de mando</p>
          <h2 className="dashboard-title">Hola, {greetingName}</h2>
          <p className="dashboard-subtitle">Tu resumen del día y acceso rápido a las herramientas de PCX.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/calendario')}>
          Abrir calendario
        </button>
      </div>

      <div className="dashboard-grid">
        <section className="card dashboard-card dashboard-calendar">
          <div className="dashboard-card-head">
            <h3>Próximos eventos</h3>
            <button type="button" className="dashboard-link" onClick={() => navigate('/calendario')}>Ver calendario →</button>
          </div>
          {loading ? (
            <p className="dashboard-muted">Cargando…</p>
          ) : events.length === 0 ? (
            <p className="dashboard-muted">No hay eventos próximos. Crea uno desde el calendario.</p>
          ) : (
            <ul className="dashboard-event-list">
              {events.map((ev) => (
                <li key={ev.id} className="dashboard-event">
                  <span className="cal-dot" style={{ background: ev.color || typeMap[ev.event_type]?.color || '#78716c' }} />
                  <div className="dashboard-event-body">
                    <strong>{ev.title}</strong>
                    <span className="dashboard-muted">
                      {formatDateShort(ev.start_date)}
                      {String(ev.end_date).slice(0, 10) !== String(ev.start_date).slice(0, 10) ? ` → ${formatDateShort(ev.end_date)}` : ''}
                      {ev.owner_name ? ` · ${ev.owner_name}` : ''}
                      {ev.status && ev.status !== 'confirmed' ? ` · ${STATUS_LABELS[ev.status] || ev.status}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {summary && (
            <div className="dashboard-quota">
              <span>Vacaciones: <strong>{summary.vacation_remaining}/14</strong></span>
              <span>Enfermedad: <strong>{summary.sick_remaining}/5</strong></span>
            </div>
          )}
        </section>

        <section className="card dashboard-card">
          <div className="dashboard-card-head">
            <h3>Acceso rápido</h3>
          </div>
          {quickLinks.length === 0 ? (
            <p className="dashboard-muted">No tienes paneles asignados todavía.</p>
          ) : (
            <div className="dashboard-quick-links">
              {quickLinks.map((link) => (
                <button key={link.to} type="button" className="dashboard-quick-link" onClick={() => navigate(link.to)}>
                  <strong>{link.label}</strong>
                  {link.hint && <small>{link.hint}</small>}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {showPerformance && (
        <section className="dashboard-performance">
          <h3 className="dashboard-section-title">Rendimiento</h3>
          <PerformanceDashboard token={token} user={user} role={role} access={access} />
        </section>
      )}
    </div>
  );
}
