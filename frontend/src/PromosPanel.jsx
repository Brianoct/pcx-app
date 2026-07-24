// Promos — la caja de herramientas de marketing para Cotizar.
// Cada herramienta se activa por ventana de fechas (idealmente junto a una
// campaña); Cotizar la muestra al vendedor y la estampa en la proforma.
// Herramientas de hoy: Envío gratis y Sorteo (tickets ponderados por compra).
// La lista crecerá y se podará según resultados — por eso todo es config, no código.
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './apiClient';

const TOOL_META = {
  envio_gratis: { icon: '🚚', label: 'Envío gratis' },
  sorteo: { icon: '🎟️', label: 'Sorteo' }
};

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' });
};

const windowLabel = (tool) => {
  const start = formatDate(tool.starts_on);
  const end = formatDate(tool.ends_on);
  if (start && end) return `${start} — ${end}`;
  if (end) return `hasta ${end}`;
  if (start) return `desde ${start}`;
  return 'sin fecha límite';
};

const configSummary = (tool) => {
  const config = tool.config || {};
  const parts = [];
  if (Number(config.min_total) > 0) parts.push(`compra mínima ${money(config.min_total)}`);
  if (tool.tool === 'sorteo') {
    if (Number(config.bs_per_ticket) > 0) {
      parts.push(`1 ticket por cada ${money(config.bs_per_ticket)} (máx. ${config.max_tickets || 5})`);
    } else {
      parts.push('1 ticket por cliente');
    }
  }
  return parts.join(' · ');
};

const EMPTY_FORM = {
  tool: 'envio_gratis',
  name: '',
  starts_on: '',
  ends_on: '',
  campaign_id: '',
  min_total: '',
  bs_per_ticket: '',
  max_tickets: '5'
};

