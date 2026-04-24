// src/AdminDashboard.jsx
import { useState, useEffect } from 'react';
import { apiRequest } from './apiClient';
import boliviaAdminMapSvg from './assets/bolivia-admin1.svg?raw';

const BOLIVIA_DEPARTMENT_MAP = {
  'la paz': 'La Paz',
  'santa cruz': 'Santa Cruz',
  cochabamba: 'Cochabamba',
  potosi: 'Potosí',
  potosí: 'Potosí',
  tarija: 'Tarija',
  oruro: 'Oruro',
  beni: 'Beni',
  'el beni': 'Beni',
  pando: 'Pando',
  chuquisaca: 'Chuquisaca'
};

const BOLIVIA_MAP_CODE_TO_DEPARTMENT = {
  BOB: 'Beni',
  BOC: 'Cochabamba',
  BOH: 'Chuquisaca',
  BOL: 'La Paz',
  BON: 'Pando',
  BOO: 'Oruro',
  BOP: 'Potosí',
  BOS: 'Santa Cruz',
  BOT: 'Tarija'
};

const BOLIVIA_DEPARTMENT_SHORT_LABEL = {
  BOB: 'BEN',
  BOC: 'CBB',
  BOH: 'CHQ',
  BOL: 'LPZ',
  BON: 'PAN',
  BOO: 'ORU',
  BOP: 'POT',
  BOS: 'SCZ',
  BOT: 'TJA'
};

const BOLIVIA_LABEL_OFFSETS = {
  BOB: { dx: 10, dy: -28 },
  BOC: { dx: 26, dy: 8 },
  BOH: { dx: 24, dy: 16 },
  BOL: { dx: -28, dy: -14 },
  BON: { dx: 0, dy: -30 },
  BOO: { dx: -32, dy: 0 },
  BOP: { dx: -36, dy: 16 },
  BOS: { dx: 42, dy: 18 },
  BOT: { dx: 18, dy: 30 }
};

const buildBoliviaMapFeatures = () => {
  const pathRegex = /<path d="([^"]+)" id="([^"]+)" name="([^"]+)">/g;
  const labelRegex = /<circle class="([^"]+)" cx="([^"]+)" cy="([^"]+)" id="([^"]+)">/g;
  const features = [];
  const labelById = new Map();
  let match;

  while ((match = labelRegex.exec(boliviaAdminMapSvg)) !== null) {
    const [, mapLabel, cx, cy, id] = match;
    labelById.set(id, {
      labelName: mapLabel,
      labelX: Number(cx),
      labelY: Number(cy)
    });
  }

  while ((match = pathRegex.exec(boliviaAdminMapSvg)) !== null) {
    const [, path, id, fallbackName] = match;
    if (!BOLIVIA_MAP_CODE_TO_DEPARTMENT[id]) {
      continue;
    }

    const labelPoint = labelById.get(id) || {};
    features.push({
      id,
      department: BOLIVIA_MAP_CODE_TO_DEPARTMENT[id] || fallbackName,
      shortLabel: BOLIVIA_DEPARTMENT_SHORT_LABEL[id] || fallbackName,
      path,
      labelX: Number(labelPoint.labelX || 500),
      labelY: Number(labelPoint.labelY || 500)
    });
  }

  return features;
};

const BOLIVIA_MAP_FEATURES = buildBoliviaMapFeatures();

const getNiceAxisMax = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
};

const getDepartmentFillColor = (ratio, hasSales) => {
  if (!hasSales) {
    return 'rgba(30, 41, 59, 0.78)';
  }
  const t = Math.max(0, Math.min(1, ratio));
  const start = { r: 30, g: 64, b: 175 };
  const end = { r: 249, g: 115, b: 22 };
  const r = Math.round(start.r + (end.r - start.r) * t);
  const g = Math.round(start.g + (end.g - start.g) * t);
  const b = Math.round(start.b + (end.b - start.b) * t);
  return `rgb(${r} ${g} ${b})`;
};

const normalizeText = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

