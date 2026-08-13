// src/AdminDashboard.jsx
import { useState, useEffect, cloneElement } from 'react';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';
import BoliviaSalesMap from './BoliviaSalesMap';
import MorningBrief from './MorningBrief';
import RentabilidadCard from './RentabilidadCard';
import LineStatsCard from './LineStatsCard';

const getNiceAxisMax = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
};

// Real swatch per color code so the color-mix bars read at a glance. Keep the
// codes in sync with COLOR_SUFFIXES (backend/lib/kanban.js · productionShared.js).
const COLOR_SWATCH = {
  AM: '#facc15', // Amarillo
  AP: '#0e7490', // Azul Petroleo
  PL: '#6b7280', // Plomo
  BL: '#e5e7eb', // Blanco
  N: '#1f2937',  // Negro
  R: '#dc2626',  // Rojo
  C: '#cbd5e1',  // Cromo
  B: '#e5e7eb'   // Blanco
};

// Strategic default: pulse of the business first (resumen, tendencia diaria,
// dinero por pagar), then sales health, then people/product detail, then
// production, logistics and marketing.
const DASHBOARD_CARD_ORDER = [
  'summary',
  'dailySales',
  'commissions',
  'funnel',
  'salespeople',
  'products',
  'colorSales',
  'customers',
  'warehouses',
  'map'
];

// Grupos de tarjetas: pestañas junto al selector de fecha para saltar entre
// familias de gráficos sin scrollear. «lineStats» y «rentabilidad» viven fuera
// de la grilla pero se filtran con el mismo grupo.
const DASHBOARD_GROUPS = [
  { id: 'todos', label: 'Todo', cards: null },
  { id: 'ventas', label: '💰 Ventas y equipo', cards: ['summary', 'dailySales', 'funnel', 'salespeople', 'commissions', 'customers'] },
  { id: 'productos', label: '📦 Productos y rentabilidad', cards: ['products', 'colorSales'] },
  { id: 'destinos', label: '🗺️ Destinos y almacenes', cards: ['warehouses', 'map'] }
];

// Accent per business domain: consistent color language across tiles.
const DASHBOARD_CARD_ACCENTS = {
  summary: 'accent-ventas',
  dailySales: 'accent-ventas',
  funnel: 'accent-ventas',
  salespeople: 'accent-ventas',
  products: 'accent-producto',
  colorSales: 'accent-producto',
  customers: 'accent-clientes',
  warehouses: 'accent-almacen',
  map: 'accent-geo',
  commissions: 'accent-equipo'
};

// v2: reset saved orders so the new strategic default applies to everyone.
const DASHBOARD_CARD_STORAGE_KEY = 'pcx-dashboard-card-order-v2';

const normalizeDashboardCardOrder = (candidateOrder) => {
  if (!Array.isArray(candidateOrder)) {
    return DASHBOARD_CARD_ORDER;
  }
  const known = new Set(DASHBOARD_CARD_ORDER);
  const seen = new Set();
  const normalized = [];

  candidateOrder.forEach((id) => {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  });
  DASHBOARD_CARD_ORDER.forEach((id) => {
    if (!seen.has(id)) normalized.push(id);
  });
  return normalized;
};

