const { pool } = require('../db');
const { buildAdminAiExpandedDataset } = require('./adminAi');
const { ROLE_KEYS } = require('./rbac');
const { COMPLETED_STATUSES, buildDateFilter } = require('./reporting');
const { createHttpError } = require('./util');

// Focused, per-intent analytics datasets used by both the admin stats AI
// endpoint and the gated AI assistant. Each query returns aggregated rows
// only (no sensitive customer fields).
const runAdminAnalyticsQuery = async ({ queryKey, month, year }) => {
  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;
  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    throw createHttpError(400, 'Mes inválido. Debe estar entre 1 y 12');
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    throw createHttpError(400, 'Año inválido');
  }
  const dateFilter = buildDateFilter(month, year, 'q', 2);
  if (dateFilter.error) {
    throw createHttpError(400, dateFilter.error);
  }
  const dateFilterWithStatusAndRole = buildDateFilter(month, year, 'q', 3);
  if (dateFilterWithStatusAndRole.error) {
    throw createHttpError(400, dateFilterWithStatusAndRole.error);
  }

  switch (queryKey) {
    case 'full_business_snapshot': {
      return buildAdminAiExpandedDataset({ month, year });
    }
    case 'sales_summary': {
      const result = await pool.query(
        `SELECT
           COUNT(*) AS orders_count,
           COALESCE(SUM(q.total), 0) AS total_sales_bs,
           COALESCE(AVG(q.total), 0) AS avg_order_bs
         FROM quotes q
         WHERE q.status = ANY($1::text[])${dateFilter.sql}`,
        [COMPLETED_STATUSES, ...dateFilter.params]
      );
      return {
        title: 'Resumen de ventas',
        rows: result.rows || []
      };
    }
    case 'top_products': {
      const result = await pool.query(
        `SELECT
           li->>'sku' AS sku,
           li->>'displayName' AS product_name,
           SUM(CAST(li->>'qty' AS INTEGER)) AS total_qty
         FROM quotes q,
         LATERAL jsonb_array_elements(q.line_items) li
         WHERE q.status = ANY($1::text[])${dateFilter.sql}
         GROUP BY sku, product_name
         ORDER BY total_qty DESC
         LIMIT 15`,
        [COMPLETED_STATUSES, ...dateFilter.params]
      );
      return {
        title: 'Top productos por cantidad',
        rows: result.rows || []
      };
    }
    case 'top_sellers': {
      const result = await pool.query(
        `SELECT
           COALESCE(q.vendor, u.display_name, u.email, 'Sin vendedor') AS seller,
           COUNT(*) AS order_count,
           COALESCE(SUM(q.total), 0) AS total_sales_bs
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])${dateFilter.sql}
         GROUP BY seller
         ORDER BY total_sales_bs DESC
         LIMIT 15`,
        [COMPLETED_STATUSES, ...dateFilter.params]
      );
      return {
        title: 'Top vendedores',
        rows: result.rows || []
      };
    }
    case 'commission_projection': {
      const result = await pool.query(
        `SELECT
           COALESCE(u.display_name, u.email) AS user_name,
           u.role,
           COALESCE(SUM(q.total), 0) AS shipped_sales_bs
         FROM users u
         LEFT JOIN quotes q ON q.user_id = u.id
           AND q.status = 'Enviado'${dateFilter.sql}
         WHERE u.is_active = TRUE
         GROUP BY user_name, u.role
         ORDER BY shipped_sales_bs DESC, user_name ASC
         LIMIT 20`,
        dateFilter.params
      );
      return {
        title: 'Proyección base por ventas enviadas',
        rows: result.rows || []
      };
    }
    case 'warehouse_throughput': {
      const result = await pool.query(
        `SELECT
           COALESCE(q.store_location, 'Sin almacén') AS warehouse,
           COUNT(*) AS order_count,
           COALESCE(SUM(q.total), 0) AS total_sales_bs
         FROM quotes q
         WHERE q.status = 'Enviado'${dateFilter.sql}
         GROUP BY warehouse
         ORDER BY order_count DESC`,
        dateFilter.params
      );
      return {
        title: 'Rendimiento por almacén',
        rows: result.rows || []
      };
    }
    case 'leader_team_sales': {
      const result = await pool.query(
        `SELECT
           COALESCE(leader.display_name, leader.email) AS leader_name,
           COALESCE(SUM(q.total), 0) AS team_sales_bs
         FROM users leader
         LEFT JOIN quotes q ON q.user_id = leader.id
           AND q.status = ANY($1::text[])${dateFilterWithStatusAndRole.sql}
         WHERE leader.is_active = TRUE
           AND LOWER(leader.role) = $2
         GROUP BY leader_name
         ORDER BY team_sales_bs DESC`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventasLider, ...dateFilterWithStatusAndRole.params]
      );
      return {
        title: 'Ventas de líderes de ventas',
        rows: result.rows || []
      };
    }
    default:
      throw createHttpError(400, 'Consulta analítica no permitida');
  }
};

const formatPeriodLabel = (month, year) => {
  const monthNum = Number.parseInt(month, 10);
  const yearNum = Number.parseInt(year, 10);
  if (Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 && Number.isInteger(yearNum)) {
    const monthLabel = new Date(0, monthNum - 1).toLocaleString('es-BO', { month: 'long' });
    return `${monthLabel} ${yearNum}`;
  }
  return 'Periodo actual';
};

module.exports = {
  runAdminAnalyticsQuery,
  formatPeriodLabel
};