function AdminDashboard({ token }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  useEffect(() => {
    fetchStats();
  }, [selectedMonth, selectedYear, token]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await apiRequest(`/api/admin/stats?month=${selectedMonth}&year=${selectedYear}`, { token });
      setStats(data);
    } catch (err) {
      console.error(err);
      alert('No se pudieron cargar las estadísticas');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#94a3b8' }}>Cargando panel...</div>;
  if (!stats) return <div style={{ textAlign: 'center', padding: '50px', color: '#f87171' }}>No hay datos disponibles</div>;

  const popularProducts = Array.isArray(stats.popularProducts) ? stats.popularProducts : [];
  const topSalespeople = Array.isArray(stats.topSalespeople) ? stats.topSalespeople : [];
  const topLocations = Array.isArray(stats.topLocations) ? stats.topLocations : [];
  const topWarehouses = Array.isArray(stats.topWarehouses) ? stats.topWarehouses : [];
  const dailySalesSeries = Array.isArray(stats.dailySalesSeries) ? stats.dailySalesSeries : [];
  const salesByDepartment = Array.isArray(stats.salesByDepartment) ? stats.salesByDepartment : [];
  const activeUserCommissions = Array.isArray(stats.activeUserCommissions)
    ? stats.activeUserCommissions
    : (Array.isArray(stats.commissionPayout?.rows) ? stats.commissionPayout.rows : []);
  const totalCommissionsToDate = Number(
    stats.totalCommissionToDate
    ?? stats.totalCommissionsToDate
    ?? stats.commissionPayout?.total
    ?? 0
  );
  const maxQty = Math.max(...popularProducts.map((p) => Number(p.total_quantity || 0)), 1);
  const maxSales = Math.max(...topSalespeople.map((seller) => Number(seller.total_sales || 0)), 1);
  const maxWarehouseSales = Math.max(...topWarehouses.map((warehouse) => Number(warehouse.total_sales || 0)), 1);
  const monthDaysCount = new Date(selectedYear, selectedMonth, 0).getDate();
  const byDayMap = new Map(
    dailySalesSeries.map((item) => [Number(item.day || item.day_num || 0), Number(item.total_sales || 0)])
  );
  const fullDailySalesSeries = Array.from({ length: monthDaysCount }, (_, idx) => {
    const day = idx + 1;
    return {
      day_num: day,
      period_day: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      total_sales: byDayMap.get(day) || 0
    };
  });
  const maxDailySales = Math.max(...fullDailySalesSeries.map((item) => Number(item.total_sales || 0)), 1);
  const yAxisMax = getNiceAxisMax(maxDailySales);
  const formatAxisValue = (value) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${Math.round(value / 1000)}k`;
    return `${Math.round(value)}`;
  };
  const formatCompactBs = (value) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${Math.round(value / 1000)}k`;
    return `${Math.round(value)}`;
  };
  const commissionRows = [...activeUserCommissions]
    .map((row, index) => ({
      ...row,
      rowKey: row.user_id || row.id || row.email || `commission-${index}`
    }))
    .sort((a, b) => Number(b.commission || 0) - Number(a.commission || 0));
  const formatBs = (value) => `${Number(value || 0).toFixed(2)} Bs`;
  const departmentSalesMap = salesByDepartment.reduce((acc, row) => {
    const sourceDepartment = String(row.department || '').trim();
    const normalizedDepartment = normalizeText(sourceDepartment);
    const canonicalDepartment = BOLIVIA_DEPARTMENT_MAP[normalizedDepartment] || sourceDepartment;
    acc[canonicalDepartment] = Number(row.total_sales || 0);
    return acc;
  }, {});
  const maxDepartmentSales = Math.max(...Object.values(departmentSalesMap), 1);
  const mapFeatureRows = BOLIVIA_MAP_FEATURES.map((feature) => {
    const totalSales = Number(departmentSalesMap[feature.department] || 0);
    const ratio = maxDepartmentSales > 0 ? Math.min(1, totalSales / maxDepartmentSales) : 0;
    const offset = BOLIVIA_LABEL_OFFSETS[feature.id] || { dx: 0, dy: 0 };
    return {
      ...feature,
      totalSales,
      ratio,
      anchorX: feature.labelX,
      anchorY: feature.labelY,
      labelX: feature.labelX + offset.dx,
      labelY: feature.labelY + offset.dy
    };
  });
  const mapRankingRows = [...mapFeatureRows]
    .sort((a, b) => b.totalSales - a.totalSales);

  const chartWidth = 760;
  const chartHeight = 320;
  const chartPad = { top: 24, right: 20, bottom: 52, left: 74 };
  const plotWidth = chartWidth - chartPad.left - chartPad.right;
  const plotHeight = chartHeight - chartPad.top - chartPad.bottom;
  const safeYMax = Math.max(yAxisMax, 1);
  const xForDay = (day) => (
    chartPad.left + ((day - 1) / Math.max(monthDaysCount - 1, 1)) * plotWidth
  );
  const yForValue = (value) => (
    chartPad.top + (1 - (Math.max(0, Number(value || 0)) / safeYMax)) * plotHeight
  );
  const lineChartPoints = fullDailySalesSeries.map((item) => ({
    ...item,
    x: xForDay(item.day_num),
    y: yForValue(item.total_sales)
  }));
  const linePath = lineChartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const yTickValues = [0, 0.25, 0.5, 0.75, 1].map((step) => Number((safeYMax * step).toFixed(2)));
  const xTickDays = Array.from({ length: monthDaysCount }, (_, i) => i + 1)
    .filter((day) => day === 1 || day === monthDaysCount || day % 5 === 0);

  return (
    <div className="dashboard-workspace">
      <div className="admin-hero-card">
        <p style={{ margin: 0, color: '#ff7f30', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Dashboard
        </p>
      </div>

      <section className="dashboard-filter-card">
        <h3>Panel de Estadísticas</h3>
        <div className="dashboard-filter-row">
          <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(0, m - 1).toLocaleString('es-BO', { month: 'long' })}
              </option>
            ))}
          </select>

          <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="dashboard-filter-hint">Periodo visualizado</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <h3>Productos Más Vendidos (Cantidad)</h3>
          {popularProducts.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <div className="dashboard-bars">
              {popularProducts.map((product) => {
                const totalQuantity = Number(product.total_quantity || 0);
                return (
                  <div key={product.sku} className="dashboard-bar-row">
                    <div className="dashboard-bar-label">{product.name}</div>
                    <div className="dashboard-bar-track">
                      <div
                        className="dashboard-bar-fill"
                        style={{ width: `${Math.min(100, (totalQuantity / maxQty) * 100)}%` }}
                      />
                    </div>
                    <div className="dashboard-bar-value">{totalQuantity}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="dashboard-card">
          <h3>Ranking Vendedores</h3>
          {topSalespeople.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <ol className="dashboard-list dashboard-list-bars">
              {topSalespeople.map((seller, index) => (
                <li key={`${seller.vendor}-${index}`}>
                  <div className="dashboard-list-bar-head">
                    <strong>{seller.vendor}</strong>
                    <span>{seller.order_count} pedidos · {formatBs(seller.total_sales)}</span>
                  </div>
                  <div className="dashboard-bar-track">
                    <div
                      className="dashboard-bar-fill"
                      style={{ width: `${Math.min(100, (Number(seller.total_sales || 0) / maxSales) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="dashboard-card">
          <h3>Ranking Departamentos / Provincias</h3>
          {topLocations.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <ol className="dashboard-list">
              {topLocations.map((location, index) => (
                <li key={`${location.location}-${index}`}>
                  <strong>{location.location}</strong> — {formatBs(location.total_sales)}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="dashboard-card dashboard-map-card">
          <h3>Mapa de Bolivia · Ventas por departamento</h3>
          <div className="dashboard-map-wrap">
            <div className="dashboard-bolivia-map">
              <svg
                viewBox="40 20 920 950"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Mapa geográfico de Bolivia por ventas"
                className="dashboard-bolivia-map-svg"
              >
                {mapFeatureRows.map((region) => {
                  const fillColor = getDepartmentFillColor(region.ratio, region.totalSales > 0);
                  return (
                    <g key={region.id}>
                      <path
                        className="dashboard-map-region"
                        d={region.path}
                        style={{ fill: fillColor }}
                      />
                      <line
                        x1={region.anchorX}
                        y1={region.anchorY}
                        x2={region.labelX}
                        y2={region.labelY}
                        className="dashboard-map-label-leader"
                      />
                      <text x={region.labelX} y={region.labelY} className="dashboard-map-region-label">
                        {region.shortLabel}
                      </text>
                      <text x={region.labelX} y={region.labelY + 14} className="dashboard-map-region-value">
                        {formatCompactBs(region.totalSales)} Bs
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="dashboard-map-ranking">
              {mapRankingRows.map((row) => (
                <div key={row.id} className="dashboard-map-ranking-row">
                  <strong>{row.department}</strong>
                  <span>{formatBs(row.totalSales)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="dashboard-map-legend">
            <span className="dashboard-map-legend-label">Menor venta</span>
            <span className="dashboard-map-legend-gradient" />
            <span className="dashboard-map-legend-label">Mayor venta</span>
          </div>
        </section>

        <section className="dashboard-card dashboard-line-card">
          <h3>Línea diaria · Ventas del mes</h3>
          <div className="dashboard-line-wrap">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className="dashboard-line-svg"
              role="img"
              aria-label="Línea de ventas por día del mes"
            >
              {yTickValues.map((tickValue) => {
                const y = yForValue(tickValue);
                return (
                  <g key={`y-tick-${tickValue}`}>
                    <line
                      x1={chartPad.left}
                      y1={y}
                      x2={chartWidth - chartPad.right}
                      y2={y}
                      className="dashboard-line-grid"
                    />
                    <text x={chartPad.left - 10} y={y + 4} className="dashboard-line-tick dashboard-line-y-tick">
                      {formatAxisValue(tickValue)}
                    </text>
                  </g>
                );
              })}

              <line
                x1={chartPad.left}
                y1={chartPad.top}
                x2={chartPad.left}
                y2={chartHeight - chartPad.bottom}
                className="dashboard-line-axis"
              />
              <line
                x1={chartPad.left}
                y1={chartHeight - chartPad.bottom}
                x2={chartWidth - chartPad.right}
                y2={chartHeight - chartPad.bottom}
                className="dashboard-line-axis"
              />

              {linePath ? <path d={linePath} className="dashboard-line-path" /> : null}
              {lineChartPoints.map((point) => (
                <circle key={point.day_num} cx={point.x} cy={point.y} r="3.2" className="dashboard-line-point" />
              ))}

              {xTickDays.map((day) => (
                <text
                  key={`x-tick-${day}`}
                  x={xForDay(day)}
                  y={chartHeight - chartPad.bottom + 22}
                  textAnchor="middle"
                  className="dashboard-line-tick"
                >
                  {day}
                </text>
              ))}

              <text
                x={chartPad.left + (plotWidth / 2)}
                y={chartHeight - 8}
                textAnchor="middle"
                className="dashboard-line-axis-title"
              >
                Día del mes
              </text>
              <text
                x={22}
                y={chartPad.top + (plotHeight / 2)}
                textAnchor="middle"
                className="dashboard-line-axis-title"
                transform={`rotate(-90 22 ${chartPad.top + (plotHeight / 2)})`}
              >
                Total ventas (Bs)
              </text>
            </svg>
          </div>
        </section>

        <section className="dashboard-card">
          <h3>Ranking Almacenes (Tráfico)</h3>
          {topWarehouses.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <ol className="dashboard-list dashboard-list-bars">
              {topWarehouses.map((warehouse, index) => (
                <li key={`${warehouse.store_location}-${index}`}>
                  <div className="dashboard-list-bar-head">
                    <strong>{warehouse.store_location}</strong>
                    <span>{warehouse.order_count} pedidos · {formatBs(warehouse.total_sales)}</span>
                  </div>
                  <div className="dashboard-bar-track">
                    <div
                      className="dashboard-bar-fill"
                      style={{ width: `${Math.min(100, (Number(warehouse.total_sales || 0) / maxWarehouseSales) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="dashboard-card dashboard-card-wide">
          <div className="dashboard-commission-header">
            <h3>Comisiones por Usuario Activo</h3>
            <div className="dashboard-commission-total">
              Total por pagar: <strong>{formatBs(totalCommissionsToDate)}</strong>
            </div>
          </div>
          {commissionRows.length === 0 ? (
            <p className="dashboard-empty">No hay usuarios activos con comisión para el periodo</p>
          ) : (
            <div className="dashboard-commission-table">
              {commissionRows.map((row) => {
                const displayName = String(row.user_label || '').trim()
                  || String(row.display_name || '').trim()
                  || String(row.email || '').split('@')[0];
                return (
                  <div key={row.rowKey} className="dashboard-commission-row">
                    <div>
                      <strong>{displayName}</strong>
                      <span>{row.role || 'Sin rol'}</span>
                    </div>
                    <div>{formatBs(row.commission)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default AdminDashboard;