function AdminDashboard({ token }) {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [cardOrder, setCardOrder] = useState(DASHBOARD_CARD_ORDER);
  const [cardGroup, setCardGroup] = useState('todos');
  const [draggedCardId, setDraggedCardId] = useState('');
  const [dragOverCardId, setDragOverCardId] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(DASHBOARD_CARD_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setCardOrder(normalizeDashboardCardOrder(parsed));
    } catch (error) {
      console.warn('No se pudo cargar el orden de tarjetas del dashboard', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        DASHBOARD_CARD_STORAGE_KEY,
        JSON.stringify(normalizeDashboardCardOrder(cardOrder))
      );
    } catch (error) {
      console.warn('No se pudo guardar el orden de tarjetas del dashboard', error);
    }
  }, [cardOrder]);

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
      toast.error('No se pudieron cargar las estadísticas');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px', color: '#78716c' }}>Cargando panel...</div>;
  if (!stats) return <div style={{ textAlign: 'center', padding: '50px', color: '#dc2626' }}>No hay datos disponibles</div>;

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
  const totalSalesInPeriod = topSalespeople.reduce((sum, seller) => sum + Number(seller.total_sales || 0), 0);
  const totalPedidosInPeriod = topSalespeople.reduce((sum, seller) => sum + Number(seller.order_count || 0), 0);
  const totalCombinedProducts = popularProducts.reduce((sum, product) => sum + Number(product.total_quantity || 0), 0);
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
  const commissionRows = [...activeUserCommissions]
    .map((row, index) => ({
      ...row,
      rowKey: row.user_id || row.id || row.email || `commission-${index}`
    }))
    .sort((a, b) => Number(b.commission || 0) - Number(a.commission || 0));
  const formatBs = (value) => `${Number(value || 0).toFixed(2)} Bs`;
  // Comparison vs previous month + funnel (new backend fields).
  const periodSummary = stats.periodSummary || null;
  const previousSummary = stats.previousSummary || null;
  const funnel = stats.funnel || null;
  const sellerConversion = Array.isArray(stats.sellerConversion) ? stats.sellerConversion : [];
  const prevDailySeries = Array.isArray(stats.prevDailySalesSeries) ? stats.prevDailySalesSeries : [];

  const renderDelta = (current, previous, { invert = false } = {}) => {
    const prev = Number(previous || 0);
    const curr = Number(current || 0);
    if (prev <= 0) return <span className="dashboard-delta is-flat">— sin mes anterior</span>;
    const pct = ((curr - prev) / prev) * 100;
    if (!Number.isFinite(pct)) return null;
    const up = pct >= 0;
    const good = invert ? !up : up;
    return (
      <span className={`dashboard-delta ${good ? 'is-up' : 'is-down'}`}>
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% vs mes anterior
      </span>
    );
  };

  const customerMix = stats.customerMix || null;
  const topCustomers = Array.isArray(stats.topCustomers) ? stats.topCustomers : [];
  const colorSales = Array.isArray(stats.colorSales) ? stats.colorSales : [];
  const mixTotal = customerMix ? Number(customerMix.new_total) + Number(customerMix.repeat_total) : 0;
  const repeatPct = mixTotal > 0 ? (Number(customerMix.repeat_total) / mixTotal) * 100 : 0;

  // Backend counts are already cumulative (Pagado implies Confirmado, etc.).
  const funnelSteps = funnel ? [
    { label: 'Cotizaciones', value: Number(funnel.total || 0) },
    { label: 'Confirmadas o más', value: Number(funnel.confirmado || 0) },
    { label: 'Pagadas o más', value: Number(funnel.pagado || 0) },
    { label: 'Enviadas', value: Number(funnel.enviado || 0) }
  ] : [];
  const funnelMax = Math.max(...funnelSteps.map((step) => step.value), 1);

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

  // Ghost line: previous month's daily sales for visual comparison.
  const prevLinePath = prevDailySeries
    .filter((item) => Number(item.day_num) >= 1 && Number(item.day_num) <= monthDaysCount)
    .map((item, index) => {
      const x = xForDay(Number(item.day_num));
      const y = yForValue(Math.min(Number(item.total_sales || 0), safeYMax));
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const reorderCards = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setCardOrder((prevOrder) => {
      const normalized = normalizeDashboardCardOrder(prevOrder);
      const sourceIndex = normalized.indexOf(sourceId);
      const targetIndex = normalized.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return normalized;
      const next = [...normalized];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleCardDragStart = (cardId) => (event) => {
    setDraggedCardId(cardId);
    setDragOverCardId('');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cardId);
  };

  const handleCardDragOver = (cardId) => (event) => {
    event.preventDefault();
    if (draggedCardId && draggedCardId !== cardId) {
      setDragOverCardId(cardId);
    }
    event.dataTransfer.dropEffect = 'move';
  };

  const handleCardDrop = (targetCardId) => (event) => {
    event.preventDefault();
    const droppedCardId = draggedCardId || event.dataTransfer.getData('text/plain');
    reorderCards(droppedCardId, targetCardId);
    setDraggedCardId('');
    setDragOverCardId('');
  };

  const handleCardDragEnd = () => {
    setDraggedCardId('');
    setDragOverCardId('');
  };

  // null = grupo «Todo» (sin filtro).
  const activeGroupCards = DASHBOARD_GROUPS.find((group) => group.id === cardGroup)?.cards || null;

  const dashboardCards = {
    summary: (
      <section className="dashboard-card dashboard-summary-card dashboard-card-wide">
        <h3>Resumen general del periodo</h3>
        <div className="dashboard-summary-grid">
          <div className="dashboard-summary-item">
            <span>Total ventas</span>
            <strong>{formatBs(periodSummary?.sold_total ?? totalSalesInPeriod)}</strong>
            {periodSummary && previousSummary && renderDelta(periodSummary.sold_total, previousSummary.sold_total)}
          </div>
          <div className="dashboard-summary-item">
            <span>Total pedidos</span>
            <strong>{periodSummary?.sold_count ?? totalPedidosInPeriod}</strong>
            {periodSummary && previousSummary && renderDelta(periodSummary.sold_count, previousSummary.sold_count)}
          </div>
          <div className="dashboard-summary-item">
            <span>Venta promedio</span>
            <strong>{formatBs(periodSummary?.avg_ticket || 0)}</strong>
            {periodSummary && previousSummary && renderDelta(periodSummary.avg_ticket, previousSummary.avg_ticket)}
          </div>
          <div className="dashboard-summary-item">
            <span>Conversión (cotización → venta)</span>
            <strong>{`${Number(periodSummary?.conversion_pct || 0).toFixed(1)}%`}</strong>
            {periodSummary && previousSummary && renderDelta(periodSummary.conversion_pct, previousSummary.conversion_pct)}
          </div>
          <div className="dashboard-summary-item">
            <span>Total comisiones</span>
            <strong>{formatBs(totalCommissionsToDate)}</strong>
          </div>
          <div className="dashboard-summary-item">
            <span>Total productos combinados</span>
            <strong>{totalCombinedProducts}</strong>
          </div>
        </div>
      </section>
    ),
    funnel: (
      <section className="dashboard-card dashboard-card-wide">
        <h3>Embudo de conversión del periodo</h3>
        {funnelSteps.length === 0 || funnelSteps[0].value === 0 ? (
          <p className="dashboard-empty">Sin cotizaciones este periodo</p>
        ) : (
          <>
            <div className="dashboard-funnel">
              {funnelSteps.map((step, index) => {
                const widthPct = Math.max(6, (step.value / funnelMax) * 100);
                const prevValue = index > 0 ? funnelSteps[index - 1].value : null;
                const stepRate = prevValue ? (prevValue > 0 ? (step.value / prevValue) * 100 : 0) : null;
                return (
                  <div key={step.label} className="dashboard-funnel-row">
                    <div className="dashboard-funnel-label">{step.label}</div>
                    <div className="dashboard-funnel-track">
                      <div className="dashboard-funnel-bar" style={{ width: `${widthPct}%` }}>
                        <span>{step.value}</span>
                      </div>
                    </div>
                    <div className="dashboard-funnel-rate">
                      {stepRate !== null ? `${stepRate.toFixed(0)}%` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            {sellerConversion.length > 0 && (
              <div className="dashboard-funnel-sellers">
                <h4>Conversión por vendedor</h4>
                <table>
                  <thead>
                    <tr><th>Vendedor</th><th>Cotizaciones</th><th>Ventas</th><th>Tasa</th><th>Bs vendidos</th></tr>
                  </thead>
                  <tbody>
                    {sellerConversion.map((seller) => (
                      <tr key={seller.vendor}>
                        <td>{seller.vendor}</td>
                        <td>{seller.quotes_count}</td>
                        <td>{seller.sold_count}</td>
                        <td className={seller.conversion_pct >= 30 ? 'is-good' : seller.conversion_pct < 15 ? 'is-low' : ''}>
                          {seller.conversion_pct.toFixed(0)}%
                        </td>
                        <td>{formatBs(seller.sold_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    ),
    customers: (
      <section className="dashboard-card">
        <h3>Clientes del periodo</h3>
        {!customerMix || (mixTotal === 0 && customerMix.new_customers === 0) ? (
          <p className="dashboard-empty">Sin datos este periodo</p>
        ) : (
          <>
            <div className="dashboard-mini-kpis">
              <div><span>Clientes nuevos registrados</span><strong>{customerMix.new_customers}</strong></div>
              <div><span>Ventas de clientes recurrentes</span><strong>{repeatPct.toFixed(0)}%</strong></div>
            </div>
            {mixTotal > 0 && (
              <div className="dashboard-mix-bar" title={`Nuevos ${formatBs(customerMix.new_total)} · Recurrentes ${formatBs(customerMix.repeat_total)}`}>
                <div className="dashboard-mix-new" style={{ width: `${100 - repeatPct}%` }}>Nuevos</div>
                <div className="dashboard-mix-repeat" style={{ width: `${repeatPct}%` }}>Recurrentes</div>
              </div>
            )}
            {topCustomers.length > 0 && (
              <>
                <h4 className="dashboard-subtitle">Top clientes del mes</h4>
                <ol className="dashboard-list">
                  {topCustomers.map((customer, index) => (
                    <li key={`${customer.name}-${index}`}>
                      <strong>{customer.name}</strong> — {formatBs(customer.total_spent)} ({customer.orders_count} pedido{customer.orders_count > 1 ? 's' : ''})
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </section>
    ),
    products: (
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
    ),
    colorSales: (
      <section className="dashboard-card">
        <h3>Colores más vendidos · T6195 y T9495</h3>
        {colorSales.every((group) => group.total === 0) ? (
          <p className="dashboard-empty">Sin ventas de estos productos este periodo</p>
        ) : (
          <div className="dashboard-color-groups">
            {colorSales.map((group) => {
              const groupMax = Math.max(...group.colors.map((c) => Number(c.qty || 0)), 1);
              return (
                <div key={group.base} className="dashboard-color-group">
                  <div className="dashboard-color-group-head">
                    <strong>{group.name}</strong>
                    <span>{group.base} · {group.total} vendidos</span>
                  </div>
                  {group.total === 0 ? (
                    <p className="dashboard-empty">Sin ventas este periodo</p>
                  ) : (
                    <div className="dashboard-bars">
                      {group.colors.map((color) => (
                        <div key={color.code} className="dashboard-bar-row">
                          <div className="dashboard-bar-label">
                            <span
                              className="dashboard-color-dot"
                              style={{ background: COLOR_SWATCH[color.code] || '#cbd5e1' }}
                            />
                            {color.label}
                          </div>
                          <div className="dashboard-bar-track">
                            <div
                              className="dashboard-bar-fill"
                              style={{ width: `${Math.min(100, (Number(color.qty || 0) / groupMax) * 100)}%` }}
                            />
                          </div>
                          <div className="dashboard-bar-value">{color.qty}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    ),
    salespeople: (
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
    ),
    map: (
      <BoliviaSalesMap salesByDepartment={salesByDepartment} topLocations={topLocations} />
    ),
    dailySales: (
      <section className="dashboard-card dashboard-line-card">
        <h3>Línea diaria · Ventas del mes <small style={{ fontWeight: 500, color: '#94a3b8' }}>(línea punteada = mes anterior)</small></h3>
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

            {prevLinePath ? <path d={prevLinePath} className="dashboard-line-path-prev" /> : null}
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
    ),
    warehouses: (
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
    ),
    commissions: (
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
                    <strong>{displayName}{row.is_top_seller ? ' ★' : ''}</strong>
                    <span>{row.role || 'Sin rol'}{row.source ? ` · ${row.source}` : ''}</span>
                  </div>
                  <div>{formatBs(row.commission)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    )
  };

  return (
    <div className="dashboard-workspace">
      <div className="admin-hero-card">
        <p style={{ margin: 0, color: '#ff7f30', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Dashboard
        </p>
      </div>

      <MorningBrief token={token} />

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
          <div className="dashboard-group-tabs" role="tablist" aria-label="Grupos de gráficos">
            {DASHBOARD_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={cardGroup === group.id}
                className={`dashboard-group-tab${cardGroup === group.id ? ' is-active' : ''}`}
                onClick={() => setCardGroup(group.id)}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        {cardOrder.map((cardId) => {
          const cardElement = dashboardCards[cardId];
          if (!cardElement) return null;
          if (activeGroupCards && !activeGroupCards.includes(cardId)) return null;
          const isDragging = draggedCardId === cardId;
          const isDropTarget = dragOverCardId === cardId && draggedCardId && draggedCardId !== cardId;
          return cloneElement(cardElement, {
            key: cardId,
            draggable: true,
            onDragStart: handleCardDragStart(cardId),
            onDragOver: handleCardDragOver(cardId),
            onDrop: handleCardDrop(cardId),
            onDragEnd: handleCardDragEnd,
            className: `${cardElement.props.className || ''} dashboard-draggable-card ${DASHBOARD_CARD_ACCENTS[cardId] || ''}${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`,
            children: (
              <>
                <span className="dashboard-card-drag-handle" title="Arrastra para mover esta tarjeta" aria-hidden="true">⠿</span>
                {cardElement.props.children}
              </>
            )
          });
        })}
      </div>

      {(cardGroup === 'todos' || cardGroup === 'productos') && (
        <>
          <LineStatsCard token={token} month={selectedMonth} year={selectedYear} />
          <RentabilidadCard token={token} month={selectedMonth} year={selectedYear} />
        </>
      )}
    </div>
  );
}

export default AdminDashboard;