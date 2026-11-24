const { pool } = require('../db');
const { loadCommissionSettings } = require('./commission');
const { resolveInventoryScopeByCity } = require('./inventory');
const { ROLE_KEYS, normalizeRole } = require('./rbac');
const { buildDateFilter } = require('./reporting');
const { KIND_SALE, KIND_SHIPMENT, getClosure } = require('./commissionLedger');

// Month-end payroll view: every active user's commission for the period,
// computed with the SAME per-role rules as /api/commission/current (the
// personal nav box). Any change to the rules there must be mirrored here.
// Lee del libro de comisiones (por fecha de cobro). Un mes cerrado devuelve
// la foto guardada al cerrar, salvo { live: true } (lo usa el propio cierre).
const computeTeamCommissions = async (month, year, { live = false } = {}) => {
  const dateFilter = buildDateFilter(month, year, 'q', 2);
  if (dateFilter.error) return { error: dateFilter.error };

  const monthNum = Number.parseInt(month, 10);
  const yearNum = Number.parseInt(year, 10);
  if (!live && Number.isInteger(monthNum) && Number.isInteger(yearNum)) {
    const closure = await getClosure(yearNum, monthNum);
    if (closure) {
      return {
        users: closure.snapshot?.users || [],
        all_sales: Number(closure.snapshot?.all_sales || 0),
        closed: true,
        closed_at: closure.closed_at,
        closed_by: closure.closed_by_name || null
      };
    }
  }

  const settings = await loadCommissionSettings();
  const rateVentasLider = Number(settings.ventas_lider_percent || 0) / 100;
  const rateVentasTop = Number(settings.ventas_top_percent || 0) / 100;
  const rateVentasRegular = Number(settings.ventas_regular_percent || 0) / 100;
  const rateAlmacen = Number(settings.almacen_percent || 0) / 100;
  const rateMarketingLider = Number(settings.marketing_lider_percent || 0) / 100;
  const rateProduccion = Number(settings.produccion_percent || 0) / 100;
  const rateAlmacenLider = Number(settings.almacen_lider_percent || 0) / 100;
  const rateAdmin = Number(settings.admin_percent || 0) / 100;

  const usersRes = await pool.query(
    `SELECT id, email, display_name, role, city
     FROM users
     WHERE is_active = TRUE
     ORDER BY id`
  );
  const users = usersRes.rows;

  // Completed sales per user in the period (one pass for everyone).
  const perUserRes = await pool.query(
    `SELECT q.user_id, COALESCE(SUM(q.total), 0) AS total_sales
     FROM commission_entries q
     WHERE q.kind = ANY($1::text[])${dateFilter.sql}
     GROUP BY q.user_id`,
    [[KIND_SALE], ...dateFilter.params]
  );
  const salesByUser = new Map(
    perUserRes.rows.map((row) => [Number(row.user_id), Number(row.total_sales || 0)])
  );
  const allSales = perUserRes.rows.reduce((sum, row) => sum + Number(row.total_sales || 0), 0);

  const isSalesRole = (role) => {
    const normalized = normalizeRole(role || '');
    return normalized === ROLE_KEYS.ventas || normalized === 'sales' || normalized === 'vendedor';
  };

  // Top seller: highest completed sales among active sales users (ties by id),
  // and only counts as "top" with sales > 0 — same as the personal endpoint.
  const sellers = users
    .filter((u) => isSalesRole(u.role))
    .map((u) => ({ id: Number(u.id), sales: salesByUser.get(Number(u.id)) || 0 }))
    .sort((a, b) => (b.sales - a.sales) || (a.id - b.id));
  const topSeller = sellers[0] || null;
  const topSellerId = topSeller && topSeller.sales > 0 ? topSeller.id : null;

  // Ventas Líder base: all users whose role is exactly Ventas, plus own sales.
  const ventasTeamSales = users
    .filter((u) => String(u.role || '').toLowerCase() === ROLE_KEYS.ventas)
    .reduce((sum, u) => sum + (salesByUser.get(Number(u.id)) || 0), 0);

  // Almacén: 'Enviado' totals of the local warehouse, one query per distinct
  // city among almacén users (mirrors the regexp matching of the personal rule).
  const almacenCities = new Map();
  for (const u of users) {
    if (normalizeRole(u.role || '') !== ROLE_KEYS.almacen) continue;
    const scope = resolveInventoryScopeByCity(u.city || '');
    const label = scope?.canonical || String(u.city || '');
    if (!almacenCities.has(label)) almacenCities.set(label, 0);
  }
  const almacenFilter = buildDateFilter(month, year, 'q', 3);
  if (almacenFilter.error) return { error: almacenFilter.error };
  for (const city of almacenCities.keys()) {
    const localRes = await pool.query(
      `SELECT COALESCE(SUM(q.total), 0) AS total_sales
       FROM commission_entries q
       WHERE q.kind = $1
         AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
             LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
         ${almacenFilter.sql}`,
      [KIND_SHIPMENT, city, ...almacenFilter.params]
    );
    almacenCities.set(city, Number(localRes.rows[0]?.total_sales || 0));
  }

  const results = users.map((u) => {
    const role = normalizeRole(u.role || '');
    const ownSales = salesByUser.get(Number(u.id)) || 0;
    let commission = 0;
    let source = 'Rol sin comisión configurada';

    if (role === ROLE_KEYS.admin) {
      commission = allSales * rateAdmin;
      source = `${Number(settings.admin_percent || 0)}% del total de ventas`;
    } else if (role === ROLE_KEYS.marketingLider) {
      commission = allSales * rateMarketingLider;
      source = `${Number(settings.marketing_lider_percent || 0)}% de todas las ventas`;
    } else if (role === ROLE_KEYS.ventasLider) {
      commission = (ventasTeamSales + ownSales) * rateVentasLider;
      source = `${Number(settings.ventas_lider_percent || 0)}% ventas equipo + propias`;
    } else if (isSalesRole(u.role)) {
      const isTop = topSellerId === Number(u.id);
      commission = ownSales * (isTop ? rateVentasTop : rateVentasRegular);
      source = isTop
        ? `Mejor en ventas (${Number(settings.ventas_top_percent || 0)}%)`
        : `Asesor de ventas (${Number(settings.ventas_regular_percent || 0)}%)`;
    } else if (role === ROLE_KEYS.almacen) {
      const scope = resolveInventoryScopeByCity(u.city || '');
      const label = scope?.canonical || String(u.city || '');
      commission = (almacenCities.get(label) || 0) * rateAlmacen;
      source = `${Number(settings.almacen_percent || 0)}% pedidos enviados de ${label || 'su almacén'}`;
    } else if (role === ROLE_KEYS.almacenLider) {
      commission = allSales * rateAlmacenLider;
      source = `${Number(settings.almacen_lider_percent || 0)}% del total de ventas`;
    } else if (role === ROLE_KEYS.marketing) {
      commission = 0;
      source = 'Compensación por contrato';
    } else if (role === ROLE_KEYS.produccion) {
      commission = allSales * rateProduccion;
      source = `${Number(settings.produccion_percent || 0)}% del total de ventas`;
    }

    return {
      user_id: Number(u.id),
      email: String(u.email || '').trim(),
      display_name: String(u.display_name || '').trim(),
      role: String(u.role || '').trim() || 'Sin rol',
      city: String(u.city || '').trim(),
      commission: Math.round(commission * 100) / 100,
      is_top_seller: topSellerId === Number(u.id),
      source
    };
  });

  return { users: results, all_sales: Math.round(allSales * 100) / 100, closed: false };
};

module.exports = { computeTeamCommissions };
