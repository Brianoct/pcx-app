const { pool } = require('../db');
const { isPgUndefinedTableError } = require('../db');
const { normalizeText } = require('./rbac');
const { computeBusinessDaysInclusive, makeYearWindow } = require('./timeoff');

// Annual paid quota (only approved time off counts toward usage).
const ANNUAL_LIMITS = {
  vacation: 14,
  sick: 5
};

// Single catalog of everything the centralized calendar can track. `category`
// drives behavior: `time_off` types use the approval workflow + quota, the rest
// are confirmed on creation.
const EVENT_TYPES = {
  vacation: { label: 'Vacaciones', color: '#0ea5e9', category: 'time_off', countsAs: 'vacation', requiresApproval: true, defaultAllDay: true },
  partial_day: { label: 'Día parcial / Salida', color: '#6366f1', category: 'time_off', countsAs: null, requiresApproval: true, defaultAllDay: false },
  sick: { label: 'Enfermedad', color: '#ef4444', category: 'time_off', countsAs: 'sick', requiresApproval: true, defaultAllDay: true },
  project_task: { label: 'Tarea de proyecto', color: '#f59e0b', category: 'work', defaultAllDay: true },
  marketing: { label: 'Promoción de marketing', color: '#ec4899', category: 'work', defaultAllDay: true },
  meeting: { label: 'Reunión', color: '#8b5cf6', category: 'work', defaultAllDay: false },
  deadline: { label: 'Fecha límite / Entrega', color: '#dc2626', category: 'work', defaultAllDay: true },
  training: { label: 'Capacitación', color: '#14b8a6', category: 'work', defaultAllDay: false },
  travel: { label: 'Viaje', color: '#0891b2', category: 'work', defaultAllDay: true },
  holiday: { label: 'Feriado', color: '#16a34a', category: 'work', defaultAllDay: true },
  coordination: { label: 'Coordinación', color: '#64748b', category: 'work', defaultAllDay: true },
  other: { label: 'Otro', color: '#78716c', category: 'work', defaultAllDay: true }
};

const TIME_OFF_TYPES = Object.keys(EVENT_TYPES).filter((key) => EVENT_TYPES[key].category === 'time_off');

const VISIBILITY_VALUES = ['personal', 'team'];
const STATUS_VALUES = ['confirmed', 'tentative', 'pending', 'approved', 'rejected'];

const EVENT_TYPE_ALIASES = {
  vacaciones: 'vacation',
  sick_leave: 'sick',
  sickleave: 'sick',
  enfermedad: 'sick',
  baja_medica: 'sick',
  early_leave: 'partial_day',
  earlyleave: 'partial_day',
  salida_anticipada: 'partial_day',
  dia_parcial: 'partial_day',
  permiso: 'coordination',
  task: 'project_task',
  tarea: 'project_task',
  proyecto: 'project_task',
  promo: 'marketing',
  promocion: 'marketing',
  reunion: 'meeting',
  capacitacion: 'training',
  viaje: 'travel',
  feriado: 'holiday',
  coordinacion: 'coordination',
  otro: 'other'
};

const normalizeKey = (value = '') => normalizeText(value).replace(/[\s-]+/g, '_');

const normalizeEventType = (value = '') => {
  const key = normalizeKey(value);
  if (EVENT_TYPES[key]) return key;
  return EVENT_TYPE_ALIASES[key] || null;
};

const normalizeVisibility = (value) => {
  if (value === undefined || value === null || value === '') return 'team';
  const key = normalizeKey(value);
  if (key === 'personal' || key === 'privado' || key === 'private') return 'personal';
  return 'team';
};

const STATUS_ALIASES = {
  confirmed: 'confirmed',
  confirmado: 'confirmed',
  tentative: 'tentative',
  tentativo: 'tentative',
  pending: 'pending',
  pendiente: 'pending',
  approved: 'approved',
  aprobado: 'approved',
  rejected: 'rejected',
  rechazado: 'rejected'
};

