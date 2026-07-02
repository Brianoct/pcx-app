const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { loadCommissionSettings, sanitizeCommissionSettings, saveCommissionSettings } = require('../lib/commission');
const { DEFAULT_ROLE_ACCESS, ROLE_DEFAULT_ROLES, normalizeRole, normalizeText, sanitizePanelAccess } = require('../lib/rbac');
const { normalizeDisplayName, resolveUserDisplayName } = require('../lib/users');

const router = express.Router();

// ─── USER MANAGEMENT (admin only) ────────────────────────────────────────────
router.get('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, role, city, phone, panel_access, created_at, is_active,
              avatar_url, payment_qr_url, payment_info, national_id
       FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows.map((u) => ({ ...u, panel_access: sanitizePanelAccess(u.panel_access, u.role) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron obtener usuarios' });
  }
});

router.get('/api/role-access-defaults', authenticateToken, requireRole(['admin']), async (_req, res) => {
  res.json(DEFAULT_ROLE_ACCESS);
});

router.put('/api/role-access-defaults', authenticateToken, requireRole(['admin']), async (req, res) => {
  const roleEntries = Object.entries(req.body || {});
  if (roleEntries.length === 0) {
    return res.status(400).json({ error: 'No se enviaron roles para actualizar' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [roleLabel, accessValue] of roleEntries) {
      const sanitized = sanitizePanelAccess(accessValue, roleLabel);
      await client.query(
        'UPDATE users SET panel_access = $1::jsonb WHERE role = $2',
        [JSON.stringify(sanitized), roleLabel]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Configuración de roles actualizada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar configuración de roles' });
  } finally {
    client.release();
  }
});

router.post('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone, panel_access, display_name } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'Faltan campos requeridos' });

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const effectivePanelAccess = sanitizePanelAccess(panel_access, role);
  const safeDisplayName = normalizeDisplayName(display_name, { required: false });

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone, panel_access, display_name) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [email, hashedPass, role, city || null, phone || null, JSON.stringify(effectivePanelAccess), safeDisplayName]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'No se pudo crear usuario' });
  }
});

