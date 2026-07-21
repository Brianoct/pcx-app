import { useState } from 'react';
import { apiRequest } from './apiClient';

// Bloque compacto de inversión dentro de una tarjeta de Campaña o Live
// (solo Marketing/Admin lo ven): ítems de costo + total + retorno esperado.
// El análisis completo (retorno real, múltiplo) vive en la página Inversión.

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;

export default function InvestmentBox({ token, campaignId, investment, onChanged }) {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addCost = async () => {
    const value = Number(amount);
    if (!concept.trim() || !Number.isFinite(value) || value < 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/campaigns/${campaignId}/costs`, {
        method: 'POST', token, body: { concept: concept.trim(), amount: value }
      });
      setConcept('');
      setAmount('');
      onChanged?.();
    } catch (err) {
      setError(err.message || 'No se pudo registrar');
    } finally {
      setBusy(false);
    }
  };

  const removeCost = async (cost) => {
    if (!window.confirm(`¿Quitar "${cost.concept}" (${money(cost.amount)})?`)) return;
    try {
      await apiRequest(`/api/campaigns/costs/${cost.id}`, { method: 'DELETE', token });
      onChanged?.();
    } catch (err) {
      setError(err.message || 'No se pudo eliminar');
    }
  };

  const costs = investment?.costs || [];
  const invested = investment?.invested || 0;
  const expected = investment?.expected_return;

  return (
    <div className="invbox">
      <div className="invbox-head">
        <span className="invbox-title">💰 Inversión: <strong>{money(invested)}</strong></span>
        {expected !== null && expected !== undefined && (
          <span className="invbox-expected">Camino al retorno: <strong>{money(expected)}</strong></span>
        )}
      </div>
      {costs.length > 0 && (
        <ul className="invbox-items">
          {costs.map((cost) => (
            <li key={cost.id}>
              <span>{cost.concept}</span>
              <span className="invbox-amount">{money(cost.amount)}</span>
              <button type="button" title="Quitar" onClick={() => removeCost(cost)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="invbox-add">
        <input
          type="text" maxLength={160} placeholder="Concepto (ej: pauta, premios, flete…)"
          value={concept} onChange={(e) => setConcept(e.target.value)}
        />
        <input
          type="number" min="0" step="0.5" placeholder="Bs"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addCost(); }}
        />
        <button type="button" disabled={busy || !concept.trim() || amount === ''} onClick={addCost}>+</button>
      </div>
      {error && <div className="invbox-error">{error}</div>}
    </div>
  );
}
