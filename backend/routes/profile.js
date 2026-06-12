const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { buildUserPayload, loadUserContext, normalizeDisplayName } = require('../lib/users');

const router = express.Router();

router.patch('/api/me', authenticateToken, async (req, res) => {
  const { email, city, phone, display_name } = req.body || {};
  const hasEmail = email !== undefined;
  const hasCity = city !== undefined;
  const hasPhone = phone !== undefined;
  const hasDisplayName = display_name !== undefined;

  if (!hasEmail && !hasCity && !hasPhone && !hasDisplayName) {
    return res.status(400).json({ error: 'No se enviaron cambios para actualizar perfil' });
  }

  const nextEmail = hasEmail ? String(email || '').trim().toLowerCase() : undefined;
  const nextCity = hasCity ? (city ? String(city).trim() : null) : undefined;
  const nextPhone = hasPhone ? (phone ? String(phone).trim() : null) : undefined;
  let nextDisplayName;
  if (hasDisplayName) {
    try {
      nextDisplayName = normalizeDisplayName(display_name, { required: false, fieldLabel: 'Nombre visible' });
    } catch (nameErr) {
      return res.status(nameErr?.statusCode || 400).json({ error: nameErr.message || 'Nombre visible inválido' });
    }
  }

  if (hasEmail) {
    if (!nextEmail) {
      return res.status(400).json({ error: 'El correo no puede estar vacío' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: 'Correo electrónico inválido' });
    }
  }

  if (hasPhone && nextPhone && !/^\d{8}$/.test(nextPhone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const currentUser = await loadUserContext(req.user.id);
    if (!currentUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updatedEmail = hasEmail ? nextEmail : currentUser.email;
    const updatedCity = hasCity ? nextCity : currentUser.city;
    const updatedPhone = hasPhone ? nextPhone : currentUser.phone;
    const updatedDisplayName = hasDisplayName ? nextDisplayName : (currentUser.display_name || null);

    const result = await pool.query(
      `UPDATE users
       SET email = $1,
           city = $2,
           phone = $3,
           display_name = $4
       WHERE id = $5
       RETURNING id, email, display_name, role, city, phone, panel_access`,
      [updatedEmail, updatedCity, updatedPhone, updatedDisplayName, req.user.id]
    );

    const updatedUser = result.rows[0];
    if (!updatedUser) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Perfil actualizado', user: buildUserPayload(updatedUser) });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El correo ya está en uso por otro usuario' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el perfil' });
  }
});

router.patch('/api/me/password', authenticateToken, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Debes enviar contraseña actual y nueva contraseña' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (confirm_password !== undefined && new_password !== confirm_password) {
    return res.status(400).json({ error: 'La confirmación de contraseña no coincide' });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = result.rows[0];
    const isValidCurrent = await bcrypt.compare(String(current_password), String(user.password_hash || ''));
    if (!isValidCurrent) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    const hashedPass = await bcrypt.hash(String(new_password), 10);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashedPass, req.user.id]
    );

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  }
});

router.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const userRow = await loadUserContext(req.user.id);
    if (!userRow) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(buildUserPayload(userRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar sesión' });
  }
});

module.exports = router;
