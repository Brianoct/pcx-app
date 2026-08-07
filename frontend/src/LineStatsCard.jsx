import { useEffect, useState } from 'react';
import { apiRequest } from './apiClient';

// Colores de serie validados (contraste y visión de color): la identidad de
// cada línea vive SOLO en la marca de color; el texto usa tinta normal.
const LINE_COLOR = { acero: '#2a78d6', armonia: '#eb6834' };
const LINE_LABEL = { acero: 'Acero', armonia: 'Armonía' };
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const formatBs = (value) => `${Number(value || 0).toLocaleString('es-BO', { maximumFractionDigits: 0 })} Bs`;
const formatCompact = (value) => {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toLocaleString('es-BO', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('es-BO', { maximumFractionDigits: 0 });
};
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MES_CORTO[m - 1]} ${String(y).slice(2)}`;
};

// Barra con la punta redondeada SOLO en el extremo del dato (la base queda
// recta, anclada a la línea base).
const roundedTopPath = (x, y, w, h) => {
  const r = Math.min(4, w / 2, h);
  return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
};

// Gráfico de barras agrupadas (6 meses × 2 líneas) en SVG puro.
function MonthlyBars({ months }) {
  const W = 560;
  const H = 190;
  const padL = 44;
  const padR = 8;
  const padT = 18;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...months.flatMap((m) => [m.acero.revenue, m.armonia.revenue]));
  // Techo "redondo": el siguiente escalón 1/2/4/5/10×magnitud, para que la
  // guía intermedia también caiga en un valor legible.
  const mag = 10 ** Math.floor(Math.log10(maxVal));
  const ceilTo = [1, 2, 4, 5, 10].map((k) => k * mag).find((v) => v >= maxVal) || maxVal;
  const yOf = (v) => padT + plotH - (v / ceilTo) * plotH;

  const groupW = plotW / months.length;
  const barW = Math.min(16, (groupW - 20) / 2 - 1);
  const lastIdx = months.length - 1;
  const barGeom = (m, line, x) => {
    const v = m[line].revenue;
    const h = v > 0 ? Math.max(2, (v / ceilTo) * plotH) : 0;
    return { v, h, x, top: padT + plotH - h };
  };

  return (
    <svg className="ls-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas mensuales por línea de producto">
      {[0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={W - padR} y1={yOf(ceilTo * f)} y2={yOf(ceilTo * f)} className="ls-grid" />
          <text x={padL - 6} y={yOf(ceilTo * f) + 3} className="ls-tick" textAnchor="end">{formatCompact(ceilTo * f)}</text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} className="ls-baseline" />
      {months.map((m, i) => {
        const cx = padL + groupW * i + groupW / 2;
        // 2px de separación entre las dos barras del grupo.
        const geoms = {
          acero: barGeom(m, 'acero', cx - barW - 1),
          armonia: barGeom(m, 'armonia', cx + 1)
        };
        // Etiqueta directa solo en el mes elegido; si las dos puntas quedan a
        // la misma altura las etiquetas chocarían — se etiqueta solo la mayor.
        const labelBoth = Math.abs(geoms.acero.top - geoms.armonia.top) >= 14;
        const taller = geoms.acero.h >= geoms.armonia.h ? 'acero' : 'armonia';
        return (
          <g key={m.ym}>
            {['acero', 'armonia'].map((line) => geoms[line].h > 0 && (
              <path key={line} d={roundedTopPath(geoms[line].x, geoms[line].top, barW, geoms[line].h)} fill={LINE_COLOR[line]} className="ls-bar">
                <title>{`${LINE_LABEL[line]} · ${monthLabel(m.ym)}: ${formatBs(geoms[line].v)} · ${m[line].units} uds`}</title>
              </path>
            ))}
            {i === lastIdx && ['acero', 'armonia'].map((line) => geoms[line].v > 0 && (labelBoth || line === taller) && (
              <text key={`l-${line}`} x={geoms[line].x + barW / 2} y={geoms[line].top - 5} className="ls-bar-label" textAnchor="middle">
                {formatCompact(geoms[line].v)}
              </text>
            ))}
            <text x={cx} y={H - 8} className="ls-tick" textAnchor="middle">{monthLabel(m.ym)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Comparativa de ventas Acero vs Armonía: participación del mes elegido y
// evolución de los últimos 6 meses. Mismo mes/año que el resto de Estadísticas.
export default function LineStatsCard({ token, month, year }) {
  // El resultado viaja con su clave mes-año: "cargando" se deriva de que la
  // clave pedida aún no llegó (sin setState síncrono dentro del efecto).
  const [result, setResult] = useState(null);
  const periodKey = `${month}-${year}`;

  useEffect(() => {
    let active = true;
    apiRequest(`/api/admin/line-stats?month=${month}&year=${year}`, { token, timeoutMs: 30000 })
      .then((res) => { if (active) setResult({ key: `${month}-${year}`, data: res }); })
      .catch((err) => { if (active) setResult({ key: `${month}-${year}`, error: err.message || 'No se pudo calcular las ventas por línea' }); });
    return () => { active = false; };
  }, [token, month, year]);

  const loading = !result || result.key !== periodKey;
  const data = !loading ? result.data || null : null;
  const error = !loading ? result.error || '' : '';
  const sel = data?.selected;
  const hasSales = sel && sel.total_revenue > 0;

  return (
    <section className="card dashboard-card ls-card">
      <div className="dashboard-card-head">
        <h3>📊 Ventas por línea · Acero vs Armonía</h3>
        <div className="ls-legend" aria-hidden="true">
          {['acero', 'armonia'].map((line) => (
            <span key={line} className="ls-legend-item">
              <span className="ls-dot" style={{ background: LINE_COLOR[line] }} />
              {LINE_LABEL[line]}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="dashboard-muted">Calculando ventas por línea…</p>
      ) : error ? (
        <p className="dashboard-muted">{error}</p>
      ) : (
        <>
          <div className="ls-tiles">
            {['acero', 'armonia'].map((line) => {
              const info = sel[line];
              return (
                <div key={line} className="ls-tile">
                  <span className="ls-tile-name">
                    <span className="ls-dot" style={{ background: LINE_COLOR[line] }} />
                    {LINE_LABEL[line]}
                  </span>
                  <strong className="ls-tile-value">{formatBs(info.revenue)}</strong>
                  <span className="ls-tile-detail">
                    {Number(info.units).toLocaleString('es-BO')} uds
                    {info.share_pct !== null ? ` · ${info.share_pct}% del mes` : ''}
                  </span>
                  {info.top.length > 0 && (
                    <ul className="ls-top">
                      {info.top.map((p) => (
                        <li key={p.key} title={`${p.name}: ${formatBs(p.revenue)} · ${p.units} uds`}>
                          {p.name} <em>{formatCompact(p.revenue)}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {hasSales ? (
            <div className="ls-share" role="img" aria-label={`Participación del mes: Acero ${sel.acero.share_pct}%, Armonía ${sel.armonia.share_pct}%`}>
              <div className="ls-share-bar">
                {['acero', 'armonia'].map((line) => (
                  sel[line].share_pct > 0 && (
                    <span
                      key={line}
                      className="ls-share-seg"
                      style={{ width: `${sel[line].share_pct}%`, background: LINE_COLOR[line] }}
                      title={`${LINE_LABEL[line]}: ${formatBs(sel[line].revenue)} (${sel[line].share_pct}%)`}
                    />
                  )
                ))}
              </div>
              <div className="ls-share-labels">
                <span>Acero {sel.acero.share_pct}%</span>
                <span>Armonía {sel.armonia.share_pct}%</span>
              </div>
            </div>
          ) : (
            <p className="dashboard-muted">Sin ventas cerradas en el mes elegido.</p>
          )}

          <div className="ls-chart-wrap">
            <MonthlyBars months={data.months} />
          </div>

          <div className="ls-table-wrap">
            <table className="ls-table">
              <thead>
                <tr><th>Mes</th><th>Acero</th><th>Armonía</th><th>Total</th></tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.ym} className={m.ym === sel.ym ? 'is-selected' : ''}>
                    <td>{monthLabel(m.ym)}</td>
                    <td>{formatBs(m.acero.revenue)}</td>
                    <td>{formatBs(m.armonia.revenue)}</td>
                    <td>{formatBs(m.acero.revenue + m.armonia.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
