const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { normalizeRole } = require('./rbac');
const { getRequestContext } = require('./requestContext');
const { canUseSandbox } = require('./sandbox');

// Middleware: Verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No se proporcionó token' });

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    try {
      const result = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [user.id]);
      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'Usuario no encontrado' });
      }
      if (!result.rows[0].is_active) {
        return res.status(403).json({ error: 'Cuenta desactivada. Contacta a un administrador.' });
      }
      req.user = user;
      // Session checks above always ran against the real schema; only now,
      // with the user known, does the requested sandbox mode become active
      // for the rest of this request.
      const ctx = getRequestContext();
      if (ctx?.sandboxRequested) {
        if (!canUseSandbox(user.role)) {
          return res.status(403).json({ error: 'El modo sandbox no está habilitado para tu rol.' });
        }
        ctx.sandbox = true;
      }
      next();
    } catch (dbErr) {
      console.error(dbErr);
      return res.status(500).json({ error: 'No se pudo validar sesión' });
    }
  });
};

// Middleware: Require specific role (case-insensitive + accent-insensitive)
const requireRole = (roles) => (req, res, next) => {
  const userRole = normalizeRole(req.user.role || '');
  const allowed = roles.map((r) => normalizeRole(r));
  if (!allowed.includes(userRole)) {
    return res.status(403).json({ error: 'Permisos insuficientes' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireRole
};
