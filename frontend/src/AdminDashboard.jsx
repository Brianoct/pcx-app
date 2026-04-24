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

const BOLIVIA_TILE_LAYOUT = [
  { key: 'Pando', short: 'Pando', x: 0, y: 0 },
  { key: 'Beni', short: 'Beni', x: 1, y: 0 },
  { key: 'La Paz', short: 'La Paz', x: 0, y: 1 },
  { key: 'Cochabamba', short: 'Cochabamba', x: 1, y: 1 },
  { key: 'Santa Cruz', short: 'Santa Cruz', x: 2, y: 1 },
  { key: 'Oruro', short: 'Oruro', x: 0, y: 2 },
  { key: 'Potosí', short: 'Potosí', x: 1, y: 2 },
  { key: 'Chuquisaca', short: 'Chuquisaca', x: 2, y: 2 },
  { key: 'Tarija', short: 'Tarija', x: 1, y: 3 }
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
  const maxDailySales = Math.max(...dailySalesSeries.map((item) => Number(item.total_sales || 0)), 1);
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
  const lineChartPoints = dailySalesSeries.map((item, index) => {
    const chartWidth = 100;
    const chartHeight = 100;
    const leftPad = 6;
    const rightPad = 6;
    const topPad = 8;
    const bottomPad = 18;
    const drawableWidth = chartWidth - leftPad - rightPad;
    const drawableHeight = chartHeight - topPad - bottomPad;
    const x = dailySalesSeries.length === 1
      ? leftPad + drawableWidth / 2
      : leftPad + (index / (dailySalesSeries.length - 1)) * drawableWidth;
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

        <section className="dashboard-card">
          <h3>Mapa de Bolivia · Ventas por departamento</h3>
          <div className="dashboard-bolivia-map">
            {BOLIVIA_TILE_LAYOUT.map((tile) => {
              const totalSales = Number(departmentSalesMap[tile.key] || 0);
              const ratio = Math.min(1, totalSales / maxDepartmentSales);
              const alpha = 0.18 + (ratio * 0.72);
              return (
                <div
                  key={tile.key}
                  className="dashboard-bolivia-tile"
                  style={{
                    gridColumn: tile.x + 1,
                    gridRow: tile.y + 1,
                    background: `rgba(248, 113, 113, ${alpha.toFixed(2)})`
                  }}
                >
                  <strong>{tile.short}</strong>
                  <span>{formatBs(totalSales)}</span>
                </div>
              );
            })}
          </div>
          <p className="dashboard-map-legend">
            Mayor intensidad = mayor volumen de ventas del periodo seleccionado.
          </p>
        </section>

        <section className="dashboard-card">
          <h3>Línea diaria · Ventas del mes</h3>
          {lineChartPoints.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <div className="dashboard-line-chart-wrap">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="dashboard-line-chart">
                <polyline
                  fill="none"
                  stroke="rgba(56, 189, 248, 0.45)"
                  strokeWidth="0.6"
                  points={`6,82 94,82`}
                />
                <path
                  d={linePath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {lineChartPoints.map((point) => (
                  <circle
                    key={point.day}
                    cx={point.x}
                    cy={point.y}
                    r="1.4"
                    fill="#38bdf8"
                  />
                ))}
              </svg>
              <div className="dashboard-line-axis">
                <span>Día 1</span>
                <span>Día {lineChartPoints.length}</span>
              </div>
              <ol className="dashboard-line-list">
                {lineChartPoints.map((point) => (
                  <li key={point.day}>
                    <strong>{point.day}</strong>
                    <span>{formatBs(point.total_sales)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
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