import { useState, useEffect } from 'react';

function PerformanceDashboard({ token, user, role, onTopSellerChange }) {
  const [stats, setStats] = useState([]);
  const [leaderSales, setLeaderSales] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const isVentasLider = role?.toLowerCase().includes('ventas lider');
  const isAdmin = role?.toLowerCase().includes('admin');
  const canViewTeam = isVentasLider || isAdmin;
  const [teamView, setTeamView] = useState(canViewTeam);

  useEffect(() => {
    fetchPerformance();
  }, [selectedMonth, selectedYear, teamView, token]);

  const fetchPerformance = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        team: teamView ? 'true' : 'false',
        month: selectedMonth,
        year: selectedYear
      });

      const res = await fetch(`http://localhost:4000/api/performance?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo cargar rendimiento');
      }

      const data = await res.json();

      if (!teamView) {
        const personal = Array.isArray(data) ? data[0] : data;
        const personalVentas = Number(personal?.ventas_totales || 0);
        const personalCotizaciones = Number(personal?.cotizaciones_confirmadas || 0);
        const personalComision = personalVentas * 0.08;

        setLeaderSales(0);
        setStats([{
          vendor: user?.email || 'Mi usuario',
          cotizaciones: personalCotizaciones,
          totalVentas: personalVentas,
          comision: personalComision
        }]);

        if (onTopSellerChange) {
          onTopSellerChange({
            vendor: null,
            comision: personalComision,
            liderOverride: 0
          });
        }
        return;
      }

      const dataRows = Array.isArray(data) ? data : [];
      const totalTeamVentas = dataRows.reduce((sum, item) => sum + Number(item.ventas_totales || 0), 0);
      const liderOverride = isVentasLider ? totalTeamVentas * 0.05 : 0;

      // Capture leader's own sales for table total
      const leaderRow = dataRows.find(item => {
        const email = (item.usuario || item.vendedor || '').toLowerCase();
        return email.includes('raissa') || email.includes('ventas lider');
      });
      const leaderVentas = leaderRow ? Number(leaderRow.ventas_totales || 0) : 0;
      setLeaderSales(leaderVentas);

      // Regular sellers only for ranking/table
      let processed = dataRows
        .filter(item => {
          const email = (item.usuario || item.vendedor || '').toLowerCase();
          return !email.includes('raissa') && !email.includes('ventas lider');
        })
        .map(item => ({
          vendor: item.usuario || item.vendedor || 'Desconocido',
          cotizaciones: Number(item.cotizaciones_confirmadas || 0),
          totalVentas: Number(item.ventas_totales || 0)
        }))
        .sort((a, b) => b.totalVentas - a.totalVentas);

      processed = processed.map((row, index) => ({
        ...row,
        comision: row.totalVentas * (index === 0 ? 0.12 : 0.08)
      }));

      // Only notify App.jsx if:
      // - User is leader → send override
      // - OR the top regular seller is the logged-in user → send 12% + gold trigger
      if (onTopSellerChange) {
        if (isVentasLider) {
          onTopSellerChange({
            vendor: null, // no gold for leader
            comision: null, // don't overwrite regular commission
            liderOverride
          });
        } else if (processed.length > 0) {
          const topVendor = processed[0].vendor || '';
          const myEmail = user?.email || '';
          const isLoggedInTop = topVendor.toLowerCase().includes(myEmail.toLowerCase());

          if (isLoggedInTop) {
            onTopSellerChange({
              vendor: topVendor,
              comision: processed[0].comision, // 12%
              liderOverride: 0
            });
          } else {
            // Not top → don't send anything (preserve personal 8%)
            onTopSellerChange({
              vendor: null,
              comision: null,
              liderOverride: 0
            });
          }
        }
      }

      setStats(processed);
    } catch (err) {
      console.error('Error fetching performance:', err);
      setError(err.message || 'Error al cargar rendimiento');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '80px 20px', color: '#94a3b8' }}>Cargando rendimiento...</div>;
  if (error) return <div style={{ textAlign: 'center', padding: '80px 20px', color: '#f87171' }}>{error}</div>;

  const regularVentas = stats.reduce((sum, row) => sum + row.totalVentas, 0);
  const regularComision = stats.reduce((sum, row) => sum + row.comision, 0);
  const totalVentas = regularVentas + leaderSales;
  let liderOverride = 0;
  if (teamView && isVentasLider) {
    liderOverride = totalVentas * 0.05;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', color: '#f87171', marginBottom: '30px' }}>
        Rendimiento de Ventas
      </h2>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px', marginBottom: '30px' }}>
        <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} style={{ padding: '10px 16px', fontSize: '1.1rem', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '8px' }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{new Date(0, m-1).toLocaleString('es-BO', { month: 'long' })}</option>)}
        </select>
        <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} style={{ padding: '10px 16px', fontSize: '1.1rem', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '8px' }}>
          {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {canViewTeam && (
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', color: '#94a3b8', fontSize: '1.1rem' }}>
            <input type="checkbox" checked={teamView} onChange={e => setTeamView(e.target.checked)} style={{ width: '20px', height: '20px', accentColor: '#e11d48' }} />
            Ver rendimiento del equipo
          </label>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', justifyContent: 'center' }}>
        <div style={{ flex: '3 1 600px', overflowX: 'auto' }}>
          {stats.length === 0 && leaderSales === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '1.1rem' }}>
              No hay datos de ventas para este período.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  <th style={{ padding: '14px', textAlign: 'left' }}>Vendedor</th>
                  <th style={{ padding: '14px', textAlign: 'center' }}>Cotizaciones</th>
                  <th style={{ padding: '14px', textAlign: 'right' }}>Ventas Totales</th>
                  <th style={{ padding: '14px', textAlign: 'right' }}>Comisión</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '14px' }}>{row.vendor}</td>
                    <td style={{ padding: '14px', textAlign: 'center' }}>{row.cotizaciones || '-'}</td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>{row.totalVentas.toFixed(2)} Bs</td>
                    <td style={{ padding: '14px', textAlign: 'right', color: '#10b981' }}>
                      {row.comision.toFixed(2)} Bs
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#0f172a', fontWeight: 'bold' }}>
                  <td style={{ padding: '14px' }}>TOTAL EQUIPO (incluye líder)</td>
                  <td style={{ padding: '14px', textAlign: 'center' }}>-</td>
                  <td style={{ padding: '14px', textAlign: 'right' }}>{totalVentas.toFixed(2)} Bs</td>
                  <td style={{ padding: '14px', textAlign: 'right', color: '#10b981' }}>
                    {regularComision.toFixed(2)} Bs (regular) + {liderOverride.toFixed(2)} Bs (líder)
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {teamView && isVentasLider && (
          <div style={{
            flex: '1 1 300px',
            background: '#1e293b',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            border: '1px solid #374151'
          }}>
            <h3 style={{ color: '#f87171', marginBottom: '16px', textAlign: 'center' }}>
              Comisión Ventas Líder
            </h3>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '1.1rem', color: '#94a3b8' }}>
                Total ventas equipo (incluye líder):
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#f87171' }}>
                {totalVentas.toFixed(2)} Bs
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', color: '#94a3b8' }}>
                Comisión (5% override):
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
                {liderOverride.toFixed(2)} Bs
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PerformanceDashboard;