const express = require('express');
const { pool } = require('../db');
const { isPgUndefinedColumnError, isPgUndefinedTableError } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { canAccessPanel } = require('../lib/rbac');
const { TIME_OFF_STATUS_LABELS, TIME_OFF_TYPE_LABELS, computeBusinessDaysInclusive, computeTimeOffSummary, makeYearWindow, normalizeTimeOffStatus, normalizeTimeOffType, parseYearOrCurrent } = require('../lib/timeoff');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// ─── TIME OFF / CALENDAR (usuario + admin) ──────────────────────────────────
router.get('/api/time-off/mine', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  const { start, end } = makeYearWindow(year);
  try {
    let result;
    try {
      result = await pool.query(
        `SELECT id, leave_type, start_date, end_date, total_days AS days_count, notes, status, created_at, updated_at
         FROM time_off_requests
         WHERE user_id = $1
           AND start_date <= $3::date
           AND end_date >= $2::date
         ORDER BY start_date DESC, id DESC`,
        [req.user.id, start, end]
      );
    } catch (err) {
      if (isPgUndefinedTableError(err)) {
        return res.json([]);
      }
      if (isPgUndefinedColumnError(err)) {
        result = await pool.query(
          `SELECT id, leave_type, start_date, end_date, business_days AS days_count, reason AS notes, status, created_at, updated_at
           FROM time_off_requests
           WHERE user_id = $1
             AND start_date <= $3::date
             AND end_date >= $2::date
           ORDER BY start_date DESC, id DESC`,
          [req.user.id, start, end]
        );
      } else {
        throw err;
      }
    }
    const rows = result.rows.map((row) => {
      const normalizedType = normalizeTimeOffType(row.leave_type) || 'other';
      const normalizedStatus = normalizeTimeOffStatus(row.status) || 'pending';
      return {
        ...row,
        leave_type: normalizedType,
        request_type: normalizedType,
        status: normalizedStatus
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar tus permisos' });
  }
});

router.get('/api/time-off/mine/summary', authenticateToken, async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    const summary = await computeTimeOffSummary(req.user.id, year);
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el resumen de cupos' });
  }
});

router.post('/api/time-off', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'calendario')) {
    return res.status(403).json({ error: 'No tienes permiso para registrar permisos' });
  }

  const {
    request_type,
    start_date,
    end_date,
    notes
  } = req.body || {};

  const normalizedType = normalizeTimeOffType(request_type);
  if (!normalizedType) {
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
    if (normalizedType === 'vacation' || normalizedType === 'sick_leave') {
      const summary = await computeTimeOffSummary(req.user.id, year);
      if (normalizedType === 'vacation' && businessDays > summary.vacation_remaining) {
        return res.status(400).json({ error: `Supera cupo anual de vacaciones. Disponible: ${summary.vacation_remaining} día(s)` });
      }
      if (normalizedType === 'sick_leave' && businessDays > summary.sick_remaining) {
        return res.status(400).json({ error: `Supera cupo anual de baja médica. Disponible: ${summary.sick_remaining} día(s)` });
      }
    }

    let result;
    try {
      result = await pool.query(
        `INSERT INTO time_off_requests (user_id, leave_type, start_date, end_date, total_days, notes, status)
         VALUES ($1, $2, $3::date, $4::date, $5, $6, 'pending')
         RETURNING id, leave_type, start_date, end_date, total_days AS days_count, notes, status, created_at`,
        [req.user.id, normalizedType, start_date, end_date, businessDays, notes || null]
      );
    } catch (err) {
      if (isPgUndefinedTableError(err)) {
        return res.status(503).json({ error: 'Calendario no inicializado. Falta aplicar migración en base de datos.' });
      }
      if (isPgUndefinedColumnError(err)) {
        const legacyTypeMap = {
          vacation: 'vacaciones',
          sick_leave: 'enfermedad',
          early_leave: 'permiso',
          other: 'permiso'
        };
        result = await pool.query(
          `INSERT INTO time_off_requests (user_id, leave_type, start_date, end_date, business_days, reason, status)
           VALUES ($1, $2, $3::date, $4::date, $5, $6, 'pendiente')
           RETURNING id, leave_type, start_date, end_date, business_days AS days_count, reason AS notes, status, created_at`,
          [req.user.id, legacyTypeMap[normalizedType] || 'permiso', start_date, end_date, businessDays, notes || null]
        );
      } else {
        throw err;
      }
    }
    const row = result.rows[0] || {};
    const normalizedInsertedType = normalizeTimeOffType(row.leave_type) || normalizedType;
    const normalizedInsertedStatus = normalizeTimeOffStatus(row.status) || 'pending';
    res.status(201).json({
      ...row,
      leave_type: normalizedInsertedType,
      request_type: normalizedInsertedType,
      status: normalizedInsertedStatus
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el permiso' });
  }
});

