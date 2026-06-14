const express = require('express');
const { pool } = require('../db');
const { isPgUndefinedTableError } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { canAccessPanel } = require('../lib/rbac');
const {
  EVENT_TO_LEGACY,
  LEGACY_STATUS_LABELS,
  LEGACY_TYPE_LABELS,
  computeBusinessDaysInclusive,
  computeCalendarTimeOffSummary,
  normalizeEventType,
  normalizeStatus
} = require('../lib/calendar');
const { makeYearWindow, parseYearOrCurrent } = require('../lib/timeoff');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// Backwards-compatible time-off API. The centralized calendar (calendar_events)
// is now the single source of truth; these endpoints expose the time-off subset
// (vacation / sick / partial day) in the historical shape so the admin approval
// panel and older clients keep working.
const TIME_OFF_EVENT_TYPES = ['vacation', 'sick', 'partial_day'];

const toLegacyType = (eventType) => EVENT_TO_LEGACY[eventType] || 'other';

const mapMineRow = (row) => {
  const legacyType = toLegacyType(row.event_type);
  return {
    id: row.id,
    leave_type: legacyType,
    request_type: legacyType,
    start_date: row.start_date,
    end_date: row.end_date,
    days_count: row.total_days,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

// ─── User: my time-off events for a year ─────────────────────────────────────
router.get('/api/time-off/mine', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  const { start, end } = makeYearWindow(year);
  try {
    const result = await pool.query(
      `SELECT id, event_type, start_date, end_date, total_days, notes, status, created_at, updated_at
       FROM calendar_events
       WHERE user_id = $1
         AND event_type = ANY($4::text[])
         AND start_date <= $3::date
         AND end_date >= $2::date
       ORDER BY start_date DESC, id DESC`,
      [req.user.id, start, end, TIME_OFF_EVENT_TYPES]
    );
    res.json(result.rows.map(mapMineRow));
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.json([]);
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar tus permisos' });
  }
});

router.get('/api/time-off/mine/summary', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    res.json(await computeCalendarTimeOffSummary(req.user.id, year));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el resumen de cupos' });
  }
});

// ─── User: create a time-off request (legacy path) ───────────────────────────
router.post('/api/time-off', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'calendario')) {
    return res.status(403).json({ error: 'No tienes permiso para registrar permisos' });
  }

  const { request_type, start_date, end_date, notes } = req.body || {};
  const eventType = normalizeEventType(request_type);
  if (!eventType || !TIME_OFF_EVENT_TYPES.includes(eventType)) {
    return res.status(400).json({ error: 'Tipo de permiso inválido' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Debes indicar fecha de inicio y fin' });
  }
  if (String(end_date) < String(start_date)) {
    return res.status(400).json({ error: 'La fecha fin no puede ser menor a la fecha inicio' });
  }

  const businessDays = computeBusinessDaysInclusive(start_date, end_date);
  if (businessDays <= 0) {
    return res.status(400).json({ error: 'El rango no incluye días laborables' });
  }

  const year = parseYearOrCurrent(String(start_date).slice(0, 4));
  if (year === null) return res.status(400).json({ error: 'Año inválido' });

  try {
    if (eventType === 'vacation' || eventType === 'sick') {
      const summary = await computeCalendarTimeOffSummary(req.user.id, year);
      if (eventType === 'vacation' && businessDays > summary.vacation_remaining) {
        return res.status(400).json({ error: `Supera cupo anual de vacaciones. Disponible: ${summary.vacation_remaining} día(s)` });
      }
      if (eventType === 'sick' && businessDays > summary.sick_remaining) {
        return res.status(400).json({ error: `Supera cupo anual de enfermedad. Disponible: ${summary.sick_remaining} día(s)` });
      }
    }
    const title = LEGACY_TYPE_LABELS[toLegacyType(eventType)] || 'Permiso';
    const result = await pool.query(
      `INSERT INTO calendar_events
         (user_id, created_by, title, event_type, start_date, end_date, all_day, total_days, visibility, status, notes)
       VALUES ($1, $1, $2, $3, $4::date, $5::date, TRUE, $6, 'team', 'pending', $7)
       RETURNING id, event_type, start_date, end_date, total_days, notes, status, created_at`,
      [req.user.id, title, eventType, start_date, end_date, businessDays, notes || null]
    );
    res.status(201).json(mapMineRow(result.rows[0]));
  } catch (err) {
    if (isPgUndefinedTableError(err)) {
      return res.status(503).json({ error: 'Calendario no inicializado. Falta aplicar migración en base de datos.' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el permiso' });
  }
});

// ─── Admin: all time-off requests for a year ─────────────────────────────────
router.get(['/api/time-off/requests', '/api/timeoff/requests'], authenticateToken, requireRole(['admin']), async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  const { start, end } = makeYearWindow(year);
  try {
    const result = await pool.query(
      `SELECT
         e.id, e.user_id, u.email AS user_email, e.event_type, e.start_date, e.end_date,
         e.total_days, e.status, e.notes, e.created_at, e.updated_at
       FROM calendar_events e
       JOIN users u ON u.id = e.user_id
       WHERE e.event_type = ANY($3::text[])
         AND e.start_date <= $2::date
         AND e.end_date >= $1::date
       ORDER BY e.start_date DESC, e.id DESC`,
      [start, end, TIME_OFF_EVENT_TYPES]
    );
    const mapped = result.rows.map((row) => {
      const legacyType = toLegacyType(row.event_type);
      return {
        id: row.id,
        user_id: row.user_id,
        user_email: row.user_email,
        leave_type: legacyType,
        start_date: row.start_date,
        end_date: row.end_date,
        total_days: row.total_days,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
        approved_by: null,
        approved_by_email: null,
        approved_at: null,
        leave_type_label: LEGACY_TYPE_LABELS[legacyType] || legacyType,
        status_label: LEGACY_STATUS_LABELS[row.status] || row.status
      };
    });
    res.json(mapped);
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.json([]);
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar solicitudes de permisos' });
  }
});

router.get(['/api/time-off/summary', '/api/timeoff/summary'], authenticateToken, requireRole(['admin']), async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    const usersRes = await pool.query('SELECT id, email FROM users ORDER BY email ASC');
    const rows = [];
    for (const userRow of usersRes.rows) {
      const summary = await computeCalendarTimeOffSummary(userRow.id, year);
      rows.push({ user_id: userRow.id, email: userRow.email, ...summary });
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar resumen global de permisos' });
  }
});

router.patch(['/api/time-off/requests/:id/status', '/api/timeoff/requests/:id/status'], authenticateToken, requireRole(['admin']), async (req, res) => {
  const status = normalizeStatus(req.body?.status);
  if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  try {
    const result = await pool.query(
      `UPDATE calendar_events
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND event_type = ANY($3::text[])
       RETURNING id, status`,
      [status, req.params.id, TIME_OFF_EVENT_TYPES]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    res.json({ message: 'Estado actualizado', id: result.rows[0].id, status: result.rows[0].status });
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.status(404).json({ error: 'Solicitud no encontrada' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de la solicitud' });
  }
});

module.exports = router;
