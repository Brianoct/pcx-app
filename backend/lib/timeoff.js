const { pool } = require('../db');
const { isPgUndefinedColumnError, isPgUndefinedTableError } = require('../db');
const { normalizeText } = require('./rbac');

const TIME_OFF_LIMITS = {
  vacation: 14,
  sick_leave: 5
};

const TIME_OFF_TYPE_LABELS = {
  vacation: 'Vacaciones',
  sick_leave: 'Baja médica',
  early_leave: 'Salida anticipada',
  other: 'Otro permiso'
};

const TIME_OFF_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado'
};

const normalizeTimeOffType = (value = '') => {
  const normalized = normalizeText(value).replace(/-/g, '_');
  const map = {
    vacation: 'vacation',
    vacaciones: 'vacation',
    sick_leave: 'sick_leave',
    sickleave: 'sick_leave',
    enfermedad: 'sick_leave',
    'baja medica': 'sick_leave',
    early_leave: 'early_leave',
    earlyleave: 'early_leave',
    'salida anticipada': 'early_leave',
    other: 'other',
    permiso: 'other',
    otro: 'other'
  };
  return map[normalized] || null;
};

const normalizeTimeOffStatus = (value = '') => {
  const normalized = normalizeText(value).replace(/-/g, '_');
  const map = {
    pending: 'pending',
    pendiente: 'pending',
    approved: 'approved',
    aprobado: 'approved',
    rejected: 'rejected',
    rechazado: 'rejected'
  };
  return map[normalized] || null;
};

const parseYearOrCurrent = (value) => {
  if (value === undefined || value === null || value === '') return new Date().getFullYear();
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return null;
  }
  return year;
};

const makeYearWindow = (year) => {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return { start, end };
};

const isWeekend = (dateObj) => {
  const day = dateObj.getDay();
  return day === 0 || day === 6;
};

const toUtcDate = (dateValue) => {
  const [y, m, d] = String(dateValue).split('-').map((v) => Number.parseInt(v, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
};

const computeBusinessDaysInclusive = (startDate, endDate) => {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (!start || !end || end < start) return 0;
  let days = 0;
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    if (!isWeekend(cursor)) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

const buildTimeOffSummaryQuery = (daysColumn) => (
  `SELECT
     COALESCE(SUM(CASE
       WHEN leave_type IN ('vacation', 'vacaciones') AND status IN ('approved', 'aprobado')
         THEN ${daysColumn}
       ELSE 0
     END), 0) AS vacation_used,
     COALESCE(SUM(CASE
       WHEN leave_type IN ('sick_leave', 'enfermedad') AND status IN ('approved', 'aprobado')
         THEN ${daysColumn}
       ELSE 0
     END), 0) AS sick_used,
     COALESCE(SUM(CASE
       WHEN leave_type IN ('early_leave', 'other', 'permiso') AND status IN ('approved', 'aprobado')
         THEN ${daysColumn}
       ELSE 0
     END), 0) AS other_used
   FROM time_off_requests
   WHERE user_id = $1
     AND start_date <= $3::date
     AND end_date >= $2::date`
);

const computeTimeOffSummary = async (userId, year) => {
  const { start, end } = makeYearWindow(year);
  let result;
  try {
    result = await pool.query(buildTimeOffSummaryQuery('total_days'), [userId, start, end]);
  } catch (err) {
    if (isPgUndefinedTableError(err)) {
      return {
        year,
        vacation_used: 0,
        sick_used: 0,
        other_used: 0,
        vacation_remaining: TIME_OFF_LIMITS.vacation,
        sick_remaining: TIME_OFF_LIMITS.sick_leave
      };
    }
    if (isPgUndefinedColumnError(err)) {
      result = await pool.query(buildTimeOffSummaryQuery('business_days'), [userId, start, end]);
    } else {
      throw err;
    }
  }
  const vacationUsed = Number(result.rows[0]?.vacation_used || 0);
  const sickUsed = Number(result.rows[0]?.sick_used || 0);
  const otherUsed = Number(result.rows[0]?.other_used || 0);
  return {
    year,
    vacation_used: vacationUsed,
    sick_used: sickUsed,
    other_used: otherUsed,
    vacation_remaining: Math.max(0, TIME_OFF_LIMITS.vacation - vacationUsed),
    sick_remaining: Math.max(0, TIME_OFF_LIMITS.sick_leave - sickUsed)
  };
};

module.exports = {
  TIME_OFF_LIMITS,
  TIME_OFF_STATUS_LABELS,
  TIME_OFF_TYPE_LABELS,
  buildTimeOffSummaryQuery,
  computeBusinessDaysInclusive,
  computeTimeOffSummary,
  isWeekend,
  makeYearWindow,
  normalizeTimeOffStatus,
  normalizeTimeOffType,
  parseYearOrCurrent,
  toUtcDate
};
