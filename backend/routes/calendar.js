const express = require('express');
const { pool } = require('../db');
const { isPgUndefinedTableError } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { canAccessPanel } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const {
  EVENT_TYPES,
  computeBusinessDaysInclusive,
  computeCalendarTimeOffSummary,
  decorateEvent,
  isTimeOffType,
  normalizeEventType,
  normalizeStatus,
  normalizeVisibility
} = require('../lib/calendar');
const { parseYearOrCurrent } = require('../lib/timeoff');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isValidDate = (value) => typeof value === 'string' && DATE_RE.test(value);
const isValidTime = (value) => typeof value === 'string' && TIME_RE.test(value);

const pad2 = (n) => String(n).padStart(2, '0');
const toDateText = (dateObj) => `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;

// Default window: current month padded by a month on each side.
const resolveWindow = (startRaw, endRaw) => {
  if (isValidDate(startRaw) && isValidDate(endRaw)) {
    return { start: startRaw, end: endRaw };
  }
  const now = new Date();
  const start = toDateText(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const end = toDateText(new Date(now.getFullYear(), now.getMonth() + 2, 0));
  return { start, end };
};

const ensureCalendarAccess = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'calendario')) {
    res.status(403).json({ error: 'No tienes acceso al calendario' });
    return null;
  }
  return userContext;
};

const SELECT_COLUMNS = `
  e.id, e.user_id, owner.email AS owner_email, owner.display_name AS owner_name,
  e.created_by, e.title, e.event_type, e.start_date, e.end_date, e.all_day,
  e.start_time, e.end_time, e.total_days, e.visibility, e.status, e.notes,
  e.created_at, e.updated_at`;

// ─── Catalog of event types (legend + form select) ──────────────────────────
router.get('/api/calendar/types', authenticateToken, (req, res) => {
  const types = Object.entries(EVENT_TYPES).map(([key, meta]) => ({
    key,
    label: meta.label,
    color: meta.color,
    category: meta.category,
    default_all_day: Boolean(meta.defaultAllDay),
    requires_approval: Boolean(meta.requiresApproval)
  }));
  res.json(types);
});

// ─── Events visible to the current user within a window ──────────────────────
router.get('/api/calendar/events', authenticateToken, async (req, res) => {
  const userContext = await ensureCalendarAccess(req, res);
  if (!userContext) return;

  const { start, end } = resolveWindow(req.query.start, req.query.end);
  const onlyMine = String(req.query.mine || '') === 'true';
  const isAdmin = String(userContext.role || '').trim().toLowerCase() === 'admin';

  // Non-admins see their own events plus anything shared with the team.
  // Admins see everything for coordination. Build params dynamically so we only
  // bind $3 (user id) when the scope clause actually references it — otherwise
  // Postgres rejects the query ("bind message supplies 3 parameters, but
  // prepared statement requires 2").
  const params = [start, end];
  let scopeSql;
  if (onlyMine) {
    params.push(req.user.id);
    scopeSql = `e.user_id = $${params.length}`;
  } else if (isAdmin) {
    scopeSql = 'TRUE';
  } else {
    params.push(req.user.id);
    scopeSql = `(e.visibility = 'team' OR e.user_id = $${params.length})`;
  }

  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLUMNS}
       FROM calendar_events e
       JOIN users owner ON owner.id = e.user_id
       WHERE e.start_date <= $2::date
         AND e.end_date >= $1::date
         AND ${scopeSql}
       ORDER BY e.start_date ASC, e.all_day DESC, e.start_time ASC NULLS FIRST, e.id ASC`,
      params
    );
    res.json(result.rows.map((row) => decorateEvent(row, req.user.id)));
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.json([]);
    console.error('Calendar events error:', err);
    res.status(500).json({ error: 'No se pudieron cargar los eventos del calendario' });
  }
});

// ─── Annual time-off summary for the current user ────────────────────────────
router.get('/api/calendar/summary', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    const summary = await computeCalendarTimeOffSummary(req.user.id, year);
    res.json(summary);
  } catch (err) {
    console.error('Calendar summary error:', err);
    res.status(500).json({ error: 'No se pudo cargar el resumen del calendario' });
  }
});

