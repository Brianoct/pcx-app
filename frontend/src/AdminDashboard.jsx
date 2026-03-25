// src/AdminDashboard.jsx
import { useState, useEffect } from 'react';

function AdminDashboard({ token }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    fetchStats();
  }, [selectedMonth, selectedYear, token]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/admin/stats?month=${selectedMonth}&year=${selectedYear}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Error al cargar estadísticas');
      const data = await res.json();
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

  const maxQty = Math.max(...stats.popularProducts.map(p => p.total_quantity || 0), 1);

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', color: '#f87171', marginBottom: '30px' }}>
        Panel de Estadísticas Mensuales
      </h1>

      {/* Month/Year Selector */}
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(Number(e.target.value))}
          style={{ padding: '10px 16px', marginRight: '16px', fontSize: '1.1rem', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '8px' }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <option key={m} value={m}>
              {new Date(0, m - 1).toLocaleString('es-BO', { month: 'long' })}
            </option>
          ))}
        </select>

        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          style={{ padding: '10px 16px', fontSize: '1.1rem', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '8px' }}
        >
          {[2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '24px' }}>

        {/* 1. Most popular products */}
        <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px' }}>
          <h3 style={{ color: '#f87171', marginBottom: '20px', textAlign: 'center' }}>
            Productos Más Vendidos (Cantidad)
          </h3>
          {stats.popularProducts.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8' }}>Sin datos este mes</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {stats.popularProducts.map(p => (
                <div key={p.sku} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '220px', fontWeight: '500' }}>{p.name}</div>
                  <div style={{ flex: 1, height: '30px', background: '#334155', borderRadius: '6px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, (p.total_quantity / maxQty) * 100)}%`,
                        height: '100%',
                        background: '#f87171',
                        transition: 'width 0.5s ease'
                      }}
                    />
                  </div>
                  <div style={{ minWidth: '60px', textAlign: 'right', fontWeight: 'bold' }}>
                    {p.total_quantity}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 2. Top salespeople */}
        <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px' }}>
          <h3 style={{ color: '#f87171', marginBottom: '20px', textAlign: 'center' }}>
            Ranking Vendedores
          </h3>
          <ol style={{ paddingLeft: '24px', lineHeight: '1.8' }}>
            {stats.topSalespeople.map((sp, i) => (
              <li key={i} style={{ marginBottom: '12px', fontSize: '1.1rem' }}>
                <strong>{sp.vendor}</strong> — {sp.order_count} pedidos — {Number(sp.total_sales).toFixed(2)} Bs
              </li>
            ))}
          </ol>
        </div>

        {/* 3. Top locations */}
        <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px' }}>
          <h3 style={{ color: '#f87171', marginBottom: '20px', textAlign: 'center' }}>
            Ranking Departamentos / Provincias
          </h3>
          <ol style={{ paddingLeft: '24px', lineHeight: '1.8' }}>
            {stats.topLocations.map((loc, i) => (
              <li key={i} style={{ marginBottom: '12px', fontSize: '1.1rem' }}>
                <strong>{loc.location}</strong> — {Number(loc.total_sales).toFixed(2)} Bs
              </li>
            ))}
          </ol>
        </div>

        {/* 4. Top warehouses */}
        <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px' }}>
          <h3 style={{ color: '#f87171', marginBottom: '20px', textAlign: 'center' }}>
            Ranking Almacenes (Tráfico)
          </h3>
          <ol style={{ paddingLeft: '24px', lineHeight: '1.8' }}>
            {stats.topWarehouses.map((wh, i) => (
              <li key={i} style={{ marginBottom: '12px', fontSize: '1.1rem' }}>
                <strong>{wh.store_location}</strong> — {wh.order_count} pedidos — {Number(wh.total_sales).toFixed(2)} Bs
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;