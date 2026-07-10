import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

// Warehouse reception: finished lotes arriving from the factory, one card per
// sede. Almacén counts what arrived — only intact pieces enter stock; transit
// damage is logged and the need regenerates automatically.
export default function ProductionReception({ token }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forms, setForms] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [doneMsg, setDoneMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/api/production/kanban', { token });
      setCards(Array.isArray(data?.cards) ? data.cards : []);
    } catch (err) {
      setError(err.message || 'No se pudo cargar recepción');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const bySede = useMemo(() => {
    const groups = new Map();
    for (const card of cards) {
      if (card.stage !== 'recepcion') continue;
      const sede = card.store_location || '—';
      if (!groups.has(sede)) groups.set(sede, []);
      groups.get(sede).push(card);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cards]);

  const waitingSince = (card) => {
    const since = card.last_moved_at || card.created_at;
    if (!since) return null;
    const hours = Math.floor((Date.now() - new Date(since).getTime()) / 3600000);
    if (hours < 1) return 'hace menos de 1 h';
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `hace ${days} d ${hours % 24} h`;
  };

  const confirmReception = async (card) => {
    const form = forms[card.id] || {};
    const intact = Number.parseInt(form.intact, 10) || 0;
    const damaged = Number.parseInt(form.damaged, 10) || 0;
    if (intact <= 0 && damaged <= 0) {
      setError('Registra al menos una pieza recibida o dañada.');
      return;
    }
    setBusyId(card.id);
    setError('');
    setDoneMsg('');
    try {
      const res = await apiRequest(`/api/production/kanban/cards/${card.id}/receive`, {
        method: 'POST',
        token,
        body: { intact, damaged }
      });
      setDoneMsg(`${card.product_name}: ${res?.intact} intactas entraron al stock de ${res?.store_location}${res?.damaged > 0 ? ` · ${res.damaged} dañadas registradas` : ''}.`);
      setForms((prev) => { const next = { ...prev }; delete next[card.id]; return next; });
      await load();
    } catch (err) {
      setError(err.message || 'No se pudo confirmar la recepción');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container prod-page">
      <div className="card plan-intro">
        <h2 className="plan-title">Recepción de producción</h2>
        <p className="plan-sub">
          Lotes terminados en camino a tu almacén. Cuenta lo que llegó: solo las piezas
          intactas entran al stock; las dañadas en el transporte se registran y la
          reposición se regenera sola.
        </p>
      </div>

      {error && <div className="card prod-error">{error}</div>}
      {doneMsg && <div className="card recep-done">{doneMsg}</div>}

      {loading ? (
        <div className="card" style={{ color: '#78716c' }}>Cargando recepción…</div>
      ) : bySede.length === 0 ? (
        <div className="card" style={{ color: '#78716c' }}>
          No hay lotes por recibir. Cuando producción despache un lote, aparecerá aquí.
        </div>
      ) : (
        bySede.map(([sede, sedeCards]) => (
          <section key={sede} className="recep-sede">
            <h3 className="recep-sede-title">{sede} <span className="recep-sede-count">{sedeCards.length}</span></h3>
            <div className="recep-list">
              {sedeCards.map((card) => (
                <div key={card.id} className="recep-item">
                  <div className="recep-item-info">
                    <span className="recep-item-name">{card.product_name}</span>
                    <span className="recep-item-meta">
                      {card.sku} · <strong>{Number(card.required_qty || 0)} pzas en camino</strong>
                      {waitingSince(card) ? ` · ${waitingSince(card)}` : ''}
                    </span>
                  </div>
                  <div className="recep-item-form">
                    <label className="prod-qc-field">
                      <span className="prod-qc-field-label">Intactas</span>
                      <input
                        type="number" min="0" inputMode="numeric" className="prod-qc-input"
                        value={forms[card.id]?.intact ?? ''}
                        onChange={(e) => setForms((prev) => ({ ...prev, [card.id]: { ...prev[card.id], intact: e.target.value } }))}
                        placeholder={String(card.required_qty || 0)}
                      />
                    </label>
                    <label className="prod-qc-field">
                      <span className="prod-qc-field-label">Dañadas</span>
                      <input
                        type="number" min="0" inputMode="numeric" className="prod-qc-input"
                        value={forms[card.id]?.damaged ?? ''}
                        onChange={(e) => setForms((prev) => ({ ...prev, [card.id]: { ...prev[card.id], damaged: e.target.value } }))}
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary recep-confirm-btn"
                      disabled={busyId === card.id}
                      onClick={() => confirmReception(card)}
                    >
                      {busyId === card.id ? 'Guardando…' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