const validateEventPayload = (body, { partial = false } = {}) => {
  const out = {};
  const errors = [];

  if (!partial || body.event_type !== undefined) {
    const eventType = normalizeEventType(body.event_type);
    if (!eventType) errors.push('Tipo de evento inválido');
    out.event_type = eventType;
  }
  if (!partial || body.title !== undefined) {
    out.title = String(body.title || '').trim();
  }
  if (!partial || body.start_date !== undefined) {
    if (!isValidDate(body.start_date)) errors.push('Fecha de inicio inválida');
    out.start_date = body.start_date;
  }
  if (!partial || body.end_date !== undefined) {
    out.end_date = isValidDate(body.end_date) ? body.end_date : body.start_date;
  }
  if (body.all_day !== undefined) out.all_day = Boolean(body.all_day);
  if (body.start_time !== undefined) {
    out.start_time = body.start_time && isValidTime(body.start_time) ? body.start_time : null;
  }
  if (body.end_time !== undefined) {
    out.end_time = body.end_time && isValidTime(body.end_time) ? body.end_time : null;
  }
  if (body.visibility !== undefined) out.visibility = normalizeVisibility(body.visibility);
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes).slice(0, 2000) : null;

  return { value: out, errors };
};

// ─── Create event ────────────────────────────────────────────────────────────
router.post('/api/calendar/events', authenticateToken, async (req, res) => {
  const userContext = await ensureCalendarAccess(req, res);
  if (!userContext) return;

  const { value, errors } = validateEventPayload(req.body || {}, { partial: false });
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const eventType = value.event_type;
  const meta = EVENT_TYPES[eventType];
  const startDate = value.start_date;
  const endDate = value.end_date && value.end_date >= startDate ? value.end_date : startDate;
  const title = value.title || meta.label;
  const allDay = value.all_day !== undefined ? value.all_day : Boolean(meta.defaultAllDay);
  const visibility = value.visibility || 'team';
  const startTime = allDay ? null : (value.start_time || null);
  const endTime = allDay ? null : (value.end_time || null);
  const notes = value.notes || null;

  const timeOff = isTimeOffType(eventType);
  let totalDays = null;
  let status = 'confirmed';

  if (timeOff) {
    totalDays = computeBusinessDaysInclusive(startDate, endDate);
    if (totalDays <= 0) {
      return res.status(400).json({ error: 'El rango no incluye días laborables' });
    }
    status = 'pending';
    if (meta.countsAs === 'vacation' || meta.countsAs === 'sick') {
      const year = parseYearOrCurrent(String(startDate).slice(0, 4));
      const summary = await computeCalendarTimeOffSummary(req.user.id, year);
      if (meta.countsAs === 'vacation' && totalDays > summary.vacation_remaining) {
        return res.status(400).json({ error: `Supera el cupo anual de vacaciones. Disponible: ${summary.vacation_remaining} día(s)` });
      }
      if (meta.countsAs === 'sick' && totalDays > summary.sick_remaining) {
        return res.status(400).json({ error: `Supera el cupo anual de enfermedad. Disponible: ${summary.sick_remaining} día(s)` });
      }
    }
  } else if (normalizeStatus(req.body?.status) === 'tentative') {
    status = 'tentative';
  }

  try {
    const result = await pool.query(
      `INSERT INTO calendar_events
         (user_id, created_by, title, event_type, start_date, end_date, all_day,
          start_time, end_time, total_days, visibility, status, notes)
       VALUES ($1, $1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, user_id, created_by, title, event_type, start_date, end_date,
                 all_day, start_time, end_time, total_days, visibility, status, notes,
                 created_at, updated_at`,
      [req.user.id, title, eventType, startDate, endDate, allDay, startTime, endTime, totalDays, visibility, status, notes]
    );
    res.status(201).json(decorateEvent(result.rows[0], req.user.id));
  } catch (err) {
    if (isPgUndefinedTableError(err)) {
      return res.status(503).json({ error: 'Calendario no inicializado. Falta aplicar migración en base de datos.' });
    }
    console.error('Create calendar event error:', err);
    res.status(500).json({ error: 'No se pudo crear el evento' });
  }
});

