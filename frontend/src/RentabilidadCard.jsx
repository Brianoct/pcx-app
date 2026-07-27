import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const formatBs = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')} Bs`;

const LINE_LABEL = { acero: 'Acero', armonia: 'Armonía' };
const TYPE_LABEL = { tablero: 'Tablero', accesorio: 'Accesorio', combo: 'Combo' };

// Semáforo del margen: sano / justo / bajo el agua.
const marginClass = (pct) => {
  if (pct === null || pct === undefined) return '';
  if (pct >= 40) return 'is-good';
  if (pct >= 20) return 'is-thin';
  return 'is-bad';
};

// Mini-sparkline del margen % (snapshots diarios del brief nocturno).
function Sparkline({ points }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const w = 72;
  const h = 20;
  const values = points.map((p) => p.pct);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg className="rent-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={rising ? '#047857' : '#b91c1c'}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Rentabilidad por producto: costo (Estructura, en vivo) vs precio vs ventas
// reales del período. Usa el mismo mes/año que el resto de Estadísticas.
export default function RentabilidadCard({ token, month, year }) {
  // El resultado viaja con su clave mes-año: "cargando" se deriva de que la
  // clave pedida aún no llegó (sin setState síncrono dentro del efecto).
  const [result, setResult] = useState(null);
  const [lineFilter, setLineFilter] = useState('todas');
  const [typeFilter, setTypeFilter] = useState('todos');
  const periodKey = `${month}-${year}`;

  useEffect(() => {
    let active = true;
    apiRequest(`/api/admin/rentabilidad?month=${month}&year=${year}`, { token, timeoutMs: 30000 })
      .then((res) => { if (active) setResult({ key: `${month}-${year}`, data: res }); })
      .catch((err) => { if (active) setResult({ key: `${month}-${year}`, error: err.message || 'No se pudo calcular la rentabilidad' }); });
    return () => { active = false; };
  }, [token, month, year]);

  const loading = !result || result.key !== periodKey;
  const data = !loading ? result.data || null : null;
  const error = !loading ? result.error || '' : '';

  const rows = useMemo(() => {
    if (!data) return [];
    const products = (data.products || []).filter((p) => {
      if (lineFilter !== 'todas' && String(p.product_line || '') !== lineFilter) return false;
      if (typeFilter === 'combo') return false;
      if (typeFilter !== 'todos' && String(p.product_type || '') !== typeFilter) return false;
      return true;
    });
    const combos = (data.combos || [])
      .filter(() => typeFilter === 'todos' || typeFilter === 'combo')
      .filter((c) => lineFilter === 'todas' || String(c.product_line || '') === lineFilter)
      .map((c) => ({ ...c, sku: `COMBO ${c.id}`, name: `${c.name} (Combo)`, cost_source: c.cost !== null ? 'estructura' : 'none', product_type: 'combo' }));
    // Lo que más plata deja arriba; lo vendido sin costeo también importa verlo.
    return [...products, ...combos].sort((a, b) => (b.est_profit ?? -1) - (a.est_profit ?? -1) || b.revenue - a.revenue);
  }, [data, lineFilter, typeFilter]);

  const totals = data?.totals || {};

  return (
    <section className="card dashboard-card rent-card">
      <div className="dashboard-card-head">
        <h3>💰 Rentabilidad por producto</h3>
        <div className="rent-filters">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="form-select rent-select">
            <option value="todos">Todos los tipos</option>
            <option value="tablero">Tableros</option>
            <option value="accesorio">Accesorios</option>
            <option value="combo">Combos</option>
          </select>
          <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} className="form-select rent-select">
            <option value="todas">Todas las líneas</option>
            <option value="acero">Acero</option>
            <option value="armonia">Armonía</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="dashboard-muted">Calculando márgenes…</p>
      ) : error ? (
        <p className="dashboard-muted">{error}</p>
      ) : (
        <>
          <div className="rent-summary">
            <span>Ventas: <strong>{formatBs(totals.revenue)}</strong></span>
            <span>Ganancia estimada: <strong className={Number(totals.est_profit) >= 0 ? 'rent-pos' : 'rent-neg'}>{formatBs(totals.est_profit)}</strong></span>
            {data?.commission_leader_pct !== undefined && (
              <span title="Liderazgo (5 roles × % del ingreso) + comisión del vendedor — el equipo cobra por comisión, no por hora">
                Comisiones: <strong>{Number(data.commission_leader_pct) + Number(data.commission_seller_pct)}% del precio</strong>
              </span>
            )}
            {(totals.sin_costeo > 0 || totals.costeo_manual > 0) && (
              <span className="rent-warn-note">
                {totals.sin_costeo > 0 && `${totals.sin_costeo} sin costeo`}
                {totals.sin_costeo > 0 && totals.costeo_manual > 0 && ' · '}
                {totals.costeo_manual > 0 && `${totals.costeo_manual} con costeo manual`}
              </span>
            )}
          </div>

          <div className="rent-table-wrap">
            <table className="rent-table">
              <thead>
                <tr>
                  <th className="rent-th-name">Producto</th>
                  <th>Costo</th>
                  <th>Precio SF</th>
                  <th>Margen</th>
                  <th>Tendencia</th>
                  <th>Vendidos</th>
                  <th>Ventas</th>
                  <th>Ganancia est.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sku}>
                    <td className="rent-td-name">
                      <strong>{row.name}</strong>
                      <span className="rent-sub">
                        {row.sku}
                        {row.product_line ? ` · ${LINE_LABEL[row.product_line] || row.product_line}` : ''}
                        {row.product_type && row.product_type !== 'combo' ? ` · ${TYPE_LABEL[row.product_type] || row.product_type}` : ''}
                      </span>
                    </td>
                    <td>
                      {row.cost !== null ? (
                        <span
                          title={row.cost_breakdown
                            ? `Materiales ${row.cost_breakdown.materials} · Equipos ${row.cost_breakdown.equipment} · Comisiones ${row.cost_breakdown.commissions}`
                            : 'Costeo manual + comisiones sobre el precio'}
                        >
                          {formatBs(row.cost)}
                          {row.cost_source === 'manual' && <em className="rent-flag" title="Costeo manual — completa la Estructura para el costo derivado"> manual</em>}
                          {row.real_cost !== null && row.real_cost !== undefined && (
                            <span
                              className={`rent-real ${row.real_delta_pct > 10 ? 'is-over' : ''}`}
                              title={`Costo con el consumo REAL medido por el muestreo (${row.real_samples} mediciones)`}
                            >
                              real {formatBs(row.real_cost)}{row.real_delta_pct !== 0 ? ` (${row.real_delta_pct > 0 ? '+' : ''}${row.real_delta_pct}%)` : ''}
                            </span>
                          )}
                        </span>
                      ) : (
                        <em className="rent-flag is-missing" title="Sin costeo: completa materiales en Admin → Estructura">sin costeo</em>
                      )}
                    </td>
                    <td>{formatBs(row.sf)}</td>
                    <td>
                      {row.margin_pct !== null ? (
                        <span className={`rent-margin ${marginClass(row.margin_pct)}`}>
                          {formatBs(row.margin)} · {row.margin_pct}%
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {Array.isArray(row.trend) && row.trend.length >= 2 ? (
                        <span className="rent-trend" title={`Margen % día a día (${row.trend.length} snapshots)`}>
                          <Sparkline points={row.trend} />
                          {row.trend_delta_pp !== null && row.trend_delta_pp !== undefined && (
                            <em className={row.trend_delta_pp >= 0 ? 'rent-pos' : 'rent-neg'}>
                              {row.trend_delta_pp > 0 ? '+' : ''}{row.trend_delta_pp} pp
                            </em>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td>{row.units_sold}</td>
                    <td>{formatBs(row.revenue)}</td>
                    <td>
                      {row.est_profit !== null
                        ? <strong className={row.est_profit >= 0 ? 'rent-pos' : 'rent-neg'}>{formatBs(row.est_profit)}</strong>
                        : '—'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="dashboard-muted" style={{ textAlign: 'center' }}>Sin productos para este filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