router.get('/api/timeoff/requests', authenticateToken, requireRole(['admin']), async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  const { start, end } = makeYearWindow(year);
  try {
    let result;
    try {
      result = await pool.query(
        `SELECT
           r.id, r.user_id, u.email AS user_email, r.leave_type, r.start_date, r.end_date,
           r.total_days AS total_days, r.status, r.notes, r.created_at, r.updated_at,
           r.approved_by, approver.email AS approved_by_email, r.approved_at
         FROM time_off_requests r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN users approver ON approver.id = r.approved_by
         WHERE r.start_date <= $2::date
           AND r.end_date >= $1::date
         ORDER BY r.start_date DESC, r.id DESC`,
        [start, end]
      );
    } catch (err) {
      if (isPgUndefinedTableError(err)) {
        return res.json([]);
      }
      if (isPgUndefinedColumnError(err)) {
        result = await pool.query(
          `SELECT
             r.id, r.user_id, u.email AS user_email, r.leave_type, r.start_date, r.end_date,
             r.business_days AS total_days, r.status, r.reason AS notes, r.created_at, r.updated_at,
             r.approved_by, approver.email AS approved_by_email, r.approved_at
           FROM time_off_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN users approver ON approver.id = r.approved_by
           WHERE r.start_date <= $2::date
             AND r.end_date >= $1::date
           ORDER BY r.start_date DESC, r.id DESC`,
          [start, end]
        );
      } else {
        throw err;
      }
    }
    const mapped = result.rows.map((row) => ({
      ...row,
      leave_type: normalizeTimeOffType(row.leave_type) || row.leave_type,
      status: normalizeTimeOffStatus(row.status) || row.status,
      leave_type_label: TIME_OFF_TYPE_LABELS[normalizeTimeOffType(row.leave_type)] || row.leave_type,
      status_label: TIME_OFF_STATUS_LABELS[normalizeTimeOffStatus(row.status)] || row.status
    }));
    res.json(mapped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar solicitudes de permisos' });
  }
});

router.get('/api/timeoff/summary', authenticateToken, requireRole(['admin']), async (req, res) => {
  const year = parseYearOrCurrent(req.query.year);
  if (year === null) return res.status(400).json({ error: 'Año inválido' });
  try {
    const usersRes = await pool.query(
      `SELECT id, email
       FROM users
       ORDER BY email ASC`
    );
    const rows = [];
    for (const userRow of usersRes.rows) {
      const summary = await computeTimeOffSummary(userRow.id, year);
      rows.push({
        user_id: userRow.id,
        email: userRow.email,
        ...summary
      });
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar resumen global de permisos' });
  }
});

router.patch('/api/timeoff/requests/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  const status = normalizeTimeOffStatus(req.body?.status);
  if (!status) return res.status(400).json({ error: 'Estado inválido' });
  const legacyStatusMap = {
    pending: 'pendiente',
    approved: 'aprobado',
    rejected: 'rechazado'
  };
  const shouldApprove = status === 'approved';
  const updateSql = `UPDATE time_off_requests
     SET status = $1,
         approved_by = CASE WHEN $4 THEN $2 ELSE NULL END,
         approved_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, status`;

  try {
    let result;
    try {
      result = await pool.query(updateSql, [status, req.user.id, req.params.id, shouldApprove]);
    } catch (err) {
      if (err?.code === '23514') {
        result = await pool.query(updateSql, [legacyStatusMap[status] || 'pendiente', req.user.id, req.params.id, shouldApprove]);
      } else {
        throw err;
      }
    }
    if (result.rowCount === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const normalized = normalizeTimeOffStatus(result.rows[0]?.status) || status;
    res.json({ message: 'Estado actualizado', id: result.rows[0]?.id, status: normalized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de la solicitud' });
  }
});

module.exports = router;