const loadEventForMutation = async (id) => {
  const result = await pool.query(
    'SELECT id, user_id, event_type, start_date, end_date, all_day, status FROM calendar_events WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

// ─── Update event (owner or admin) ───────────────────────────────────────────
router.patch('/api/calendar/events/:id', authenticateToken, async (req, res) => {
  const userContext = await ensureCalendarAccess(req, res);
  if (!userContext) return;

  const isAdmin = String(userContext.role || '').trim().toLowerCase() === 'admin';
  let existing;
  try {
    existing = await loadEventForMutation(req.params.id);
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.status(404).json({ error: 'Evento no encontrado' });
    throw err;
  }
  if (!existing) return res.status(404).json({ error: 'Evento no encontrado' });
  if (Number(existing.user_id) !== Number(req.user.id) && !isAdmin) {
    return res.status(403).json({ error: 'Solo puedes editar tus propios eventos' });
  }

  const { value, errors } = validateEventPayload(req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const eventType = value.event_type || existing.event_type;
  const startDate = value.start_date || existing.start_date;
  let endDate = value.end_date !== undefined ? value.end_date : existing.end_date;
  if (!endDate || endDate < startDate) endDate = startDate;
  const allDay = value.all_day !== undefined ? value.all_day : existing.all_day;

  let totalDays = existing.total_days;
  let status = existing.status;
  if (isTimeOffType(eventType)) {
    totalDays = computeBusinessDaysInclusive(
      typeof startDate === 'string' ? startDate : toDateText(new Date(startDate)),
      typeof endDate === 'string' ? endDate : toDateText(new Date(endDate))
    );
    if (totalDays <= 0) return res.status(400).json({ error: 'El rango no incluye días laborables' });
    // Editing a pending/confirmed time-off resets it for re-approval.
    if (existing.status !== 'approved' && existing.status !== 'rejected') status = 'pending';
  } else if (isTimeOffType(existing.event_type)) {
    totalDays = null;
    status = 'confirmed';
  }

  const fields = {
    title: value.title !== undefined ? (value.title || EVENT_TYPES[eventType].label) : undefined,
    event_type: value.event_type !== undefined ? eventType : undefined,
    start_date: value.start_date !== undefined ? startDate : undefined,
    end_date: value.end_date !== undefined || value.start_date !== undefined ? endDate : undefined,
    all_day: value.all_day !== undefined ? allDay : undefined,
    start_time: value.start_time !== undefined ? (allDay ? null : value.start_time) : (allDay ? null : undefined),
    end_time: value.end_time !== undefined ? (allDay ? null : value.end_time) : (allDay ? null : undefined),
    visibility: value.visibility !== undefined ? value.visibility : undefined,
    notes: value.notes !== undefined ? value.notes : undefined,
    total_days: totalDays,
    status
  };

  const setClauses = [];
  const params = [];
  let idx = 1;
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    setClauses.push(`${col} = $${idx}`);
    params.push(val);
    idx += 1;
  }
  setClauses.push('updated_at = NOW()');
  params.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE calendar_events SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING id, user_id, created_by, title, event_type, start_date, end_date,
                 all_day, start_time, end_time, total_days, visibility, status, notes,
                 created_at, updated_at`,
      params
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(decorateEvent(result.rows[0], req.user.id));
  } catch (err) {
    console.error('Update calendar event error:', err);
    res.status(500).json({ error: 'No se pudo actualizar el evento' });
  }
});

// ─── Delete event (owner or admin) ───────────────────────────────────────────
router.delete('/api/calendar/events/:id', authenticateToken, async (req, res) => {
  const userContext = await ensureCalendarAccess(req, res);
  if (!userContext) return;
  const isAdmin = String(userContext.role || '').trim().toLowerCase() === 'admin';

  try {
    const existing = await loadEventForMutation(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Evento no encontrado' });
    if (Number(existing.user_id) !== Number(req.user.id) && !isAdmin) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios eventos' });
    }
    await pool.query('DELETE FROM calendar_events WHERE id = $1', [req.params.id]);
    res.json({ message: 'Evento eliminado', id: Number(req.params.id) });
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.status(404).json({ error: 'Evento no encontrado' });
    console.error('Delete calendar event error:', err);
    res.status(500).json({ error: 'No se pudo eliminar el evento' });
  }
});

// ─── Admin: approve / reject / reset time-off events ─────────────────────────
router.patch('/api/calendar/events/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  const status = normalizeStatus(req.body?.status);
  if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const shouldApprove = status === 'approved';
  try {
    const result = await pool.query(
      `UPDATE calendar_events
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, status`,
      [status, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Estado actualizado', id: result.rows[0].id, status: result.rows[0].status, approved: shouldApprove });
  } catch (err) {
    console.error('Calendar status error:', err);
    res.status(500).json({ error: 'No se pudo actualizar el estado del evento' });
  }
});

module.exports = router;
