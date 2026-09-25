// CRM «Clientes»: la base comercial. Lista de clientes con estado del embudo,
// último contacto, próximo seguimiento, notas y acceso directo a WhatsApp;
// vista Embudo (kanban) reutilizando el tablero existente. Los clientes se
// crean/actualizan solos al cotizar; aquí se trabaja el seguimiento.
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';
import PipelineBoard from './crm/PipelineBoard';

const STAGES = [
  { key: 'contactado', label: 'Contactado', cls: 'is-contactado' },
  { key: 'cotizado', label: 'Cotizado', cls: 'is-cotizado' },
  { key: 'negociando', label: 'Negociando', cls: 'is-negociando' },
  { key: 'cliente', label: 'Cliente PCX', cls: 'is-cliente' },
  { key: 'inactivo', label: 'Inactivo', cls: 'is-inactivo' },
  { key: 'perdido', label: 'Perdido', cls: 'is-perdido' }
];
const STAGE_META = Object.fromEntries(STAGES.map((s) => [s.key, s]));

const formatBs = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const todayText = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const relativeText = (value) => {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  return `${then.getDate()} ${MONTH_SHORT[then.getMonth()]}`;
};

const shortDateText = (value) => {
  if (!value) return '';
  const [, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTH_SHORT[(m || 1) - 1]}`;
};

export default function CrmPanel({ token }) {
  const toast = useToast();
  const [view, setView] = useState('lista');
  const [customers, setCustomers] = useState([]);
  const [dueCount, setDueCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  // Filtros de Marketing: línea comprada (Acero/Armonía), última compra, ciudad.
  const [lineFilter, setLineFilter] = useState('');
  const [recencyFilter, setRecencyFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [summary, setSummary] = useState(null);
  // 'read' = Marketing: ve, filtra y exporta; no edita etapa, seguimiento ni notas.
  const [scope, setScope] = useState('full');
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', ciudad: '', follow_up_at: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (stageFilter) params.set('stage', stageFilter);
      if (dueOnly) params.set('due', '1');
      if (lineFilter) params.set('line', lineFilter);
      if (recencyFilter) params.set('recency', recencyFilter);
      if (cityFilter.trim()) params.set('city', cityFilter.trim());
      params.set('limit', '500');
      const data = await apiRequest(`/api/customers?${params.toString()}`, { token });
      setCustomers(Array.isArray(data?.customers) ? data.customers : []);
      setDueCount(Number(data?.follow_ups_due || 0));
      setSummary(data?.summary || null);
      setScope(data?.scope === 'read' ? 'read' : 'full');
      setLoaded(true);
    } catch (err) {
      toast.error(err.message || 'No se pudieron cargar clientes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search, stageFilter, dueOnly, lineFilter, recencyFilter, cityFilter]);

  useEffect(() => {
    const timer = setTimeout(load, (search || cityFilter) ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search, cityFilter]);

  const readOnly = scope === 'read';

  // Exportar la lista filtrada: teléfonos para WhatsApp (portapapeles) o CSV.
  const copyPhones = async () => {
    const phones = customers.map((c) => String(c.phone || '').trim()).filter(Boolean);
    if (phones.length === 0) { toast.error('No hay teléfonos en la lista'); return; }
    try {
      await navigator.clipboard.writeText(phones.join('\n'));
      toast.success(`${phones.length} teléfonos copiados`);
    } catch {
      toast.error('No se pudo copiar. Usa Exportar CSV.');
    }
  };
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Cliente', 'Teléfono', 'Ciudad', 'Líneas', 'Última compra', 'Compras', 'Total Bs', 'Acero Bs', 'Armonía Bs', 'Etapa', 'Atiende'];
    const rows = customers.map((c) => [
      c.name, c.phone || '', c.ciudad || c.provincia || c.department || '',
      (c.lines_bought || []).map((l) => (l === 'acero' ? 'Acero' : 'Armonía')).join(' + '),
      c.last_paid_at ? String(c.last_paid_at).slice(0, 10) : '', c.paid_count || 0,
      Math.round(Number(c.total_spent || 0)), Math.round(Number(c.acero_total || 0)), Math.round(Number(c.armonia_total || 0)),
      STAGE_META[c.pipeline_stage]?.label || c.pipeline_stage, c.owner_name || ''
    ]);
    const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-${todayText()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`CSV con ${customers.length} clientes`);
  };

  const fetchDetail = async (customerId) => {
    try {
      const data = await apiRequest(`/api/customers/${customerId}`, { token });
      setDetail(data);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el cliente');
    }
  };

  const openDetail = (customer) => {
    if (expandedId === customer.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(customer.id);
    setDetail(null);
    fetchDetail(customer.id);
  };

  const patchCustomer = async (customer, body, okMsg) => {
    try {
      const data = await apiRequest(`/api/customers/${customer.id}`, { method: 'PATCH', token, body });
      setCustomers((prev) => prev.map((c) => (c.id === customer.id ? { ...c, ...data.customer } : c)));
      if (okMsg) toast.success(okMsg);
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar');
    }
  };

  const addNote = async (customer) => {
    const note = window.prompt(`Registrar contacto con ${customer.name}:`, '');
    if (!note || !note.trim()) return;
    try {
      await apiRequest(`/api/customers/${customer.id}/notes`, { method: 'POST', token, body: { note: note.trim() } });
      toast.success('Contacto registrado');
      if (expandedId === customer.id) fetchDetail(customer.id);
    } catch (err) {
      toast.error(err.message || 'No se pudo registrar');
    }
  };

  const createCustomer = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      await apiRequest('/api/customers', {
        method: 'POST',
        token,
        body: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          ciudad: form.ciudad.trim() || null,
          follow_up_at: form.follow_up_at || null
        }
      });
      toast.success('Cliente creado');
      setForm({ name: '', phone: '', ciudad: '', follow_up_at: '' });
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo crear el cliente');
    } finally {
      setBusy(false);
    }
  };

  const today = todayText();

  return (
    <div className="container cli-page">
      <div className="cli-head">
        <p className="cli-sub">
          {readOnly
            ? 'La misma cartera que usa Ventas, en modo lectura: filtra por línea comprada, última compra y ciudad; copia los teléfonos o exporta la lista.'
            : 'Tu cartera comercial: estado, seguimiento y contacto en un solo lugar.'}
        </p>
        <div className="cli-head-actions">
          {readOnly ? (
            <span className="cli-readonly" title="Ves, filtras y exportas. La etapa, el seguimiento y las notas los maneja Ventas.">🔒 Solo lectura</span>
          ) : (
            <>
              <div className="admin-subtabs cli-view-tabs" role="tablist" aria-label="Vista de clientes">
                <button type="button" className={`admin-subtab ${view === 'lista' ? 'is-active' : ''}`} onClick={() => setView('lista')}>Lista</button>
                <button type="button" className={`admin-subtab ${view === 'embudo' ? 'is-active' : ''}`} onClick={() => setView('embudo')}>Embudo</button>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancelar' : '+ Nuevo cliente'}
              </button>
            </>
          )}
        </div>
      </div>

      {showForm && !readOnly && (
        <div className="card cli-form">
          <input type="text" maxLength={160} placeholder="Nombre del cliente o taller" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input type="text" maxLength={40} placeholder="Teléfono (WhatsApp)" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input type="text" maxLength={120} placeholder="Ciudad" value={form.ciudad}
            onChange={(e) => setForm({ ...form, ciudad: e.target.value })} />
          <label className="cli-form-date">Seguimiento
            <input type="date" value={form.follow_up_at} onChange={(e) => setForm({ ...form, follow_up_at: e.target.value })} />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={createCustomer}>Crear</button>
        </div>
      )}

      {view === 'embudo' && !readOnly ? (
        <PipelineBoard token={token} />
      ) : (
        <>
          {summary && (
            <div className="cli-tiles">
              {[
                { key: '', label: 'Clientes', value: summary.total, sub: 'en la cartera', cls: '' },
                { key: 'acero', label: 'Compraron Acero', value: summary.acero, sub: 'línea industrial', cls: 'is-acero' },
                { key: 'armonia', label: 'Compraron Armonía', value: summary.armonia, sub: 'línea hogar', cls: 'is-armonia' },
                { key: 'both', label: 'Ambas líneas', value: summary.both, sub: 'los más fieles', cls: '' },
                { key: 'reactivar', label: 'Para reactivar', value: summary.reactivar, sub: '60+ días sin comprar', cls: 'is-warn' }
              ].map((tile) => {
                const active = tile.key === 'reactivar' ? recencyFilter === '60plus' : (lineFilter === tile.key && (tile.key !== '' || recencyFilter !== '60plus'));
                return (
                  <button
                    key={tile.key || 'all'}
                    type="button"
                    className={`cli-tile ${tile.cls} ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      if (tile.key === 'reactivar') { setRecencyFilter((v) => (v === '60plus' ? '' : '60plus')); return; }
                      setLineFilter(tile.key);
                      if (tile.key === '') setRecencyFilter('');
                    }}
                  >
                    <strong>{tile.value}</strong>
                    <span>{tile.label}</span>
                    <small>{tile.sub}</small>
                  </button>
                );
              })}
            </div>
          )}

          <div className="cli-toolbar">
            <input
              type="text"
              className="cli-search"
              placeholder="Buscar por nombre o teléfono…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="cli-stage-chips cli-line-chips">
              <span className="cli-filter-label">Línea</span>
              {[['', 'Todas'], ['acero', 'Acero'], ['armonia', 'Armonía'], ['both', 'Ambas'], ['none', 'Sin compra']].map(([key, label]) => (
                <button
                  key={key || 'all'}
                  type="button"
                  className={`cli-chip ${key ? `cli-chip-${key}` : ''} ${lineFilter === key ? 'is-active' : ''}`}
                  onClick={() => setLineFilter(key)}
                >
                  {label}
                </button>
              ))}
              <span className="cli-filter-label">Última compra</span>
              <select className="cli-filter-select" value={recencyFilter} onChange={(e) => setRecencyFilter(e.target.value)} aria-label="Última compra">
                <option value="">Cualquiera</option>
                <option value="30">Últimos 30 días</option>
                <option value="90">Últimos 90 días</option>
                <option value="60plus">Hace 60+ días (reactivar)</option>
              </select>
              <input
                type="text"
                className="cli-filter-input"
                placeholder="Ciudad…"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                aria-label="Ciudad"
              />
            </div>
            <div className="cli-stage-chips">
              <button type="button" className={`cli-chip ${stageFilter === '' ? 'is-active' : ''}`} onClick={() => setStageFilter('')}>Todos</button>
              {STAGES.map((stage) => (
                <button
                  key={stage.key}
                  type="button"
                  className={`cli-chip ${stageFilter === stage.key ? 'is-active' : ''}`}
                  onClick={() => setStageFilter(stageFilter === stage.key ? '' : stage.key)}
                >
                  {stage.label}
                </button>
              ))}
              <button type="button" className={`cli-chip cli-chip-due ${dueOnly ? 'is-active' : ''}`} onClick={() => setDueOnly((v) => !v)}>
                Seguimiento vencido ({dueCount})
              </button>
            </div>
            {loaded && (
              <div className="cli-export-bar">
                <span className="cli-muted">
                  <strong>{customers.length}</strong> cliente{customers.length === 1 ? '' : 's'} · {formatBs(customers.reduce((sum, c) => sum + Number(c.total_spent || 0), 0))} comprados
                </span>
                <div className="cli-export-actions">
                  <button type="button" className="btn btn-primary cli-export-btn" onClick={copyPhones} disabled={customers.length === 0}>📋 Copiar teléfonos para WhatsApp</button>
                  <button type="button" className="btn btn-secondary cli-export-btn" onClick={exportCsv} disabled={customers.length === 0}>⬇ Exportar CSV</button>
                </div>
              </div>
            )}
          </div>

          {!loaded ? (
            <p className="dashboard-muted">Cargando clientes…</p>
          ) : customers.length === 0 ? (
            <p className="dashboard-muted">Sin clientes con ese filtro.</p>
          ) : (
            <div className="cli-table-wrap">
              <table className="cli-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Teléfono</th>
                    <th>Ciudad</th>
                    <th>Líneas</th>
                    <th>Estado</th>
                    <th>Última compra</th>
                    {!readOnly && <th>Próx. seguimiento</th>}
                    <th>Comprado</th>
                    {!readOnly && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const stage = STAGE_META[customer.pipeline_stage] || STAGES[0];
                    const followUp = customer.follow_up_at ? String(customer.follow_up_at).slice(0, 10) : '';
                    const overdue = followUp && followUp < today;
                    const lastContact = customer.last_quote_at && customer.updated_at
                      ? (new Date(customer.last_quote_at) > new Date(customer.updated_at) ? customer.last_quote_at : customer.updated_at)
                      : customer.last_quote_at || customer.updated_at;
                    const isExpanded = expandedId === customer.id;
                    return (
                      <FragmentRow
                        key={customer.id}
                        customer={customer}
                        stage={stage}
                        followUp={followUp}
                        overdue={overdue}
                        lastContact={lastContact}
                        isExpanded={isExpanded}
                        detail={isExpanded ? detail : null}
                        readOnly={readOnly}
                        onToggle={() => openDetail(customer)}
                        onStageChange={(value) => patchCustomer(customer, { pipeline_stage: value })}
                        onFollowUpChange={(value) => patchCustomer(customer, { follow_up_at: value || null }, value ? 'Seguimiento agendado' : 'Seguimiento quitado')}
                        onAddNote={() => addNote(customer)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const LINE_LABEL = { acero: 'Acero', armonia: 'Armonía' };
const LineChips = ({ lines }) => (
  <span className="cli-lines">
    {(lines || []).length === 0
      ? <span className="cli-line-chip is-none">ninguna aún</span>
      : lines.map((line) => <span key={line} className={`cli-line-chip is-${line}`}>{LINE_LABEL[line] || line}</span>)}
  </span>
);
const recencyChip = (lastPaidAt) => {
  if (!lastPaidAt) return null;
  const days = Math.floor((Date.now() - new Date(lastPaidAt).getTime()) / 86400000);
  const cls = days <= 30 ? 'is-fresh' : days >= 60 ? 'is-stale' : '';
  return <span className={`cli-recency ${cls}`}>{days <= 0 ? 'hoy' : `hace ${days} d`}</span>;
};

function FragmentRow({ customer, stage, followUp, overdue, lastContact, isExpanded, detail, readOnly, onToggle, onStageChange, onFollowUpChange, onAddNote }) {
  const phoneDigits = String(customer.phone || '').replace(/\D/g, '');
  const colSpan = readOnly ? 7 : 9;
  return (
    <>
      <tr className={`cli-row ${overdue && !readOnly ? 'is-overdue' : ''}`}>
        <td>
          <button type="button" className="cli-name-btn" onClick={onToggle} title="Ver detalle">
            <strong>{customer.name}</strong>
            {customer.owner_name && <small>{customer.owner_name}</small>}
          </button>
        </td>
        <td className="cli-nowrap">
          {phoneDigits ? (
            <a className="cli-wa-link" href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer">
              {customer.phone}
            </a>
          ) : '—'}
        </td>
        <td className="cli-nowrap">{customer.ciudad || customer.provincia || customer.department || '—'}</td>
        <td><LineChips lines={customer.lines_bought} /></td>
        <td>
          {readOnly ? (
            <span className={`cli-stage-pill ${stage.cls}`}>{stage.label}</span>
          ) : (
            <select
              className={`cli-stage-select ${stage.cls}`}
              value={customer.pipeline_stage}
              onChange={(e) => onStageChange(e.target.value)}
            >
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
        </td>
        <td className="cli-nowrap cli-muted" title={lastContact ? `Último contacto: ${relativeText(lastContact)}` : undefined}>
          {customer.last_paid_at ? <>{shortDateText(String(customer.last_paid_at).slice(0, 10))} {recencyChip(customer.last_paid_at)}</> : <span className="cli-line-chip is-none">sin compra</span>}
        </td>
        {!readOnly && (
          <td className="cli-nowrap">
            <input
              type="date"
              className={`cli-followup-input ${overdue ? 'is-overdue' : ''}`}
              value={followUp}
              onChange={(e) => onFollowUpChange(e.target.value)}
              title={customer.follow_up_note || 'Próximo seguimiento'}
            />
          </td>
        )}
        <td className="cli-nowrap cli-muted" title={`Acero ${formatBs(customer.acero_total)} · Armonía ${formatBs(customer.armonia_total)}`}>
          {Number(customer.total_spent) > 0 ? formatBs(customer.total_spent) : '—'}
          {Number(customer.paid_count) > 0 && <small className="cli-paid-count"> · {customer.paid_count} compra{customer.paid_count === 1 ? '' : 's'}</small>}
        </td>
        {!readOnly && (
          <td className="cli-nowrap">
            <button type="button" className="btn btn-secondary cli-mini-btn" onClick={onAddNote} title="Registrar contacto / nota">📝</button>
            <button type="button" className="btn btn-secondary cli-mini-btn" onClick={onToggle} title="Historial">{isExpanded ? '▲' : '▼'}</button>
          </td>
        )}
      </tr>
      {isExpanded && (
        <tr className="cli-detail-row">
          <td colSpan={colSpan}>
            {!detail ? (
              <p className="dashboard-muted">Cargando historial…</p>
            ) : (
              <div className="cli-detail">
                <div className="cli-detail-col">
                  <h4>Notas y contactos</h4>
                  {detail.notes.length === 0 ? (
                    <p className="dashboard-muted">{readOnly ? 'Sin notas todavía.' : 'Sin notas todavía. Usa 📝 para registrar cada contacto.'}</p>
                  ) : (
                    <ul className="cli-notes">
                      {detail.notes.slice(0, 6).map((note) => (
                        <li key={note.id}>
                          <span className="cli-note-meta">{relativeText(note.created_at)}{note.author ? ` · ${note.author}` : ''}</span>
                          <span>{note.note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {customer.follow_up_note && (
                    <p className="cli-followup-note">🎯 Próximo paso: {customer.follow_up_note}</p>
                  )}
                </div>
                <div className="cli-detail-col">
                  <h4>Cotizaciones ({detail.quotes.length})</h4>
                  {(Number(customer.acero_total) > 0 || Number(customer.armonia_total) > 0) && (
                    <p className="cli-line-totals">
                      <span className="cli-line-chip is-acero">Acero</span> {formatBs(customer.acero_total)}
                      {' · '}
                      <span className="cli-line-chip is-armonia">Armonía</span> {formatBs(customer.armonia_total)}
                    </p>
                  )}
                  {detail.quotes.length === 0 ? (
                    <p className="dashboard-muted">Sin cotizaciones aún.</p>
                  ) : (
                    <ul className="cli-quotes">
                      {detail.quotes.slice(0, 6).map((quote) => (
                        <li key={quote.id}>
                          <strong>#{quote.id}</strong>
                          <span>{formatBs(quote.total)}</span>
                          <span className={`cli-quote-status is-${String(quote.status).toLowerCase()}`}>{quote.status}</span>
                          {(quote.lines || []).map((line) => <span key={line} className={`cli-line-chip is-${line}`}>{LINE_LABEL[line] || line}</span>)}
                          <span className="cli-muted">{shortDateText(String(quote.created_at).slice(0, 10))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
