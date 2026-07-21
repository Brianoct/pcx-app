import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from './apiClient';
import InvestmentBox from './InvestmentBox';
import { formatCampaignDate } from './campaignShared';

// Inversión (piloto Marketing) — no es un presupuesto. Cada campaña y live
// declara cuánto se invierte y cuál es el camino al retorno; esta página
// mide el retorno REAL: ventas de la ventana vs. la línea base (promedio
// diario de los 30 días previos) → ventas extra y múltiplo.

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;

const PHASE_META = {
  pendiente: { label: 'Pendiente', className: 'is-pendiente' },
  en_curso: { label: 'En curso', className: 'is-encurso' },
  cerrada: { label: 'Cerrada', className: 'is-cerrada' }
};

const multipleClass = (multiple) => {
  if (multiple === null || multiple === undefined) return '';
  if (multiple >= 1) return 'is-good';
  if (multiple >= 0) return 'is-mid';
  return 'is-bad';
};

export default function InversionPanel({ token }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiRequest('/api/campaigns/investment', { token })
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message || 'No se pudo cargar'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="container prod-page"><p className="dashboard-muted">Cargando inversión…</p></div>;

  const items = data?.items || [];
  const totals = data?.totals;
  const withMoney = items.filter((item) => item.invested > 0);

  return (
    <div className="container prod-page">
      <div className="card plan-intro">
        <h2 className="plan-title">Inversión</h2>
        <p className="plan-sub">
          Esto <strong>no es un presupuesto</strong>: cada peso invertido en una campaña o live
          debe tener un camino claro de retorno. Aquí se compara lo invertido contra las
          <strong> ventas extra</strong> que generó (ventas de la ventana menos la línea base
          de los 30 días previos). Lo que se paga solo, se repite; lo que no, se corta.
        </p>
      </div>

      {error && <div className="camp-error">{error}</div>}

      {totals && (
        <div className="pipe-forecast">
          <div className="pipe-fbox">
            <b>{money(totals.invested)}</b>
            <span>Invertido total</span>
          </div>
          <div className="pipe-fbox">
            <b>{money(totals.extra_sales)}</b>
            <span>Ventas extra generadas</span>
          </div>
          <div className={`pipe-fbox ${totals.multiple !== null && totals.multiple >= 1 ? '' : 'is-risk'}`}>
            <b>{totals.multiple === null ? '—' : `${totals.multiple}x`}</b>
            <span>Múltiplo global</span>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card camp-empty">
          Aún no hay campañas ni lives. Crea una en Campañas o Live y registra su inversión aquí.
        </div>
      )}

      {withMoney.length === 0 && items.length > 0 && (
        <div className="card camp-empty">
          Ninguna campaña o live tiene inversión registrada todavía. Agrega los ítems de costo
          en la tarjeta de cada una (abajo) para empezar a medir el retorno.
        </div>
      )}

      {items.map((item) => {
        const phase = PHASE_META[item.phase] || PHASE_META.pendiente;
        const showResults = item.phase !== 'pendiente';
        return (
          <div key={item.id} className="inv-card">
            <div className="inv-card-head">
              <div className="inv-card-title">
                <span className={`inv-kind ${item.kind === 'live' ? 'is-live' : ''}`}>
                  {item.kind === 'live' ? '🔴 Live' : '📣 Campaña'}
                </span>
                <button type="button" className="inv-name" onClick={() => navigate(item.kind === 'live' ? '/live' : '/campanas')}>
                  {item.name}
                </button>
                <span className={`inv-phase ${phase.className}`}>{phase.label}</span>
              </div>
              <span className="inv-dates">
                {formatCampaignDate(item.start_date)}
                {item.kind === 'live'
                  ? `${item.live_time ? ` · ${item.live_time}` : ''} (ventana ${item.window_days} días)`
                  : ` — ${formatCampaignDate(item.end_date)}`}
              </span>
            </div>

            <div className="inv-metrics">
              <div className="inv-metric">
                <span>Invertido</span>
                <b>{money(item.invested)}</b>
              </div>
              <div className="inv-metric">
                <span>Retorno esperado</span>
                <b>{item.expected_return === null ? '—' : money(item.expected_return)}</b>
              </div>
              <div className="inv-metric">
                <span>Ventas en ventana</span>
                <b>{showResults ? `${money(item.window_sales)}` : '—'}</b>
                {showResults && <small>{item.window_orders} pedidos</small>}
              </div>
              <div className="inv-metric">
                <span>Línea base</span>
                <b>{showResults ? money(item.baseline_sales) : '—'}</b>
                {showResults && <small>prom. 30 días × {item.window_days}d</small>}
              </div>
              <div className="inv-metric">
                <span>Ventas extra</span>
                <b className={showResults && item.extra_sales >= 0 ? 'is-good-text' : ''}>
                  {showResults ? money(item.extra_sales) : '—'}
                </b>
              </div>
              <div className={`inv-metric inv-multiple ${multipleClass(showResults ? item.multiple : null)}`}>
                <span>Múltiplo</span>
                <b>{showResults && item.multiple !== null ? `${item.multiple}x` : '—'}</b>
                {item.phase === 'cerrada' && item.multiple !== null && (
                  <small>{item.multiple >= 1 ? '✓ Se pagó sola' : '✗ No se pagó'}</small>
                )}
              </div>
            </div>

            <InvestmentBox token={token} campaignId={item.id} investment={item} onChanged={load} />
          </div>
        );
      })}

      {items.length > 0 && (
        <p className="pipe-hint">
          <strong>Cómo se mide:</strong> ventas extra = ventas cobradas durante la ventana
          (campaña: sus fechas · live: su día + 2) menos lo que normalmente se vendería
          (promedio diario de los 30 días previos × días de la ventana). Múltiplo = ventas
          extra ÷ invertido. Es una aproximación honesta, no contabilidad exacta.
        </p>
      )}
    </div>
  );
}
