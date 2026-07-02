const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { buildUserPayload, loadUserContext, normalizeDisplayName } = require('../lib/users');

const router = express.Router();

// Avatar / payment-QR images live in the DB (user_assets) — the server disk is
// ephemeral on Render, so files stored there vanish on every deploy.
const ASSET_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const decodeImageDataUrl = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error('Formato de imagen inválido. Usa JPG, PNG o WEBP.');
    err.statusCode = 400;
    throw err;
  }
  const mime = String(match[1] || '').toLowerCase();
  if (!ASSET_MIMES.has(mime)) {
    const err = new Error('Formato no soportado. Usa JPG, PNG o WEBP.');
    err.statusCode = 400;
    throw err;
  }
  const buffer = Buffer.from(String(match[2] || '').replace(/\s+/g, ''), 'base64');
  if (!buffer || buffer.length === 0) {
    const err = new Error('Imagen vacía.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > 5 * 1024 * 1024) {
    const err = new Error('La imagen supera 5MB. Usa una imagen más liviana.');
    err.statusCode = 400;
    throw err;
  }
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, buffer };
};

// Trim a free-text field to null-or-capped-string. Returns undefined when the
// caller didn't send the key (so we leave the column untouched).
const optionalText = (value, max) => {
  if (value === undefined) return undefined;
  const str = String(value || '').trim();
  if (!str) return null;
  return str.slice(0, max);
};

router.patch('/api/me', authenticateToken, async (req, res) => {
  const body = req.body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  const hasEmail = has('email');
  const hasDisplayName = has('display_name');

  // Build the SET clause dynamically so we only touch provided fields.
  const sets = [];
  const values = [];
  const push = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (hasDisplayName) {
    try {
      push('display_name', normalizeDisplayName(body.display_name, { required: false, fieldLabel: 'Nombre visible' }));
    } catch (nameErr) {
      return res.status(nameErr?.statusCode || 400).json({ error: nameErr.message || 'Nombre visible inválido' });
    }
  }

  if (hasEmail) {
    const nextEmail = String(body.email || '').trim().toLowerCase();
    if (!nextEmail) return res.status(400).json({ error: 'El correo no puede estar vacío' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: 'Correo electrónico inválido' });
    }
    push('email', nextEmail);
  }

  if (has('phone')) {
    const nextPhone = body.phone ? String(body.phone).trim() : null;
    if (nextPhone && !/^\d{8}$/.test(nextPhone)) {
      return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
    }
    push('phone', nextPhone);
  }

  if (has('emergency_contact_phone')) {
    const raw = body.emergency_contact_phone ? String(body.emergency_contact_phone).trim() : null;
    if (raw && !/^[\d+\s()-]{6,20}$/.test(raw)) {
      return res.status(400).json({ error: 'Teléfono de emergencia inválido' });
    }
    push('emergency_contact_phone', raw);
  }

  if (has('birth_date')) {
    const raw = body.birth_date ? String(body.birth_date).trim() : null;
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'Fecha de nacimiento inválida (usa AAAA-MM-DD)' });
    }
    push('birth_date', raw);
  }

  if (has('city')) push('city', optionalText(body.city, 50));
  if (has('national_id')) push('national_id', optionalText(body.national_id, 30));
  if (has('emergency_contact_name')) push('emergency_contact_name', optionalText(body.emergency_contact_name, 80));
  if (has('payment_info')) push('payment_info', optionalText(body.payment_info, 200));

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No se enviaron cambios para actualizar perfil' });
  }

  try {
    values.push(req.user.id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const fresh = await loadUserContext(req.user.id);
    res.json({ message: 'Perfil actualizado', user: buildUserPayload(fresh) });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El correo ya está en uso por otro usuario' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el perfil' });
  }
});

// Upload (or clear) an avatar / payment-QR image for the logged-in employee.
// Body: { kind: 'avatar'|'qr', data_url } to set, or { kind, clear: true } to remove.
router.post('/api/me/asset', authenticateToken, async (req, res) => {
  const kind = req.body?.kind === 'qr' ? 'qr' : req.body?.kind === 'avatar' ? 'avatar' : null;
  if (!kind) return res.status(400).json({ error: 'Tipo de imagen inválido (avatar o qr)' });
  const column = kind === 'qr' ? 'payment_qr_url' : 'avatar_url';

  try {
    if (req.body?.clear) {
      await pool.query('DELETE FROM user_assets WHERE user_id = $1 AND kind = $2', [req.user.id, kind]);
      await pool.query(`UPDATE users SET ${column} = NULL WHERE id = $1`, [req.user.id]);
    } else {
      const { mime, buffer } = decodeImageDataUrl(req.body?.data_url);
      // New token per upload: unguessable URL + automatic cache busting.
      const accessToken = crypto.randomBytes(16).toString('hex');
      await pool.query(
        `INSERT INTO user_assets (user_id, kind, mime, data, access_token, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, kind) DO UPDATE
         SET mime = EXCLUDED.mime,
             data = EXCLUDED.data,
             access_token = EXCLUDED.access_token,
             updated_at = NOW()`,
        [req.user.id, kind, mime, buffer, accessToken]
      );
      await pool.query(
        `UPDATE users SET ${column} = $1 WHERE id = $2`,
        [`/api/user-assets/${req.user.id}/${kind}/${accessToken}`, req.user.id]
      );
    }

    const fresh = await loadUserContext(req.user.id);
    if (!fresh) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      message: req.body?.clear ? 'Imagen eliminada' : 'Imagen actualizada',
      user: buildUserPayload(fresh)
    });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la imagen' });
  }
});

// Serve a stored image. No auth middleware: <img> tags can't send JWT headers,
// so access control is the unguessable per-upload token in the URL (it rotates
// on every re-upload). Immutable caching is safe for the same reason.
router.get('/api/user-assets/:userId/:kind/:token', async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.userId, 10);
    const kind = req.params.kind === 'qr' ? 'qr' : req.params.kind === 'avatar' ? 'avatar' : null;
    const token = String(req.params.token || '');
    if (!Number.isInteger(userId) || userId <= 0 || !kind || !/^[a-f0-9]{32}$/.test(token)) {
      return res.status(404).end();
    }
    const result = await pool.query(
      'SELECT mime, data, access_token FROM user_assets WHERE user_id = $1 AND kind = $2',
      [userId, kind]
    );
    const row = result.rows[0];
    if (!row || !crypto.timingSafeEqual(Buffer.from(String(row.access_token)), Buffer.from(token))) {
      return res.status(404).end();
    }
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(row.data);
  } catch (err) {
    console.error(err);
    res.status(404).end();
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
