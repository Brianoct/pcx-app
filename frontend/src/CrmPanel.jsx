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
      params.set('limit', '200');
      const data = await apiRequest(`/api/customers?${params.toString()}`, { token });
      setCustomers(Array.isArray(data?.customers) ? data.customers : []);
      setDueCount(Number(data?.follow_ups_due || 0));
      setLoaded(true);
    } catch (err) {
      toast.error(err.message || 'No se pudieron cargar clientes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search, stageFilter, dueOnly]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

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
        <p className="cli-sub">Tu cartera comercial: estado, seguimiento y contacto en un solo lugar.</p>
        <div className="cli-head-actions">
          <div className="admin-subtabs cli-view-tabs" role="tablist" aria-label="Vista de clientes">
            <button type="button" className={`admin-subtab ${view === 'lista' ? 'is-active' : ''}`} onClick={() => setView('lista')}>Lista</button>
            <button type="button" className={`admin-subtab ${view === 'embudo' ? 'is-active' : ''}`} onClick={() => setView('embudo')}>Embudo</button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancelar' : '+ Nuevo cliente'}
          </button>
        </div>
      </div>

      {showForm && (
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

      {view === 'embudo' ? (
        <PipelineBoard token={token} />
      ) : (
        <>
          <div className="cli-toolbar">
            <input
              type="text"
              className="cli-search"
              placeholder="Buscar por nombre o teléfono…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
                    <th>Estado</th>
                    <th>Último contacto</th>
                    <th>Próx. seguimiento</th>
                    <th>Comprado</th>
                    <th>Acciones</th>
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

function FragmentRow({ customer, stage, followUp, overdue, lastContact, isExpanded, detail, onToggle, onStageChange, onFollowUpChange, onAddNote }) {
  const phoneDigits = String(customer.phone || '').replace(/\D/g, '');
  return (
    <>
      <tr className={`cli-row ${overdue ? 'is-overdue' : ''}`}>
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
        <td>
          <select
            className={`cli-stage-select ${stage.cls}`}
            value={customer.pipeline_stage}
            onChange={(e) => onStageChange(e.target.value)}
          >
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </td>
        <td className="cli-nowrap cli-muted">{relativeText(lastContact)}</td>
        <td className="cli-nowrap">
          <input
            type="date"
            className={`cli-followup-input ${overdue ? 'is-overdue' : ''}`}
            value={followUp}
            onChange={(e) => onFollowUpChange(e.target.value)}
            title={customer.follow_up_note || 'Próximo seguimiento'}
          />
        </td>
        <td className="cli-nowrap cli-muted">
          {Number(customer.total_spent) > 0 ? formatBs(customer.total_spent) : '—'}
        </td>
        <td className="cli-nowrap">
          <button type="button" className="btn btn-secondary cli-mini-btn" onClick={onAddNote} title="Registrar contacto / nota">📝</button>
          <button type="button" className="btn btn-secondary cli-mini-btn" onClick={onToggle} title="Historial">{isExpanded ? '▲' : '▼'}</button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="cli-detail-row">
          <td colSpan={8}>
            {!detail ? (
              <p className="dashboard-muted">Cargando historial…</p>
            ) : (
              <div className="cli-detail">
                <div className="cli-detail-col">
                  <h4>Notas y contactos</h4>
                  {detail.notes.length === 0 ? (
                    <p className="dashboard-muted">Sin notas todavía. Usa 📝 para registrar cada contacto.</p>
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
                  {detail.quotes.length === 0 ? (
                    <p className="dashboard-muted">Sin cotizaciones aún.</p>
                  ) : (
                    <ul className="cli-quotes">
                      {detail.quotes.slice(0, 6).map((quote) => (
                        <li key={quote.id}>
                          <strong>#{quote.id}</strong>
                          <span>{formatBs(quote.total)}</span>
                          <span className={`cli-quote-status is-${String(quote.status).toLowerCase()}`}>{quote.status}</span>
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
