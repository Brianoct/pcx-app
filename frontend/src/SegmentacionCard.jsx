import { useEffect, useState } from 'react';
import { apiRequest } from './apiClient';

// Ventas por uso (dónde se usará el tablero) y por origen (cómo nos conoció).
// Sigue el mes del selector de Estadísticas o, con su propio control, los
// últimos 12 meses o un rango de fechas.
const formatBs = (value) => `${Number(value || 0).toLocaleString('es-BO', { maximumFractionDigits: 0 })} Bs`;
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function BarList({ rows, total, emptyText }) {
  if (!rows.length) return <p className="dashboard-empty">{emptyText}</p>;
  const max = Math.max(1, ...rows.map((r) => r.total_sales));
  return (
    <ol className="dashboard-list dashboard-list-bars seg-list">
      {rows.map((r) => (
        <li key={r.key} className={r.key === 'sin_dato' ? 'is-sin-dato' : ''}>
          <div className="dashboard-list-bar-head">
            <strong>{r.label}</strong>
            <span>{formatBs(r.total_sales)} · {r.pct}%</span>
          </div>
          <div className="dashboard-bar-track">
            <div className="dashboard-bar-fill" style={{ width: `${Math.min(100, (r.total_sales / max) * 100)}%` }} />
          </div>
          <small className="seg-meta">{r.order_count} pedido{r.order_count === 1 ? '' : 's'} · {Math.round(r.units)} unidad{Math.round(r.units) === 1 ? '' : 'es'}</small>
        </li>
      ))}
      {total > 0 && <li className="seg-total"><span>Total del periodo</span><strong>{formatBs(total)}</strong></li>}
    </ol>
  );
}

export default function SegmentacionCard({ token, month, year }) {
  const [mode, setMode] = useState('mes'); // mes | 12m | rango
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Resultado etiquetado con la consulta que lo produjo: «cargando» es
  // simplemente que el dato guardado no corresponde a la consulta actual.
  const [result, setResult] = useState(null);

  const params = new URLSearchParams();
  if (mode === 'mes') { params.set('month', String(month)); params.set('year', String(year)); }
  else if (mode === '12m') params.set('range', '12m');
  else { if (from) params.set('from', from); if (to) params.set('to', to); }
  const queryKey = mode === 'rango' && !from && !to ? '' : params.toString();

  useEffect(() => {
    if (!token || !queryKey) return undefined;
    let active = true;
    apiRequest(`/api/admin/stats/segmentacion?${queryKey}`, { token })
      .then((res) => { if (active) setResult({ key: queryKey, data: res, error: '' }); })
      .catch((err) => { if (active) setResult({ key: queryKey, data: null, error: err.message || 'No se pudo cargar' }); });
    return () => { active = false; };
  }, [token, queryKey]);

  const current = result && result.key === queryKey ? result : null;
  const data = current?.data || null;
  const error = current?.error || '';
  const loading = Boolean(queryKey) && !current;

  const periodLabel = mode === 'mes'
    ? `${MES_LARGO[month - 1]} ${year}`
    : mode === '12m' ? 'últimos 12 meses' : `${from || '…'} → ${to || '…'}`;

  return (
    <section className="dashboard-card dashboard-card-wide accent-clientes seg-card">
      <div className="seg-head">
        <div>
          <h3>Ventas por uso y por origen</h3>
          <p className="seg-sub">Dónde se usará el tablero y cómo nos conoció el cliente · {periodLabel}{data ? ` · ${formatBs(data.total.total_sales)} en ${data.total.order_count} pedidos` : ''}</p>
        </div>
        <div className="seg-period" role="tablist" aria-label="Periodo">
          <button type="button" className={`dashboard-group-tab${mode === 'mes' ? ' is-active' : ''}`} onClick={() => setMode('mes')}>Mes del selector</button>
          <button type="button" className={`dashboard-group-tab${mode === '12m' ? ' is-active' : ''}`} onClick={() => setMode('12m')}>Últimos 12 meses</button>
          <button type="button" className={`dashboard-group-tab${mode === 'rango' ? ' is-active' : ''}`} onClick={() => setMode('rango')}>Rango</button>
          {mode === 'rango' && (
            <span className="seg-range">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
              <span>→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
            </span>
          )}
        </div>
      </div>
      {error && <p className="dashboard-empty">{error}</p>}
      {mode === 'rango' && !from && !to && <p className="dashboard-empty">Elige una fecha «desde» o «hasta».</p>}
      {loading && !data && <p className="dashboard-empty">Calculando…</p>}
      {data && (
        <div className="seg-cols">
          <div>
            <h4 className="seg-col-title">Por uso</h4>
            <BarList rows={data.by_uso} total={data.total.total_sales} emptyText="Sin ventas en el periodo" />
          </div>
          <div>
            <h4 className="seg-col-title">Por origen</h4>
            <BarList rows={data.by_origen} total={data.total.total_sales} emptyText="Sin ventas en el periodo" />
          </div>
        </div>
      )}
    </section>
  );
}
