import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';
import QualityControlRecordsAdmin from './admin/QualityControlRecordsAdmin';

// Mejoras: el registro de todo lo que el equipo mejoró. La filosofía PCX:
// lo rutinario se estandariza y se automata; el día a día es mejorar.
// Cada mejora nace como bloque "💡 Mejora" en el Plan del día y entra aquí
// sola al marcarse hecha. Esta pestaña la muestra por mes, por área del
// negocio y por persona, y deja documentar qué cambió.

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const AREA_ICONS = {
  ventas: '📈',
  almacen: '📦',
  produccion: '🔧',
  marketing: '🎬',
  admin: '🗂️',
  general: '✦'
};

const pad2 = (n) => String(n).padStart(2, '0');
const minuteLabel = (minute) => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;

const dateLabel = (isoDate) => {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const text = new Intl.DateTimeFormat('es-BO', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export default function MejorasPanel({ token, user }) {
  const navigate = useNavigate();
  const toast = useToast();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [areaFilter, setAreaFilter] = useState(null);
  const [userFilter, setUserFilter] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftDetail, setDraftDetail] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [qcRecords, setQcRecords] = useState(null); // null = sin acceso

  const myId = Number(user?.id);
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await apiRequest(`/api/mejoras?month=${month}&year=${year}`, { token });
      setData(result);
    } catch (err) {
      if (!silent) toast.error(err.message || 'No se pudo cargar el registro de mejoras');
    } finally {
      if (!silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month, year]);

  useEffect(() => { load(); }, [load]);

  // Los registros de control de calidad siguen viviendo aquí (colapsados)
  // para quien tenga ese permiso.
  useEffect(() => {
    let active = true;
    apiRequest(`/api/qc/checks?month=${now.getMonth() + 1}&year=${now.getFullYear()}`, { token })
      .then((rows) => { if (active) setQcRecords(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) setQcRecords(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const shiftMonth = (delta) => {
    const next = new Date(year, month - 1 + delta, 1);
    setMonth(next.getMonth() + 1);
    setYear(next.getFullYear());
    setAreaFilter(null);
    setUserFilter(null);
  };

  const items = useMemo(() => {
    const all = Array.isArray(data?.items) ? data.items : [];
    return all.filter((item) => (!areaFilter || item.area === areaFilter) && (!userFilter || item.user_id === userFilter));
  }, [data, areaFilter, userFilter]);

  // Agrupadas por día para leer el registro como una bitácora.
  const groupedByDate = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.task_date)) map.set(item.task_date, []);
      map.get(item.task_date).push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  const byArea = Array.isArray(data?.by_area) ? data.by_area : [];
  const byUser = Array.isArray(data?.by_user) ? data.by_user : [];
  const inProgress = Array.isArray(data?.in_progress_today) ? data.in_progress_today : [];
  const totals = data?.totals || {};
  const maxArea = Math.max(1, ...byArea.map((a) => a.count));
  const maxUser = Math.max(1, ...byUser.map((u) => u.month_count));
  const monthCount = Number(totals.month_count || 0);
  const prevCount = Number(totals.previous_month_count || 0);
  const delta = monthCount - prevCount;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const filterName = userFilter ? byUser.find((u) => u.user_id === userFilter)?.name : null;
  const filterArea = areaFilter ? byArea.find((a) => a.area === areaFilter)?.label : null;

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraftDetail(item.detail || '');
  };

  const saveDetail = async (item) => {
    setSavingId(item.id);
    try {
      const result = await apiRequest(`/api/mejoras/${item.id}`, { method: 'PATCH', token, body: { detail: draftDetail } });
      setData((prev) => prev ? { ...prev, items: prev.items.map((m) => (m.id === item.id ? result.mejora : m)) } : prev);
      setEditingId(null);
      toast.success('Mejora documentada');
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSavingId(null);
    }
  };

  const changeArea = async (item, area) => {
    try {
      const result = await apiRequest(`/api/mejoras/${item.id}`, { method: 'PATCH', token, body: { area } });
      setData((prev) => prev ? { ...prev, items: prev.items.map((m) => (m.id === item.id ? result.mejora : m)) } : prev);
      load(true);
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar el área');
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`¿Quitar "${item.title}" del registro de mejoras?`)) return;
    try {
      await apiRequest(`/api/mejoras/${item.id}`, { method: 'DELETE', token });
      toast.success('Registro eliminado');
      load(true);
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  return (
    <div className="container mejoras-page">
      <div className="mejoras-head">
        <div>
          <p className="mejoras-tagline">Lo rutinario se estandariza y se automatiza. El día a día es <strong>mejorar</strong>.</p>
          <p className="mejoras-how">
            Cada mejora nace como bloque <span className="mejoras-chip-mini">💡 Mejora</span> en el Plan del día y
            se registra aquí sola al marcarse hecha. Una por persona, cada día.
          </p>
        </div>
        <div className="mejoras-nav">
          <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
          <span className="mejoras-month">{monthLabel}</span>
          <button type="button" className="btn btn-secondary" onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label="Mes siguiente">›</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/calendario')}>+ Planificar mi mejora</button>
        </div>
      </div>

      {loading && !data ? (
        <p className="dashboard-muted">Cargando registro…</p>
      ) : (
        <>
          <div className="mejoras-tiles">
            <div className="mejoras-tile">
              <span className="mejoras-tile-value">{monthCount}</span>
              <span className="mejoras-tile-label">mejoras en {MONTH_NAMES[month - 1]}</span>
              <span className={`mejoras-tile-trend ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>
                {delta === 0 ? 'igual que el mes anterior' : `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} vs mes anterior (${prevCount})`}
              </span>
            </div>
            <div className="mejoras-tile">
              <span className="mejoras-tile-value">{Number(totals.people || 0)}</span>
              <span className="mejoras-tile-label">personas que mejoraron algo</span>
              <span className="mejoras-tile-trend">de {byUser.length} en el equipo</span>
            </div>
            {isCurrentMonth && (
              <div className={`mejoras-tile ${inProgress.length > 0 ? 'is-live' : ''}`}>
                <span className="mejoras-tile-value">{Number(totals.today_count || 0)}</span>
                <span className="mejoras-tile-label">hechas hoy</span>
                <span className="mejoras-tile-trend">{inProgress.length > 0 ? `${inProgress.length} en camino` : 'nada pendiente en el plan'}</span>
              </div>
            )}
            <div className="mejoras-tile">
              <span className="mejoras-tile-value">{Number(totals.all_time || 0)}</span>
              <span className="mejoras-tile-label">mejoras acumuladas</span>
              <span className="mejoras-tile-trend">desde que empezó el registro</span>
            </div>
          </div>

          <h3 className="mejoras-section-title">Por área del negocio</h3>
          <div className="mejoras-areas">
            {byArea.map((area) => (
              <button
                type="button"
                key={area.area}
                className={`mejoras-area ${areaFilter === area.area ? 'is-active' : ''} ${area.count === 0 ? 'is-empty' : ''}`}
                onClick={() => { setAreaFilter(areaFilter === area.area ? null : area.area); setUserFilter(null); }}
              >
                <span className="mejoras-area-top">
                  <span className="mejoras-area-icon" aria-hidden="true">{AREA_ICONS[area.area] || '✦'}</span>
                  <span className="mejoras-area-name">{area.label}</span>
                  <span className="mejoras-area-count">{area.count}</span>
                </span>
                <span className="mejoras-area-track">
                  <span className="mejoras-area-bar" style={{ width: `${Math.round((area.count / maxArea) * 100)}%` }} />
                </span>
                <span className="mejoras-area-sub">
                  {area.count === 0 ? 'sin mejoras este mes' : `${Math.round((area.count / Math.max(1, monthCount)) * 100)}% de las mejoras del mes`}
                </span>
              </button>
            ))}
          </div>

          <div className="mejoras-grid">
            <section className="card mejoras-log">
              <div className="mejoras-log-head">
                <h3>
                  Registro
                  {(filterArea || filterName) && (
                    <span className="mejoras-filter-chip">
                      {filterArea || filterName}
                      <button type="button" onClick={() => { setAreaFilter(null); setUserFilter(null); }} aria-label="Quitar filtro">✕</button>
                    </span>
                  )}
                </h3>
                <span className="mejoras-log-count">{items.length} {items.length === 1 ? 'mejora' : 'mejoras'}</span>
              </div>

              {isCurrentMonth && inProgress.length > 0 && !areaFilter && !userFilter && (
                <div className="mejoras-progress">
                  <div className="mejoras-progress-title">En camino hoy</div>
                  <ul>
                    {inProgress.map((task) => (
                      <li key={task.id}>
                        <span className="mejoras-progress-time">{minuteLabel(task.start_minute)}</span>
                        <strong>{task.user_name}</strong>
                        <span>{task.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {groupedByDate.length === 0 ? (
                <p className="dashboard-muted mejoras-empty">
                  {monthCount === 0
                    ? 'Todavía no hay mejoras registradas este mes. Planifica una “💡 Mejora” en el Plan del día y márcala hecha.'
                    : 'Sin mejoras con este filtro.'}
                </p>
              ) : (
                groupedByDate.map(([date, dayItems]) => (
                  <div key={date} className="mejoras-day">
                    <div className="mejoras-day-label">{dateLabel(date)}</div>
                    <ul className="mejoras-list">
                      {dayItems.map((item) => {
                        const canEdit = isAdmin || item.user_id === myId;
                        const isEditing = editingId === item.id;
                        return (
                          <li key={item.id} className={`mejoras-item is-${item.area}`}>
                            <div className="mejoras-item-main">
                              <div className="mejoras-item-title">{item.title}</div>
                              <div className="mejoras-item-meta">
                                <button type="button" className="mejoras-item-user" onClick={() => { setUserFilter(item.user_id); setAreaFilter(null); }}>
                                  {item.user_name}
                                </button>
                                {isAdmin ? (
                                  <select
                                    className="mejoras-item-area-select"
                                    value={item.area}
                                    onChange={(e) => changeArea(item, e.target.value)}
                                    title="Área (solo Admin)"
                                  >
                                    {(data?.areas || []).map((a) => <option key={a.area} value={a.area}>{a.label}</option>)}
                                  </select>
                                ) : (
                                  <span className="mejoras-item-area">{AREA_ICONS[item.area]} {item.area_label}</span>
                                )}
                              </div>
                              {isEditing ? (
                                <div className="mejoras-detail-edit">
                                  <textarea
                                    rows={3}
                                    maxLength={1500}
                                    placeholder="¿Qué cambió y qué se ganó? (ej: ahora el embalado tarda 5 min menos por pedido)"
                                    value={draftDetail}
                                    onChange={(e) => setDraftDetail(e.target.value)}
                                    autoFocus
                                  />
                                  <div className="mejoras-detail-actions">
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)} disabled={savingId === item.id}>Cancelar</button>
                                    <button type="button" className="btn btn-primary btn-sm" onClick={() => saveDetail(item)} disabled={savingId === item.id}>
                                      {savingId === item.id ? 'Guardando…' : 'Guardar'}
                                    </button>
                                  </div>
                                </div>
                              ) : item.detail ? (
                                <p className="mejoras-item-detail">{item.detail}</p>
                              ) : canEdit ? (
                                <button type="button" className="mejoras-item-doc" onClick={() => startEdit(item)}>
                                  + Documentar qué cambió
                                </button>
                              ) : (
                                <p className="mejoras-item-detail is-missing">Sin documentar todavía</p>
                              )}
                            </div>
                            {!isEditing && (canEdit || isAdmin) && (
                              <div className="mejoras-item-actions">
                                {canEdit && item.detail && (
                                  <button type="button" title="Editar" onClick={() => startEdit(item)}>✎</button>
                                )}
                                {isAdmin && (
                                  <button type="button" title="Quitar del registro" onClick={() => removeItem(item)}>✕</button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <aside className="card mejoras-people">
              <div className="mejoras-log-head">
                <h3>Por persona</h3>
                <span className="mejoras-log-count">{MONTH_NAMES[month - 1]}</span>
              </div>
              <ul className="mejoras-people-list">
                {byUser.map((member) => (
                  <li key={member.user_id} className={`${userFilter === member.user_id ? 'is-active' : ''} ${member.month_count === 0 ? 'is-zero' : ''} ${member.user_id === myId ? 'is-me' : ''}`}>
                    <button type="button" onClick={() => { setUserFilter(userFilter === member.user_id ? null : member.user_id); setAreaFilter(null); }}>
                      <span className="mejoras-person-row">
                        <span className="mejoras-person-name">
                          {member.name}
                          {member.user_id === myId && <em>yo</em>}
                        </span>
                        <span className="mejoras-person-count">{member.month_count}</span>
                      </span>
                      <span className="mejoras-person-track">
                        <span className="mejoras-person-bar" style={{ width: `${Math.round((member.month_count / maxUser) * 100)}%` }} />
                      </span>
                      <span className="mejoras-person-sub">
                        {member.total_count} en total{member.last_date ? ` · última ${dateLabel(member.last_date)}` : ' · sin mejoras aún'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          {Array.isArray(qcRecords) && (
            <details className="mejoras-qc">
              <summary>Registros de control de calidad</summary>
              <div className="mejoras-qc-body">
                <QualityControlRecordsAdmin token={token} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