router.patch('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { role, city, phone, panel_access, display_name } = req.body;
  if (!role) return res.status(400).json({ error: 'El rol es obligatorio' });

  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const cityProvided = Object.prototype.hasOwnProperty.call(req.body, 'city');
  const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const displayNameProvided = Object.prototype.hasOwnProperty.call(req.body, 'display_name');
  const panelAccessProvided = Object.prototype.hasOwnProperty.call(req.body, 'panel_access');
  const cityValue = city === '' ? null : city;
  const phoneValue = phone === '' ? null : phone;
  const displayNameValue = displayNameProvided ? normalizeDisplayName(display_name, { required: false, fieldLabel: 'Nombre visible' }) : null;
  const panelAccessValue = panelAccessProvided ? JSON.stringify(sanitizePanelAccess(panel_access, role)) : null;

  try {
    const currentResult = await pool.query(
      'SELECT display_name, email FROM users WHERE id = $1',
      [req.params.id]
    );
    if (currentResult.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    const previousDisplayName = resolveUserDisplayName(currentResult.rows[0], '');
    const nextDisplayName = displayNameProvided
      ? resolveUserDisplayName({ display_name: displayNameValue, email: currentResult.rows[0].email }, previousDisplayName)
      : previousDisplayName;

    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           city = CASE WHEN $2::boolean THEN $3 ELSE city END,
           phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
           display_name = CASE WHEN $6::boolean THEN $7 ELSE display_name END,
           panel_access = CASE WHEN $8::boolean THEN $9::jsonb ELSE panel_access END
       WHERE id = $10
       RETURNING id`,
      [
        role,
        cityProvided,
        cityValue,
        phoneProvided,
        phoneValue,
        displayNameProvided,
        displayNameValue,
        panelAccessProvided,
        panelAccessValue,
        req.params.id
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    let updatedQuotesVendor = 0;
    if (displayNameProvided && normalizeText(previousDisplayName) !== normalizeText(nextDisplayName)) {
      const quoteUpdate = await pool.query(
        `UPDATE quotes
         SET vendor = $1
         WHERE user_id = $2
           AND LOWER(TRIM(vendor)) = LOWER(TRIM($3))`,
        [nextDisplayName, req.params.id, previousDisplayName]
      );
      updatedQuotesVendor = Number(quoteUpdate.rowCount || 0);
    }

    res.json({
      message: 'User updated',
      updated_quotes_vendor: updatedQuotesVendor,
      new_display_name: nextDisplayName
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar usuario' });
  }
});

// ─── ROLE ACCESS DEFAULTS (admin only) ──────────────────────────────────────
router.get('/api/roles/access-defaults', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT role, panel_access
       FROM role_panel_defaults
       ORDER BY role ASC`
    );
    const map = new Map(result.rows.map((row) => [normalizeRole(row.role), row.panel_access || {}]));
    const rows = ROLE_DEFAULT_ROLES.map((role) => {
      const dbAccess = map.get(normalizeRole(role));
      return {
        role,
        panel_access: sanitizePanelAccess(dbAccess, role)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de roles' });
  }
});

router.patch('/api/roles/access-defaults/:role', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rawRole = req.params.role;
  const matchedRole = ROLE_DEFAULT_ROLES.find((r) => normalizeRole(r) === normalizeRole(rawRole));
  if (!matchedRole) {
    return res.status(400).json({ error: 'Rol inválido para configuración por defecto' });
  }
  const panelAccess = sanitizePanelAccess(req.body?.panel_access, matchedRole);
  const applyToUsers = Boolean(req.body?.apply_to_users);
  const roleAccentMapFrom = 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛáàäâéèëêíìïîóòöôúùüû';
  const roleAccentMapTo = 'AAAAEEEEIIIIOOOOUUUUaaaaeeeeiiiioooouuuu';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO role_panel_defaults (role, panel_access)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (role)
       DO UPDATE SET panel_access = EXCLUDED.panel_access, updated_at = NOW()`,
      [matchedRole, JSON.stringify(panelAccess)]
    );
    let updatedUsers = 0;
    if (applyToUsers) {
      const updateResult = await client.query(
        `UPDATE users
         SET panel_access = $1::jsonb
         WHERE LOWER(translate(role, $3, $4)) = LOWER(translate($2, $3, $4))`,
        [JSON.stringify(panelAccess), matchedRole, roleAccentMapFrom, roleAccentMapTo]
      );
      updatedUsers = Number(updateResult.rowCount || 0);
    }
    await client.query('COMMIT');
    res.json({
      message: applyToUsers ? 'Configuración del rol guardada y aplicada a usuarios' : 'Configuración del rol guardada',
      role: matchedRole,
      panel_access: panelAccess,
      updated_users: updatedUsers
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración del rol' });
  } finally {
    client.release();
  }
});

router.post('/api/roles/access-defaults/:role/apply', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rawRole = req.params.role;
  const matchedRole = ROLE_DEFAULT_ROLES.find((r) => normalizeRole(r) === normalizeRole(rawRole));
  if (!matchedRole) {
    return res.status(400).json({ error: 'Rol inválido para aplicar configuración' });
  }
  try {
    const defaultsResult = await pool.query(
      'SELECT panel_access FROM role_panel_defaults WHERE role = $1',
      [matchedRole]
    );
    const defaultAccess = defaultsResult.rowCount > 0
      ? defaultsResult.rows[0].panel_access
      : null;
    const effectiveAccess = sanitizePanelAccess(defaultAccess, matchedRole);

    const updateResult = await pool.query(
      `UPDATE users
       SET panel_access = $1::jsonb
       WHERE LOWER(role) = LOWER($2)`,
      [JSON.stringify(effectiveAccess), matchedRole]
    );

    res.json({
      message: 'Configuración aplicada a usuarios del rol',
      role: matchedRole,
      updated_users: updateResult.rowCount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo aplicar configuración a usuarios' });
  }
});

// ─── COMMISSION SETTINGS (admin only) ────────────────────────────────────────
router.get('/api/commission/settings', authenticateToken, async (_req, res) => {
  try {
    const settings = await loadCommissionSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de comisiones' });
  }
});

router.patch('/api/commission/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const current = await loadCommissionSettings();
    const next = sanitizeCommissionSettings({
      ...current,
      ...(req.body?.settings || {})
    });
    await saveCommissionSettings(next);

    res.json({ message: 'Configuración de comisiones guardada', settings: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración de comisiones' });
  }
});

router.delete('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const targetId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
    if (targetId === Number(req.user.id)) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }
    const result = await pool.query(
      `UPDATE users
       SET is_active = FALSE
       WHERE id = $1
       RETURNING id`,
      [targetId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo desactivar usuario' });
  }
});

router.patch('/api/users/:id/activation', authenticateToken, requireRole(['admin']), async (req, res) => {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
  if (targetId === Number(req.user.id) && req.body?.is_active === false) {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
  }
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active')) {
    return res.status(400).json({ error: 'Debes enviar is_active' });
  }
  const isActive = Boolean(req.body.is_active);
  try {
    const result = await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, is_active`,
      [isActive, targetId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      message: isActive ? 'Usuario reactivado' : 'Usuario desactivado',
      id: result.rows[0].id,
      is_active: Boolean(result.rows[0].is_active)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar estado de usuario' });
  }
});

module.exports = router;
