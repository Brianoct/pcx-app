// Client-side mirror of backend/lib/calendar.js event catalog. Used as a fallback
// and for instant rendering; the live catalog is fetched from /api/calendar/types.
export const EVENT_TYPE_LIST = [
  { key: 'vacation', label: 'Vacaciones', color: '#0ea5e9', category: 'time_off', default_all_day: true },
  { key: 'partial_day', label: 'Día parcial / Salida', color: '#6366f1', category: 'time_off', default_all_day: false },
  { key: 'sick', label: 'Enfermedad', color: '#ef4444', category: 'time_off', default_all_day: true },
  { key: 'project_task', label: 'Tarea de proyecto', color: '#f59e0b', category: 'work', default_all_day: true },
  { key: 'marketing', label: 'Promoción de marketing', color: '#ec4899', category: 'work', default_all_day: true },
  { key: 'meeting', label: 'Reunión', color: '#8b5cf6', category: 'work', default_all_day: false },
  { key: 'deadline', label: 'Fecha límite / Entrega', color: '#dc2626', category: 'work', default_all_day: true },
  { key: 'training', label: 'Capacitación', color: '#14b8a6', category: 'work', default_all_day: false },
  { key: 'travel', label: 'Viaje', color: '#0891b2', category: 'work', default_all_day: true },
  { key: 'holiday', label: 'Feriado', color: '#16a34a', category: 'work', default_all_day: true },
  { key: 'coordination', label: 'Coordinación', color: '#64748b', category: 'work', default_all_day: true },
  { key: 'other', label: 'Otro', color: '#78716c', category: 'work', default_all_day: true }
];

export const buildTypeMap = (list) => {
  const map = {};
  for (const item of list || []) map[item.key] = item;
  return map;
};

export const DEFAULT_TYPE_MAP = buildTypeMap(EVENT_TYPE_LIST);

export const STATUS_LABELS = {
  confirmed: 'Confirmado',
  tentative: 'Tentativo',
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado'
};

const pad2 = (n) => String(n).padStart(2, '0');

export const toDateText = (dateObj) =>
  `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;

export const todayText = () => toDateText(new Date());

// Monday-first 6-week grid covering the given month.
export const getMonthGrid = (monthCursor) => {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const first = new Date(year, month, 1);
  // JS: 0=Sun..6=Sat. Shift so Monday is the first column.
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - offset);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return cells;
};

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export const formatDateLong = (value) => {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  return new Date(`${text}T00:00:00`).toLocaleDateString('es-BO', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
};

export const formatDateShort = (value) => {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  return new Date(`${text}T00:00:00`).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' });
};

// Events whose [start_date, end_date] range covers the given YYYY-MM-DD.
export const eventsOnDay = (events, dayText) =>
  (events || []).filter((ev) => {
    const start = String(ev.start_date).slice(0, 10);
    const end = String(ev.end_date || ev.start_date).slice(0, 10);
    return start <= dayText && dayText <= end;
  });