export default function PromosPanel({ token, role }) {
  const canManage = /admin|marketing lider/i.test(String(role || ''));
  const [tools, setTools] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [codesByTool, setCodesByTool] = useState({});
  const [drawingId, setDrawingId] = useState(null);

  const load = useCallback(() => {
    apiRequest('/api/promos', { token })
      .then((data) => { setTools(Array.isArray(data?.tools) ? data.tools : []); setError(''); })
      .catch((err) => setError(err.message || 'No se pudo cargar'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiRequest('/api/campaigns', { token })
      .then((data) => setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []))
      .catch(() => {});
  }, [token]);

  const setField = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const createTool = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) { setError('Ponle un nombre a la herramienta'); return; }
    setSaving(true);
    setError('');
    try {
      const config = {};
      if (form.min_total !== '') config.min_total = Number(form.min_total);
      if (form.tool === 'sorteo') {
        if (form.bs_per_ticket !== '') config.bs_per_ticket = Number(form.bs_per_ticket);
        if (form.max_tickets !== '') config.max_tickets = Number(form.max_tickets);
      }
      await apiRequest('/api/promos', {
        method: 'POST',
        token,
        body: {
          tool: form.tool,
          name: form.name.trim(),
          starts_on: form.starts_on || null,
          ends_on: form.ends_on || null,
          campaign_id: form.campaign_id || null,
          active: false,
          config
        }
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setNotice('Herramienta creada. Actívala cuando estés listo.');
      load();
    } catch (err) {
      setError(err.message || 'No se pudo crear');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tool) => {
    setError('');
    try {
      await apiRequest(`/api/promos/${tool.id}`, { method: 'PATCH', token, body: { active: !tool.active } });
      setNotice(tool.active ? `"${tool.name}" desactivada.` : `"${tool.name}" activada: Cotizar ya la muestra.`);
      load();
    } catch (err) {
      setError(err.message || 'No se pudo actualizar');
    }
  };

  const removeTool = async (tool) => {
    if (!window.confirm(`¿Eliminar "${tool.name}"? Se pierde su registro de códigos.`)) return;
    setError('');
    try {
      await apiRequest(`/api/promos/${tool.id}`, { method: 'DELETE', token });
      setNotice('Herramienta eliminada.');
      load();
    } catch (err) {
      setError(err.message || 'No se pudo eliminar');
    }
  };

  const toggleRegistry = async (tool) => {
    if (expandedId === tool.id) { setExpandedId(null); return; }
    setExpandedId(tool.id);
    try {
      const data = await apiRequest(`/api/promos/${tool.id}/codes`, { token });
      setCodesByTool((prev) => ({ ...prev, [tool.id]: Array.isArray(data?.codes) ? data.codes : [] }));
    } catch (err) {
      setError(err.message || 'No se pudo cargar el registro');
    }
  };

  const runDraw = async (tool) => {
    if (!window.confirm(`Realizar el sorteo de "${tool.name}" ahora. El ganador se elige al azar ponderado por tickets pagados. ¿Continuar?`)) return;
    setDrawingId(tool.id);
    setError('');
    try {
      const data = await apiRequest(`/api/promos/${tool.id}/draw`, { method: 'POST', token });
      const winner = data?.winner;
      setNotice(winner
        ? `🏆 Ganador: ${winner.customer_name || 'cliente'} (${winner.code}) con ${winner.tickets} de ${winner.total_tickets} tickets.`
        : 'Sorteo realizado.');
      load();
      const codes = await apiRequest(`/api/promos/${tool.id}/codes`, { token });
      setCodesByTool((prev) => ({ ...prev, [tool.id]: Array.isArray(codes?.codes) ? codes.codes : [] }));
    } catch (err) {
      setError(err.message || 'No se pudo realizar el sorteo');
    } finally {
      setDrawingId(null);
    }
  };

  if (loading) return <div className="container prod-page"><p className="dashboard-muted">Cargando promos…</p></div>;

  return (
    <div className="container prod-page">
      <div className="card plan-intro">
        <h2 className="plan-title">Promos · toolchest de ventas</h2>
        <p className="plan-sub">
          Herramientas que se <strong>activan por temporada</strong> (idealmente junto a una campaña)
          y aparecen automáticamente en Cotizar y en la proforma del cliente. Lo prometido queda
          estampado en cada cotización: apagar una herramienta no cambia proformas ya impresas.
          Agrega y poda herramientas según los resultados.
        </p>
      </div>

      {error && <div className="camp-error">{error}</div>}
      {notice && <div className="promo-notice" onClick={() => setNotice('')}>{notice}</div>}

      {canManage && (
        <div className="promo-toolbar">
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancelar' : '+ Nueva herramienta'}
          </button>
        </div>
      )}

      {showForm && canManage && (
        <form className="card promo-form" onSubmit={createTool}>
          <div className="promo-form-grid">
            <label>
              Herramienta
              <select value={form.tool} onChange={setField('tool')}>
                <option value="envio_gratis">🚚 Envío gratis</option>
                <option value="sorteo">🎟️ Sorteo</option>
              </select>
            </label>
            <label>
              Nombre (aparece en la proforma)
              <input
                type="text"
                maxLength={120}
                placeholder={form.tool === 'sorteo' ? 'Sorteo aniversario PCX' : 'Envío gratis agosto'}
                value={form.name}
                onChange={setField('name')}
              />
            </label>
            <label>
              Campaña vinculada (opcional)
              <select value={form.campaign_id} onChange={setField('campaign_id')}>
                <option value="">— Sin campaña —</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.kind === 'live' ? '🔴 ' : '📣 '}{campaign.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Inicio (opcional)
              <input type="date" value={form.starts_on} onChange={setField('starts_on')} />
            </label>
            <label>
              Fin (fecha límite para el cliente)
              <input type="date" value={form.ends_on} onChange={setField('ends_on')} />
            </label>
            <label>
              Compra mínima (Bs{form.tool === 'sorteo' ? ', para participar' : ', 0 = siempre'})
              <input type="number" min="0" step="1" placeholder="0" value={form.min_total} onChange={setField('min_total')} />
            </label>
            {form.tool === 'sorteo' && (
              <>
                <label>
                  Bs por ticket (vacío = 1 ticket fijo)
                  <input type="number" min="0" step="1" placeholder="500" value={form.bs_per_ticket} onChange={setField('bs_per_ticket')} />
                </label>
                <label>
                  Máximo de tickets por compra
                  <input type="number" min="1" max="100" step="1" value={form.max_tickets} onChange={setField('max_tickets')} />
                </label>
              </>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creando…' : 'Crear herramienta'}
          </button>
        </form>
      )}

      {tools.length === 0 ? (
        <div className="card"><p className="dashboard-muted">Todavía no hay herramientas. Crea la primera con "+ Nueva herramienta".</p></div>
      ) : (
        <div className="promo-list">
          {tools.map((tool) => {
            const meta = TOOL_META[tool.tool] || { icon: '🧰', label: tool.tool };
            const codes = codesByTool[tool.id] || [];
            return (
              <div key={tool.id} className={`card promo-card ${tool.active ? 'is-active' : ''}`}>
                <div className="promo-card-head">
                  <div className="promo-card-title">
                    <span className="promo-card-icon">{meta.icon}</span>
                    <div>
                      <strong>{tool.name}</strong>
                      <span className="promo-card-kind">
                        {meta.label}
                        {tool.campaign_name ? ` · 📣 ${tool.campaign_name}` : ''}
                      </span>
                    </div>
                  </div>
                  <span className={`promo-status ${tool.active ? 'is-on' : 'is-off'}`}>
                    {tool.active ? 'ACTIVA' : 'Inactiva'}
                  </span>
                </div>

                <div className="promo-card-meta">
                  <span>📅 {windowLabel(tool)}</span>
                  {configSummary(tool) && <span>⚙️ {configSummary(tool)}</span>}
                  <span>🧾 {tool.quotes_count || 0} cotizaciones con esta promo</span>
                  {tool.tool === 'sorteo' && (
                    <span>🎟️ {tool.codes_count || 0} clientes · {tool.valid_tickets || 0} tickets pagados</span>
                  )}
                </div>

                {tool.tool === 'sorteo' && tool.winner_code && (
                  <div className="promo-winner">
                    🏆 Ganador: <strong>{tool.winner_name || 'Cliente'}</strong> · {tool.winner_code}
                    {tool.drawn_at ? ` · sorteado el ${formatDate(tool.drawn_at)}` : ''}
                  </div>
                )}

                <div className="promo-card-actions">
                  {canManage && (
                    <button
                      type="button"
                      className={`btn ${tool.active ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleActive(tool)}
                    >
                      {tool.active ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                  {tool.tool === 'sorteo' && (
                    <button type="button" className="btn btn-outline" onClick={() => toggleRegistry(tool)}>
                      {expandedId === tool.id ? 'Ocultar registro' : 'Ver registro de códigos'}
                    </button>
                  )}
                  {tool.tool === 'sorteo' && canManage && (
                    <button
                      type="button"
                      className="btn btn-outline promo-draw-btn"
                      disabled={drawingId === tool.id || Number(tool.valid_tickets || 0) === 0}
                      title={Number(tool.valid_tickets || 0) === 0 ? 'Aún no hay tickets pagados' : ''}
                      onClick={() => runDraw(tool)}
                    >
                      {drawingId === tool.id ? 'Sorteando…' : '🎲 Realizar sorteo'}
                    </button>
                  )}
                  {canManage && (
                    <button type="button" className="btn btn-outline promo-delete-btn" onClick={() => removeTool(tool)}>
                      Eliminar
                    </button>
                  )}
                </div>

                {tool.tool === 'sorteo' && expandedId === tool.id && (
                  <div className="promo-registry">
                    {codes.length === 0 ? (
                      <p className="dashboard-muted">Sin códigos todavía: se generan solos cuando una cotización alcanza el mínimo.</p>
                    ) : (
                      <table className="promo-registry-table">
                        <thead>
                          <tr><th>Código</th><th>Cliente</th><th>Teléfono</th><th>Tickets pagados</th><th>Compras</th><th>Estado</th></tr>
                        </thead>
                        <tbody>
                          {codes.map((code) => (
                            <tr key={code.id} className={code.status === 'ganadora' ? 'is-winner' : ''}>
                              <td><strong>{code.code}</strong></td>
                              <td>{code.customer_name || '—'}</td>
                              <td>{code.customer_phone}</td>
                              <td>{code.tickets}</td>
                              <td>
                                {(code.quotes || []).map((quote) => (
                                  <span key={quote.quote_id} className={`promo-quote-chip ${quote.paid ? 'is-paid' : ''}`}>
                                    #{quote.quote_id} · {money(quote.quote_total)}{quote.paid ? ` · ${quote.tickets}🎟` : ' · sin pagar'}
                                  </span>
                                ))}
                              </td>
                              <td>
                                {code.status === 'ganadora' ? '🏆 Ganadora' : code.status === 'valida' ? '✓ Válida' : 'Pendiente de pago'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
