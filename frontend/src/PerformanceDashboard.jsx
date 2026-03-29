import { useState, useEffect, useMemo } from 'react';
import { canAccessPanel, normalizeRole } from './roleAccess';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const isSalesRole = (roleValue = '') => {
  const r = normalizeRole(roleValue);
  return r === 'ventas' || r === 'sales' || r === 'vendedor';
};

const isVentasLiderRole = (roleValue = '') => normalizeRole(roleValue).includes('ventas lider');

const formatMoney = (value) => `${Number(value || 0).toFixed(2)} Bs`;

function KpiCard({ label, value, hint, accent = '#3b82f6' }) {
  return (
    <div style={{
      background: '#1e293b',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '14px'
    }}>
      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '6px' }}>{label}</div>
      <div style={{ color: accent, fontWeight: '800', fontSize: '1.35rem', lineHeight: 1.2 }}>{value}</div>
      {hint && <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}

function PerformanceDashboard({ token, user, role, access }) {
  const [rows, setRows] = useState([]);
  const [personal, setPersonal] = useState(null);
  const [commissionInfo, setCommissionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const canViewGlobal = canAccessPanel(access, 'rendimientoGlobal');
  const canViewIndividual = canAccessPanel(access, 'rendimientoIndividual');
  const viewMode = canViewGlobal ? 'global' : 'individual';
  const isVentasLider = isVentasLiderRole(role || '');

  useEffect(() => {
    const fetchDashboard = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          team: viewMode === 'global' ? 'true' : 'false',
          month: selectedMonth,
          year: selectedYear
        });
        const commissionParams = new URLSearchParams({
          month: selectedMonth,
          year: selectedYear
        });

        const [perfRes, commissionRes] = await Promise.all([
          fetch(`${API_BASE}/api/performance?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${API_BASE}/api/commission/current?${commissionParams.toString()}`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);

        if (!perfRes.ok) {
          const errData = await perfRes.json().catch(() => ({}));
          throw new Error(errData.error || 'No se pudo cargar rendimiento');
        }

        const perfData = await perfRes.json();
        const commissionData = commissionRes.ok ? await commissionRes.json() : null;
        setCommissionInfo(commissionData);

        if (viewMode === 'individual') {
          const source = Array.isArray(perfData) ? perfData[0] : perfData;
          setPersonal({
            vendor: user?.email || 'Mi usuario',
            cotizaciones: Number(source?.cotizaciones_confirmadas || 0),
            totalVentas: Number(source?.ventas_totales || 0),
            comision: Number(commissionData?.commission || 0),
            rate: Number(commissionData?.breakdown?.rate || 0),
            isTopSeller: Boolean(commissionData?.isTopSeller),
            source: commissionData?.breakdown?.source || ''
          });
          setRows([]);
          return;
        }

        const baseRows = (Array.isArray(perfData) ? perfData : []).map((item) => ({
          userId: Number(item.user_id),
          vendor: item.usuario || item.vendedor || 'Desconocido',
          role: item.rol || '',
          cotizaciones: Number(item.cotizaciones_confirmadas || 0),
          totalVentas: Number(item.ventas_totales || 0)
        }));

        const sellerRows = baseRows
          .filter((r) => isSalesRole(r.role))
          .sort((a, b) => b.totalVentas - a.totalVentas);
        const topSellerId = sellerRows.length > 0 ? sellerRows[0].userId : null;
        const salesTeamTotal = sellerRows.reduce((sum, r) => sum + r.totalVentas, 0);

        const enriched = baseRows
          .map((row) => {
            if (isSalesRole(row.role)) {
              const isTop = topSellerId === row.userId && row.totalVentas > 0;
              const rate = isTop ? 0.12 : 0.08;
              return {
                ...row,
                rate,
                commission: row.totalVentas * rate,
                rule: isTop ? 'Mejor en ventas (12%)' : 'Vendedor (8%)',
                isTopSeller: isTop
              };
            }

            if (isVentasLiderRole(row.role)) {
              const base = row.totalVentas + salesTeamTotal;
              return {
                ...row,
                rate: 0.05,
                commission: base * 0.05,
                rule: 'Líder ventas (5% equipo + propias)',
                isTopSeller: false
              };
            }

            return {
              ...row,
              rate: 0,
              commission: 0,
              rule: 'Sin comisión',
              isTopSeller: false
            };
          })
          .sort((a, b) => b.totalVentas - a.totalVentas);

        setRows(enriched);
        setPersonal(null);
      } catch (err) {
        console.error('Error al cargar el panel de rendimiento:', err);
        setError(err.message || 'Error al cargar rendimiento');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [selectedMonth, selectedYear, viewMode, token, user?.email]);

  if (!canViewGlobal && !canViewIndividual) {
    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center', color: '#fca5a5' }}>
          No tienes acceso al panel de rendimiento.
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '80px 20px', color: '#94a3b8' }}>Cargando rendimiento...</div>;
  if (error) return <div style={{ textAlign: 'center', padding: '80px 20px', color: '#f87171' }}>{error}</div>;

  const totalTeamVentas = rows.reduce((sum, row) => sum + row.totalVentas, 0);
  const totalTeamCotizaciones = rows.reduce((sum, row) => sum + row.cotizaciones, 0);
  const totalTeamCommissions = rows.reduce((sum, row) => sum + row.commission, 0);
  const topSeller = rows.find((r) => r.isTopSeller);
  const leaderCommission = rows
    .filter((r) => isVentasLiderRole(r.role))
    .reduce((sum, r) => sum + r.commission, 0);

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', color: '#f87171', marginBottom: '8px' }}>
        Panel de Rendimiento
      </h2>
      <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '22px' }}>
        {viewMode === 'global' ? 'Vista global del equipo de ventas' : 'Vista individual de vendedor'}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
        <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} style={{ padding: '10px 16px', fontSize: '1rem', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '8px' }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{new Date(0, m - 1).toLocaleString('es-BO', { month: 'long' })}</option>)}
        </select>
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} style={{ padding: '10px 16px', fontSize: '1rem', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '8px' }}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {viewMode === 'individual' && personal && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <KpiCard label="Ventas del período" value={formatMoney(personal.totalVentas)} accent="#60a5fa" />
            <KpiCard label="Cotizaciones confirmadas" value={String(personal.cotizaciones)} accent="#f59e0b" />
            <KpiCard label="Comisión estimada" value={formatMoney(personal.comision)} accent="#10b981" />
            <KpiCard
              label="Tasa aplicada"
              value={`${(personal.rate * 100).toFixed(0)}%`}
              hint={personal.isTopSeller ? 'Mejor en ventas actual' : 'Tasa asesor de ventas'}
              accent={personal.isTopSeller ? '#facc15' : '#cbd5e1'}
            />
          </div>

          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '16px' }}>
            <h3 style={{ marginBottom: '8px', color: '#f1f5f9' }}>Detalle de comisión</h3>
            <p style={{ color: '#94a3b8', marginBottom: '8px' }}>
              {commissionInfo?.breakdown?.source || personal.source || 'Comisión calculada para el período seleccionado.'}
            </p>
            {commissionInfo?.isTopSeller && (
              <div style={{ color: '#facc15', fontWeight: 700 }}>
                Eres quien va mejor en ventas en el período. Se aplica 12%.
              </div>
            )}
          </div>
        </>
      )}

      {viewMode === 'global' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <KpiCard label="Ventas equipo" value={formatMoney(totalTeamVentas)} accent="#60a5fa" />
            <KpiCard label="Cotizaciones confirmadas" value={String(totalTeamCotizaciones)} accent="#f59e0b" />
            <KpiCard label="Comisiones estimadas" value={formatMoney(totalTeamCommissions)} accent="#10b981" hint="Suma de reglas por rol" />
            <KpiCard label="Mejor en ventas" value={topSeller ? topSeller.vendor : 'Sin datos'} hint={topSeller ? formatMoney(topSeller.totalVentas) : ''} accent="#facc15" />
            {isVentasLider && <KpiCard label="Comisión líder" value={formatMoney(leaderCommission)} hint="5% equipo + propias" accent="#22c55e" />}
          </div>

          <div style={{ overflowX: 'auto', background: '#1e293b', border: '1px solid #334155', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  <th style={{ padding: '12px', textAlign: 'center', width: '60px' }}>#</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Vendedor</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Rol</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Cotiz.</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Ventas</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Comisión</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Regla</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.userId}-${index}`} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '12px', textAlign: 'center', color: row.isTopSeller ? '#facc15' : '#94a3b8' }}>
                      {index + 1}
                    </td>
                    <td style={{ padding: '12px', fontWeight: row.isTopSeller ? 700 : 500 }}>
                      {row.vendor}
                    </td>
                    <td style={{ padding: '12px', color: '#94a3b8' }}>{row.role || '—'}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>{row.cotizaciones}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>{formatMoney(row.totalVentas)}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#10b981', fontWeight: 700 }}>
                      {formatMoney(row.commission)}
                    </td>
                    <td style={{ padding: '12px', color: '#94a3b8' }}>{row.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default PerformanceDashboard;