const normalizeStatus = (value = '') => STATUS_ALIASES[normalizeKey(value)] || null;

const isTimeOffType = (eventType) => TIME_OFF_TYPES.includes(eventType);

// Legacy (time_off_requests) <-> calendar event type mapping, kept so the
// /api/time-off/* compatibility endpoints return the historical shape.
const LEGACY_TO_EVENT = { vacation: 'vacation', sick_leave: 'sick', early_leave: 'partial_day', other: 'coordination' };
const EVENT_TO_LEGACY = { vacation: 'vacation', sick: 'sick_leave', partial_day: 'early_leave', coordination: 'other', other: 'other' };

const LEGACY_TYPE_LABELS = {
  vacation: 'Vacaciones',
  sick_leave: 'Baja médica',
  early_leave: 'Salida anticipada',
  other: 'Otro permiso'
};
const LEGACY_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado'
};

const eventTypeMeta = (eventType) => {
  const meta = EVENT_TYPES[eventType] || EVENT_TYPES.other;
  return { event_type: eventType, type_label: meta.label, color: meta.color, category: meta.category };
};

const decorateEvent = (row, currentUserId) => {
  const meta = EVENT_TYPES[row.event_type] || EVENT_TYPES.other;
  return {
    ...row,
    type_label: meta.label,
    color: meta.color,
    category: meta.category,
    is_owner: Number(row.user_id) === Number(currentUserId)
  };
};

// Summary of approved time off for a user in a given year.
const computeCalendarTimeOffSummary = async (userId, year) => {
  const { start, end } = makeYearWindow(year);
  let result;
  try {
    result = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'vacation' AND status = 'approved' THEN total_days ELSE 0 END), 0) AS vacation_used,
         COALESCE(SUM(CASE WHEN event_type = 'sick' AND status = 'approved' THEN total_days ELSE 0 END), 0) AS sick_used,
         COALESCE(SUM(CASE WHEN event_type = 'partial_day' AND status = 'approved' THEN total_days ELSE 0 END), 0) AS partial_used
       FROM calendar_events
       WHERE user_id = $1
         AND event_type IN ('vacation', 'sick', 'partial_day')
         AND start_date <= $3::date
         AND end_date >= $2::date`,
      [userId, start, end]
    );
  } catch (err) {
    if (isPgUndefinedTableError(err)) {
      return {
        year,
        vacation_used: 0,
        sick_used: 0,
        partial_used: 0,
        other_used: 0,
        vacation_remaining: ANNUAL_LIMITS.vacation,
        sick_remaining: ANNUAL_LIMITS.sick
      };
    }
    throw err;
  }
  const vacationUsed = Number(result.rows[0]?.vacation_used || 0);
  const sickUsed = Number(result.rows[0]?.sick_used || 0);
  const partialUsed = Number(result.rows[0]?.partial_used || 0);
  return {
    year,
    vacation_used: vacationUsed,
    sick_used: sickUsed,
    partial_used: partialUsed,
    other_used: partialUsed,
    vacation_remaining: Math.max(0, ANNUAL_LIMITS.vacation - vacationUsed),
    sick_remaining: Math.max(0, ANNUAL_LIMITS.sick - sickUsed)
  };
};

module.exports = {
  ANNUAL_LIMITS,
  EVENT_TYPES,
  TIME_OFF_TYPES,
  VISIBILITY_VALUES,
  STATUS_VALUES,
  LEGACY_TO_EVENT,
  EVENT_TO_LEGACY,
  LEGACY_TYPE_LABELS,
  LEGACY_STATUS_LABELS,
  computeBusinessDaysInclusive,
  computeCalendarTimeOffSummary,
  decorateEvent,
  eventTypeMeta,
  isTimeOffType,
  normalizeEventType,
  normalizeStatus,
  normalizeVisibility
};
