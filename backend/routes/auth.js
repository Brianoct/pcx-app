const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { canAccessPanel } = require('../lib/rbac');
const { buildUserPayload, loadUserContext, normalizeDisplayName, resolveUserDisplayName } = require('../lib/users');

const router = express.Router();

// ─── REGISTER new user (admin only) ────────────────────────────────────────
router.post('/api/register', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone, display_name } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const safeDisplayName = normalizeDisplayName(display_name, { required: false });
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone, display_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [email, hashedPass, role, city || null, phone || null, safeDisplayName]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'Registro fallido' });
  }
});

// ─── LOGIN ──────────────────────────────────────────────────────────────────
router.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan correo o contraseña' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (user && user.is_active === false) {
      return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta a un administrador.' });
    }
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const tokenUser = buildUserPayload(user);
    const token = jwt.sign(
      {
        id: tokenUser.id,
        email: tokenUser.email,
        role: tokenUser.role,
        city: tokenUser.city,
        phone: tokenUser.phone,
        panel_access: tokenUser.panel_access
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: tokenUser
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Inicio de sesión fallido' });
  }
});

// ─── LIST assignable sellers for delegated quote assignment ──────────────────
router.get('/api/sellers/assignable', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE is_active = TRUE
         AND (role ILIKE '%ventas%' OR role ILIKE '%sales%' OR role ILIKE '%vendedor%')
       ORDER BY email ASC`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        display_name: resolveUserDisplayName(row, 'Vendedor')
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la lista de vendedores' });
  }
});

// Backward compatible alias for legacy frontend calls.
router.get('/api/users/sales', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE is_active = TRUE
         AND (role ILIKE '%ventas%' OR role ILIKE '%sales%' OR role ILIKE '%vendedor%')
       ORDER BY email ASC`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      display_name: resolveUserDisplayName(row, 'Vendedor')
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la lista de vendedores' });
  }
});

module.exports = router;
