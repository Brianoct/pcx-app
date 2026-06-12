
const REPORTING_TIMEZONE = 'America/La_Paz';

const COMPLETED_STATUSES = ['Confirmado', 'Pagado', 'Embalado', 'Enviado'];

const TIMESTAMP_STORAGE_TIMEZONE = 'UTC';

const buildReportingCreatedAtExpr = (tableAlias = 'q') => (
  `timezone('${REPORTING_TIMEZONE}', ${tableAlias}.created_at AT TIME ZONE '${TIMESTAMP_STORAGE_TIMEZONE}')`
);

const buildDateFilter = (month, year, tableAlias = 'q', startIndex = 1) => {
  const params = [];
  const clauses = [];
  const reportingCreatedAtExpr = buildReportingCreatedAtExpr(tableAlias);

  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;

  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    return { error: 'Mes inválido. Debe estar entre 1 y 12' };
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    return { error: 'Año inválido' };
  }

  if (monthNum !== null) {
    params.push(monthNum);
    clauses.push(`EXTRACT(MONTH FROM ${reportingCreatedAtExpr}) = $${startIndex + params.length - 1}`);
  }
  if (yearNum !== null) {
    params.push(yearNum);
    clauses.push(`EXTRACT(YEAR FROM ${reportingCreatedAtExpr}) = $${startIndex + params.length - 1}`);
  }

  const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  return { params, sql };
};

module.exports = {
  COMPLETED_STATUSES,
  REPORTING_TIMEZONE,
  TIMESTAMP_STORAGE_TIMEZONE,
  buildDateFilter,
  buildReportingCreatedAtExpr
};
