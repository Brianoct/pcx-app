import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../apiClient';

// Reusable CRM module. Used by Cotizar today; designed to drop into Ventas IA
// unchanged (import CustomerHub + CustomerSearchField and pass the same props).

const PIPELINE_STAGES = [
  { value: 'contactado', label: 'Contactado' },
  { value: 'cotizado', label: 'Cotizado' },
  { value: 'negociando', label: 'Negociando' },
  { value: 'cliente', label: 'Ganado (cliente)' },
  { value: 'perdido', label: 'Perdido' },
  { value: 'inactivo', label: 'Inactivo' }
];
const STAGE_LABEL = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.value, s.label]));

const money = (value) => `${Number(value || 0).toFixed(0)} Bs`;
const shortDate = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch {
    return '';
  }
};
const isDue = (customer) => Boolean(customer?.follow_up_at) && customer.follow_up_at <= new Date().toISOString().slice(0, 10);

// ─── Autocomplete input: type a name, pick an existing customer ──────────────
export function CustomerSearchField({ token, value, onChange, onPick, placeholder, maxLength, className }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleChange = (text) => {
    onChange(text);
    if (timer.current) clearTimeout(timer.current);
    const term = text.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const data = await apiRequest(`/api/customers?search=${encodeURIComponent(term)}&limit=6`, { token });
        setSuggestions(Array.isArray(data?.customers) ? data.customers : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 250);
  };

  return (
    <div className="crm-search-box" ref={boxRef}>
      <input
        type="text"
        className={className || 'form-input'}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="crm-suggestions">
          {suggestions.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className="crm-suggestion"
              onClick={() => { setOpen(false); setSuggestions([]); onPick(customer); }}
            >
              <span className="crm-suggestion-name">{customer.name}</span>
              <span className="crm-suggestion-meta">
                {customer.phone || 's/tel'}{customer.department ? ` · ${customer.department}` : ''}
                {customer.quotes_count > 0 ? ` · ${customer.quotes_count} cotiz.` : ''}
                {customer.owner_name ? ` · Atiende: ${customer.owner_name}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Full hub: list + ficha + seguimiento + pipeline + notas ─────────────────
export default function CustomerHub({ token, open, onClose, onUseCustomer, initialCustomerId = null }) {
  const [customers, setCustomers] = useState([]);
  const [followUpsDue, setFollowUpsDue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [detail, setDetail] = useState(null); // { customer, notes, quotes }
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [msg, setMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [sellers, setSellers] = useState([]);

  // Sellers list for the "Atiende" (cartera) selector.
  useEffect(() => {
    if (!open) return;
    let active = true;
    apiRequest('/api/sellers/assignable', { token })
      .then((rows) => { if (active) setSellers(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { active = false; };
  }, [open, token]);

  // Open straight on a customer's ficha (e.g. recognized WhatsApp number).
  useEffect(() => {
    if (open && initialCustomerId) openDetail(initialCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCustomerId]);

  const loadList = async () => {
    setLoading(true);
    setMsg('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (stageFilter) params.set('stage', stageFilter);
      if (dueOnly) params.set('due', '1');
      const data = await apiRequest(`/api/customers?${params.toString()}`, { token });
      setCustomers(Array.isArray(data?.customers) ? data.customers : []);
      setFollowUpsDue(Number(data?.follow_ups_due || 0));
    } catch (err) {
      setMsg(err.message || 'No se pudieron cargar clientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(loadList, search ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, stageFilter, dueOnly]);

  const openDetail = async (customerId) => {
    setLoadingDetail(true);
    setMsg('');
    try {
      const data = await apiRequest(`/api/customers/${customerId}`, { token });
      setDetail(data);
      setNoteText('');
    } catch (err) {
      setMsg(err.message || 'No se pudo cargar el cliente');
    } finally {
      setLoadingDetail(false);
    }
  };

  const patchCustomer = async (fields, { refreshList = false } = {}) => {
    if (!detail?.customer?.id) return;
    setSaving(true);
    setMsg('');
    try {
      const data = await apiRequest(`/api/customers/${detail.customer.id}`, {
        method: 'PATCH',
        token,
        body: fields
      });
      setDetail((prev) => (prev ? { ...prev, customer: { ...prev.customer, ...data.customer } } : prev));
      if (refreshList) await loadList();
    } catch (err) {
      setMsg(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!detail?.customer?.id || !noteText.trim()) return;
    setSaving(true);
    try {
      const data = await apiRequest(`/api/customers/${detail.customer.id}/notes`, {
        method: 'POST',
        token,
        body: { note: noteText.trim() }
      });
      setDetail((prev) => (prev ? { ...prev, notes: [data.note, ...prev.notes] } : prev));
      setNoteText('');
    } catch (err) {
      setMsg(err.message || 'No se pudo agregar la nota');
    } finally {
      setSaving(false);
    }
  };

  const createCustomer = async () => {
    if (!newCustomer.name.trim()) {
      setMsg('El nombre es requerido');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const data = await apiRequest('/api/customers', {
        method: 'POST',
        token,
        body: { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() || null }
      });
      setCreating(false);
      setNewCustomer({ name: '', phone: '' });
      await loadList();
      await openDetail(data.customer.id);
    } catch (err) {
      setMsg(err.message || 'No se pudo crear el cliente');
    } finally {
      setSaving(false);
    }
  };

  const editField = (key) => (e) => {
    const value = e.target.value;
    setDetail((prev) => (prev ? { ...prev, customer: { ...prev.customer, [key]: value } } : prev));
  };

  const saveFicha = () => patchCustomer({
    name: detail.customer.name,
    phone: detail.customer.phone,
    email: detail.customer.email,
    department: detail.customer.department,
    provincia: detail.customer.provincia,
    address: detail.customer.address,
    follow_up_at: detail.customer.follow_up_at || null,
    follow_up_note: detail.customer.follow_up_note
  }, { refreshList: true });

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const customer of customers) {
      counts[customer.pipeline_stage] = (counts[customer.pipeline_stage] || 0) + 1;
    }
    return counts;
  }, [customers]);

  if (!open) return null;

  return (
    <div className="crm-overlay" onClick={onClose}>
      <div className="crm-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="crm-head">
          <div className="crm-head-title">
            {detail ? (
              <button type="button" className="crm-back" onClick={() => { setDetail(null); loadList(); }}>←</button>
            ) : null}
            <h3>{detail ? detail.customer.name : 'Clientes'}</h3>
            {!detail && followUpsDue > 0 && (
              <span className="crm-due-badge">{followUpsDue} seguimiento{followUpsDue > 1 ? 's' : ''}</span>
            )}
          </div>
          <button type="button" className="crm-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {msg && <div className="crm-msg">{msg}</div>}

        {!detail ? (
          <>
            <div className="crm-toolbar">
              <input
                type="text"
                className="crm-search"
                placeholder="Buscar por nombre o teléfono…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="button" className="btn btn-secondary" onClick={() => { setCreating((v) => !v); setMsg(''); }}>
                {creating ? 'Cancelar' : '+ Nuevo'}
              </button>
            </div>

            {creating && (
              <div className="crm-new-form">
                <input
                  type="text"
                  className="crm-search"
                  placeholder="Nombre *"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer((prev) => ({ ...prev, name: e.target.value }))}
                />
                <input
                  type="text"
                  className="crm-search"
                  placeholder="Teléfono"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                />
                <button type="button" className="btn btn-primary" disabled={saving} onClick={createCustomer}>
                  {saving ? 'Creando…' : 'Crear cliente'}
                </button>
              </div>
            )}

            <div className="crm-stage-filter">
              <button
                type="button"
                className={`crm-stage-pill ${stageFilter === '' && !dueOnly ? 'is-active' : ''}`}
                onClick={() => { setStageFilter(''); setDueOnly(false); }}
              >
                Todos
              </button>
              <button
                type="button"
                className={`crm-stage-pill is-due ${dueOnly ? 'is-active' : ''}`}
                onClick={() => { setDueOnly((v) => !v); setStageFilter(''); }}
              >
                Seguimientos {followUpsDue > 0 ? `(${followUpsDue})` : ''}
              </button>
              {PIPELINE_STAGES.map((stage) => (
                <button
                  key={stage.value}
                  type="button"
                  className={`crm-stage-pill ${stageFilter === stage.value ? 'is-active' : ''}`}
                  onClick={() => { setStageFilter((prev) => (prev === stage.value ? '' : stage.value)); setDueOnly(false); }}
                >
                  {stage.label}{stageCounts[stage.value] ? ` ${stageCounts[stage.value]}` : ''}
                </button>
              ))}
            </div>

            <div className="crm-list">
              {loading ? (
                <div className="crm-empty">Cargando clientes…</div>
              ) : customers.length === 0 ? (
                <div className="crm-empty">Sin clientes que coincidan.</div>
              ) : customers.map((customer) => (
                <button key={customer.id} type="button" className="crm-row" onClick={() => openDetail(customer.id)}>
                  <div className="crm-row-main">
                    <span className="crm-row-name">{customer.name}</span>
                    <span className="crm-row-meta">
                      {customer.phone || 's/tel'}
                      {customer.quotes_count > 0 && ` · ${customer.quotes_count} cotiz. · ${money(customer.total_spent)}`}
                      {customer.owner_name && ` · Atiende: ${customer.owner_name}`}
                    </span>
                  </div>
                  <div className="crm-row-side">
                    {isDue(customer) && <span className="crm-chip is-due">Seguimiento</span>}
                    <span className={`crm-chip stage-${customer.pipeline_stage}`}>{STAGE_LABEL[customer.pipeline_stage] || customer.pipeline_stage}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : loadingDetail ? (
          <div className="crm-empty">Cargando ficha…</div>
        ) : (
          <div className="crm-detail">
            {onUseCustomer && (
              <button
                type="button"
                className="btn btn-primary crm-use-btn"
                onClick={() => { onUseCustomer(detail.customer); onClose(); }}
              >
                Usar en cotización
              </button>
            )}

            <div className="crm-section-label">Atiende (cartera)</div>
            <select
              className="crm-search"
              value={detail.customer.assigned_user_id || ''}
              disabled={saving}
              onChange={(e) => patchCustomer({ assigned_user_id: e.target.value ? Number(e.target.value) : null }, { refreshList: true })}
            >
              <option value="">Sin asignar</option>
              {sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>
                  {seller.display_name || String(seller.email || '').split('@')[0]}
                </option>
              ))}
            </select>
            <p className="crm-owner-hint">
              Las nuevas ventas y chats de este cliente se asignan automáticamente a su vendedor.
            </p>

            <div className="crm-section-label">Etapa</div>
            <div className="crm-stage-filter">
              {PIPELINE_STAGES.map((stage) => (
                <button
                  key={stage.value}
                  type="button"
                  disabled={saving}
                  className={`crm-stage-pill ${detail.customer.pipeline_stage === stage.value ? 'is-active' : ''}`}
                  onClick={() => patchCustomer({ pipeline_stage: stage.value })}
                >
                  {stage.label}
                </button>
              ))}
            </div>

            <div className="crm-section-label">Datos</div>
            <div className="crm-ficha-grid">
              <label>Nombre<input value={detail.customer.name || ''} onChange={editField('name')} /></label>
              <label>Teléfono<input value={detail.customer.phone || ''} onChange={editField('phone')} /></label>
              <label>Departamento<input value={detail.customer.department || ''} onChange={editField('department')} /></label>
              <label>Provincia<input value={detail.customer.provincia || ''} onChange={editField('provincia')} /></label>
              <label>Email<input value={detail.customer.email || ''} onChange={editField('email')} /></label>
              <label>Dirección<input value={detail.customer.address || ''} onChange={editField('address')} /></label>
            </div>

            <div className="crm-section-label">Seguimiento</div>
            <div className="crm-followup">
              <input
                type="date"
                value={detail.customer.follow_up_at || ''}
                onChange={editField('follow_up_at')}
              />
              <input
                type="text"
                placeholder="Motivo (ej: recotizar tablero)"
                value={detail.customer.follow_up_note || ''}
                onChange={editField('follow_up_note')}
              />
              {(detail.customer.follow_up_at || detail.customer.follow_up_note) && (
                <button
                  type="button"
                  className="btn btn-secondary crm-followup-clear"
                  disabled={saving}
                  onClick={() => {
                    setDetail((prev) => (prev
                      ? { ...prev, customer: { ...prev.customer, follow_up_at: '', follow_up_note: '' } }
                      : prev));
                    patchCustomer({ follow_up_at: null, follow_up_note: null }, { refreshList: true });
                  }}
                >
                  Quitar
                </button>
              )}
            </div>

            <button type="button" className="btn btn-secondary crm-save-btn" disabled={saving} onClick={saveFicha}>
              {saving ? 'Guardando…' : 'Guardar ficha'}
            </button>

            <div className="crm-section-label">Notas</div>
            <div className="crm-note-add">
              <textarea
                rows={2}
                placeholder="Ej: prefiere entregas los viernes…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button type="button" className="btn btn-secondary" disabled={saving || !noteText.trim()} onClick={addNote}>Agregar</button>
            </div>
            <div className="crm-notes">
              {detail.notes.length === 0 ? (
                <div className="crm-empty">Sin notas todavía.</div>
              ) : detail.notes.map((note) => (
                <div key={note.id} className="crm-note">
                  <div className="crm-note-text">{note.note}</div>
                  <div className="crm-note-meta">{note.author || '—'} · {shortDate(note.created_at)}</div>
                </div>
              ))}
            </div>

            <div className="crm-section-label">
              Historial ({detail.quotes.length}{detail.customer.quotes_count > detail.quotes.length ? ` de ${detail.customer.quotes_count}` : ''})
            </div>
            <div className="crm-quotes">
              {detail.quotes.length === 0 ? (
                <div className="crm-empty">Sin cotizaciones registradas.</div>
              ) : detail.quotes.map((quote) => (
                <div key={quote.id} className="crm-quote-row">
                  <span className="crm-quote-id">#{quote.id}</span>
                  <span className="crm-quote-date">{shortDate(quote.created_at)}</span>
                  <span className={`crm-chip status-${String(quote.status || '').toLowerCase()}`}>{quote.status}</span>
                  <span className="crm-quote-total">{money(quote.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
