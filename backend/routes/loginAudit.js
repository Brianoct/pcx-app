const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { resolveUserDisplayName } = require('../lib/users');

const router = express.Router();

// ─── AUDITORÍA DE ACCESOS (solo admin) ──────────────────────────────────────
// Devuelve el historial de logins con banderas calculadas:
//  - shared_devices: un mismo device_id usado por 2+ cuentas (la señal fuerte
//    de cuentas compartidas / "un amigo vende por otro").
//  - is_new_device: primera vez que ese dispositivo aparece en esa cuenta.
router.get('/api/admin/login-history', authenticateToken, requireRole(['admin']), async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 180);
  const userId = req.query.user_id ? Number.parseInt(req.query.user_id, 10) : null;
  if (req.query.user_id && !Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Usuario inválido' });
  }

  try {
    const loginsResult = await pool.query(
      `SELECT lh.id, lh.user_id, lh.email, lh.success, lh.ip, lh.device_id,
              lh.device_label, lh.created_at,
              u.display_name, u.role,
              -- Primera aparición de este dispositivo en esta cuenta (solo
              -- logins exitosos con device_id conocido).
              (lh.success AND lh.device_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM login_history prev
                 WHERE prev.user_id = lh.user_id
                   AND prev.device_id = lh.device_id
                   AND prev.success = TRUE
                   AND prev.created_at < lh.created_at
              )) AS is_new_device
       FROM login_history lh
       LEFT JOIN users u ON u.id = lh.user_id
       WHERE lh.created_at >= NOW() - ($1 || ' days')::interval
         AND ($2::int IS NULL OR lh.user_id = $2)
       ORDER BY lh.created_at DESC
       LIMIT 400`,
      [days, userId]
    );

    // Dispositivos compartidos: mismo device_id con logins exitosos de 2+
    // cuentas dentro del período consultado.
    const sharedResult = await pool.query(
      `SELECT lh.device_id,
              MAX(lh.device_label) AS device_label,
              MAX(lh.created_at) AS last_seen,
              COUNT(*) AS login_count,
              ARRAY_AGG(DISTINCT lh.email) AS emails
       FROM login_history lh
       WHERE lh.success = TRUE
         AND lh.device_id IS NOT NULL
         AND lh.created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY lh.device_id
       HAVING COUNT(DISTINCT lh.user_id) > 1
       ORDER BY MAX(lh.created_at) DESC`,
      [days]
    );

    const failedResult = await pool.query(
      `SELECT COUNT(*)::int AS failed
       FROM login_history
       WHERE success = FALSE AND created_at >= NOW() - ($1 || ' days')::interval`,
      [days]
    );

    const usersResult = await pool.query(
      `SELECT DISTINCT u.id, u.email, u.display_name
       FROM login_history lh JOIN users u ON u.id = lh.user_id
       WHERE lh.created_at >= NOW() - ($1 || ' days')::interval
       ORDER BY u.email`,
      [days]
    );

    const sharedDeviceIds = new Set(sharedResult.rows.map((row) => row.device_id));

    res.json({
      days,
      failed_attempts: failedResult.rows[0].failed,
      users: usersResult.rows.map((row) => ({
        id: row.id,
        email: row.email,
        display_name: resolveUserDisplayName(row, row.email)
      })),
      shared_devices: sharedResult.rows.map((row) => ({
        device_id: row.device_id,
        device_label: row.device_label,
        last_seen: row.last_seen,
        login_count: Number(row.login_count),
        emails: row.emails
      })),
      logins: loginsResult.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        email: row.email,
        display_name: row.user_id ? resolveUserDisplayName(row, row.email) : row.email,
        role: row.role || null,
        success: row.success,
        ip: row.ip,
        device_id: row.device_id,
        device_label: row.device_label,
        is_new_device: row.is_new_device === true,
        is_shared_device: sharedDeviceIds.has(row.device_id),
        created_at: row.created_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el historial de accesos' });
  }
});

module.exports = router;
