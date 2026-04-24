// src/AdminDashboard.jsx
import { useState, useEffect } from 'react';
import { apiRequest } from './apiClient';

const BOLIVIA_DEPARTMENT_MAP = {
  'la paz': 'La Paz',
  'santa cruz': 'Santa Cruz',
  cochabamba: 'Cochabamba',
  potosi: 'Potosí',
  potosí: 'Potosí',
  tarija: 'Tarija',
  oruro: 'Oruro',
  beni: 'Beni',
  pando: 'Pando',
  chuquisaca: 'Chuquisaca'
};

const BOLIVIA_MAP_REGIONS = [
  {
    key: 'Pando',
    path: 'M12 18 L32 18 L30 34 L10 34 Z',
    labelX: 21,
    labelY: 24,
    valueY: 30
  },
  {
    key: 'Beni',
    path: 'M32 18 L58 18 L60 38 L42 44 L30 34 Z',
    labelX: 45,
    labelY: 27,
    valueY: 33
  },
  {
    key: 'La Paz',
    path: 'M10 34 L30 34 L31 48 L16 56 L8 46 Z',
    labelX: 20,
    labelY: 43,
    valueY: 49
  },
  {
    key: 'Cochabamba',
    path: 'M31 48 L42 44 L48 56 L34 61 L26 56 Z',
    labelX: 37,
    labelY: 53,
    valueY: 59
  },
  {
    key: 'Santa Cruz',
    path: 'M42 44 L72 42 L86 56 L80 74 L56 76 L48 56 Z',
    labelX: 66,
    labelY: 56,
    valueY: 62
  },
  {
    key: 'Oruro',
    path: 'M16 56 L26 56 L30 67 L19 73 L12 66 Z',
    labelX: 21,
    labelY: 63,
    valueY: 69
  },
  {
    key: 'Potosí',
    path: 'M19 73 L30 67 L38 76 L30 88 L20 86 Z',
    labelX: 28,
    labelY: 77,
    valueY: 83
  },
  {
    key: 'Chuquisaca',
    path: 'M38 76 L56 76 L52 90 L38 92 L30 88 Z',
    labelX: 44,
    labelY: 82,
    valueY: 88
  },
  {
    key: 'Tarija',
    path: 'M30 88 L38 92 L36 102 L28 106 L20 99 L20 86 Z',
    labelX: 29,
    labelY: 96,
    valueY: 102
  }
];

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
    dailySalesSeries.map((item) => [Number(item.day_num || 0), Number(item.total_sales || 0)])
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
  const lineChartPoints = fullDailySalesSeries.map((item, index) => {
    const chartWidth = 100;
    const chartHeight = 100;
    const leftPad = 6;
    const rightPad = 6;
    const topPad = 8;
    const bottomPad = 18;
    const drawableWidth = chartWidth - leftPad - rightPad;
    const drawableHeight = chartHeight - topPad - bottomPad;
    const x = fullDailySalesSeries.length === 1
      ? leftPad + drawableWidth / 2
      : leftPad + (index / (fullDailySalesSeries.length - 1)) * drawableWidth;
    const y = topPad + (1 - (Number(item.total_sales || 0) / maxDailySales)) * drawableHeight;
    return {
      ...item,
      x,
      y
    };
  });
  const linePath = lineChartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

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
              <svg viewBox="0 0 96 112" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa de Bolivia por ventas">
                {BOLIVIA_MAP_REGIONS.map((region) => {
                  const totalSales = Number(departmentSalesMap[region.key] || 0);
                  const ratio = Math.min(1, totalSales / maxDepartmentSales);
                  const fillColor = ratio <= 0
                    ? 'rgba(21, 36, 62, 0.9)'
                    : `rgba(248, 113, 113, ${(0.16 + ratio * 0.74).toFixed(2)})`;
                  return (
                    <g key={region.key}>
                      <path
                        className="dashboard-map-region"
                        d={region.path}
                        style={{ fill: fillColor }}
                      />
                      <text x={region.labelX} y={region.labelY} className="dashboard-map-region-label">
                        {region.key}
                      </text>
                      <text x={region.labelX} y={region.valueY} className="dashboard-map-region-value">
                        {Number(totalSales).toFixed(0)} Bs
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="dashboard-map-ranking">
              {Object.entries(departmentSalesMap)
                .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
                .map(([department, total]) => (
                  <div key={department} className="dashboard-map-ranking-row">
                    <strong>{department}</strong>
                    <span>{formatBs(total)}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="dashboard-map-legend">
            <span className="dashboard-map-legend-gradient" />
            Mayor intensidad = mayor volumen de ventas.
          </div>
          <p className="dashboard-empty" style={{ marginTop: '-2px' }}>
            Referencia geográfica esquemática de departamentos de Bolivia.
          </p>
        </section>

        <section className="dashboard-card dashboard-line-card">
          <h3>Línea diaria · Ventas del mes</h3>
          <div className="dashboard-line-wrap">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="dashboard-line-svg">
              <line x1="6" y1="8" x2="6" y2="82" className="dashboard-line-axis" />
              <line x1="6" y1="82" x2="94" y2="82" className="dashboard-line-axis" />
              <line x1="6" y1="26" x2="94" y2="26" className="dashboard-line-grid" />
              <line x1="6" y1="44" x2="94" y2="44" className="dashboard-line-grid" />
              <line x1="6" y1="62" x2="94" y2="62" className="dashboard-line-grid" />
              <path d={linePath} className="dashboard-line-path" />
              {lineChartPoints.map((point) => (
                <circle key={point.day_num} cx={point.x} cy={point.y} r="1.2" className="dashboard-line-point" />
              ))}
              <text x="2" y="10" className="dashboard-line-tick">{formatBs(maxDailySales).replace(' Bs', '')}</text>
              <text x="2" y="46" className="dashboard-line-tick">{formatBs(maxDailySales / 2).replace(' Bs', '')}</text>
              <text x="2" y="84" className="dashboard-line-tick">0</text>
              <text x="6" y="93" className="dashboard-line-tick">Día 1</text>
              <text x="84" y="93" className="dashboard-line-tick">Día {monthDaysCount}</text>
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