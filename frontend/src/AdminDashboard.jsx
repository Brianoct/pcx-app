// src/AdminDashboard.jsx
import { useState, useEffect } from 'react';
import { apiRequest } from './apiClient';

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
  const activeUserCommissions = Array.isArray(stats.activeUserCommissions) ? stats.activeUserCommissions : [];
  const totalCommissionsToDate = Number(stats.totalCommissionsToDate || 0);
  const maxQty = Math.max(...popularProducts.map((p) => Number(p.total_quantity || 0)), 1);
  const formatBs = (value) => `${Number(value || 0).toFixed(2)} Bs`;

  return (
    <div className="dashboard-workspace">
      <div className="admin-hero-card">
        <p style={{ margin: 0, color: '#ff7f30', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Dashboard PCX
        </p>
        <h2 style={{ margin: '8px 0 6px', fontSize: '2.1rem' }}>Salud del negocio</h2>
        <p style={{ margin: 0, color: '#94a3b8' }}>
          Monitorea ventas, vendedores, ubicaciones y comisiones para entender cómo está corriendo la empresa.
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
            <ol className="dashboard-list">
              {topSalespeople.map((seller, index) => (
                <li key={`${seller.vendor}-${index}`}>
                  <strong>{seller.vendor}</strong> — {seller.order_count} pedidos — {formatBs(seller.total_sales)}
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
          <h3>Ranking Almacenes (Tráfico)</h3>
          {topWarehouses.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <ol className="dashboard-list">
              {topWarehouses.map((warehouse, index) => (
                <li key={`${warehouse.store_location}-${index}`}>
                  <strong>{warehouse.store_location}</strong> — {warehouse.order_count} pedidos — {formatBs(warehouse.total_sales)}
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
          {activeUserCommissions.length === 0 ? (
            <p className="dashboard-empty">No hay usuarios activos con comisión para el periodo</p>
          ) : (
            <div className="dashboard-commission-table">
              {activeUserCommissions.map((row) => {
                const displayName = String(row.user_label || '').trim()
                  || String(row.display_name || '').trim()
                  || String(row.email || '').split('@')[0];
                return (
                  <div key={row.user_id || row.id} className="dashboard-commission-row">
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