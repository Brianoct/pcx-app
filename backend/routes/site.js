const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { decodeImageDataUrl } = require('../lib/imageAssets');
const { sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const { DEFAULT_HOME, loadHomeContent, sanitizeHomeContent, collectAssetKeys } = require('../lib/site');

const router = express.Router();

// ─── Público ────────────────────────────────────────────────────────────────

// Página de inicio pública: contenido publicado (o el inicial). Sin login.
router.get('/api/site/home', async (_req, res) => {
  try {
    const { content, published_at: publishedAt, is_default: isDefault } = await loadHomeContent();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ content, published_at: publishedAt, is_default: isDefault });
  } catch (err) {
    console.error('Error loading site home:', err);
    res.status(500).json({ error: 'No se pudo cargar la página' });
  }
});

// Fotos del sitio (subidas desde el editor): URL con token, cache larga. El
// token cambia en cada subida, así la foto nueva nunca queda cacheada vieja.
router.get('/api/site-assets/:key/:token', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim().toLowerCase();
    const token = String(req.params.token || '');
    if (!/^[a-z0-9_-]{1,80}$/.test(key) || !/^[a-f0-9]{32}$/.test(token)) return res.status(404).end();
    const result = await pool.query('SELECT mime, data, access_token FROM site_assets WHERE key = $1', [key]);
    const row = result.rows[0];
    if (!row || !crypto.timingSafeEqual(Buffer.from(String(row.access_token)), Buffer.from(token))) {
      return res.status(404).end();
    }
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(row.data);
  } catch (err) {
    console.error('Error serving site asset:', err);
    res.status(404).end();
  }
});

// ─── Editor (Marketing / Admin) ─────────────────────────────────────────────

const ensureSiteAccess = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.sitio_web && !access.admin) {
    res.status(403).json({ error: 'No tienes acceso al editor del sitio' });
    return null;
  }
  return userContext;
};

const EDITOR_SELECT = `
  SELECT p.draft, p.published, p.published_at, p.updated_at,
         COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS updated_by_name
  FROM site_pages p
  LEFT JOIN users u ON u.id = p.updated_by
  WHERE p.key = 'home'`;

const editorPayload = (row) => ({
  draft: row?.draft || row?.published || DEFAULT_HOME,
  published: row?.published || null,
  published_at: row?.published_at || null,
  updated_at: row?.updated_at || null,
  updated_by_name: row?.updated_by_name || null,
  has_unpublished: Boolean(row?.draft) && JSON.stringify(row.draft) !== JSON.stringify(row.published || null)
});

const loadEditorRow = async () => {
  await pool.query("INSERT INTO site_pages (key) VALUES ('home') ON CONFLICT (key) DO NOTHING");
  const result = await pool.query(EDITOR_SELECT);
  return result.rows[0] || null;
};

// Borra las fotos que ya no aparecen ni en el borrador ni en lo publicado:
// así la base no crece con fotos reemplazadas.
const pruneOrphanAssets = async () => {
  const row = await loadEditorRow();
  const keep = new Set([...collectAssetKeys(row?.draft), ...collectAssetKeys(row?.published)]);
  const assets = await pool.query('SELECT key FROM site_assets');
  const orphans = assets.rows.map((a) => a.key).filter((key) => !keep.has(key));
  if (orphans.length > 0) await pool.query('DELETE FROM site_assets WHERE key = ANY($1::text[])', [orphans]);
  return orphans.length;
};

router.get('/api/site/home/editor', authenticateToken, async (req, res) => {
  if (!(await ensureSiteAccess(req, res))) return;
  try {
    const row = await loadEditorRow();
    res.json({ ...editorPayload(row), defaults: DEFAULT_HOME });
  } catch (err) {
    console.error('Error loading site editor:', err);
    res.status(500).json({ error: 'No se pudo cargar el editor' });
  }
});

// Guardar borrador (autoguardado desde el editor). No toca lo publicado.
router.put('/api/site/home/draft', authenticateToken, async (req, res) => {
  const user = await ensureSiteAccess(req, res);
  if (!user) return;
  try {
    const content = sanitizeHomeContent(req.body?.content);
    await pool.query(
      'UPDATE site_pages SET draft = $1, updated_by = $2, updated_at = NOW() WHERE key = $3',
      [JSON.stringify(content), user.id, 'home']
    );
    const row = await loadEditorRow();
    res.json(editorPayload(row));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error saving site draft:', err);
    res.status(500).json({ error: 'No se pudo guardar el borrador' });
  }
});

// Publicar: el borrador (o el contenido enviado) pasa a ser lo que ve el visitante.
router.post('/api/site/home/publish', authenticateToken, async (req, res) => {
  const user = await ensureSiteAccess(req, res);
  if (!user) return;
  try {
    let content;
    if (req.body?.content) {
      content = sanitizeHomeContent(req.body.content);
    } else {
      const row = await loadEditorRow();
      content = row?.draft || row?.published || DEFAULT_HOME;
    }
    await pool.query(
      'UPDATE site_pages SET draft = $1, published = $1, published_at = NOW(), updated_by = $2, updated_at = NOW() WHERE key = $3',
      [JSON.stringify(content), user.id, 'home']
    );
    const pruned = await pruneOrphanAssets();
    const row = await loadEditorRow();
    res.json({ ...editorPayload(row), message: 'Publicado', pruned_assets: pruned });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error publishing site:', err);
    res.status(500).json({ error: 'No se pudo publicar' });
  }
});

// Descartar el borrador: vuelve a lo publicado.
router.post('/api/site/home/discard', authenticateToken, async (req, res) => {
  const user = await ensureSiteAccess(req, res);
  if (!user) return;
  try {
    await pool.query(
      'UPDATE site_pages SET draft = published, updated_by = $1, updated_at = NOW() WHERE key = $2',
      [user.id, 'home']
    );
    await pruneOrphanAssets();
    const row = await loadEditorRow();
    res.json(editorPayload(row));
  } catch (err) {
    console.error('Error discarding site draft:', err);
    res.status(500).json({ error: 'No se pudo descartar el borrador' });
  }
});

// Volver al contenido inicial (como borrador; no publica nada).
router.post('/api/site/home/reset', authenticateToken, async (req, res) => {
  const user = await ensureSiteAccess(req, res);
  if (!user) return;
  try {
    await pool.query(
      'UPDATE site_pages SET draft = $1, updated_by = $2, updated_at = NOW() WHERE key = $3',
      [JSON.stringify(DEFAULT_HOME), user.id, 'home']
    );
    const row = await loadEditorRow();
    res.json(editorPayload(row));
  } catch (err) {
    console.error('Error resetting site draft:', err);
    res.status(500).json({ error: 'No se pudo restaurar el contenido inicial' });
  }
});

// Subir una foto (data URL ya reducida en el navegador). Devuelve la URL a
// guardar en el contenido. Las fotos que dejen de usarse se borran al publicar.
router.post('/api/site-assets', authenticateToken, async (req, res) => {
  const user = await ensureSiteAccess(req, res);
  if (!user) return;
  try {
    const { mime, buffer } = decodeImageDataUrl(req.body?.data_url, { maxBytes: 2 * 1024 * 1024 });
    const key = `img-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const accessToken = crypto.randomBytes(16).toString('hex');
    await pool.query(
      'INSERT INTO site_assets (key, mime, data, access_token, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [key, mime, buffer, accessToken, user.id]
    );
    res.json({ key, url: `/api/site-assets/${key}/${accessToken}`, bytes: buffer.length });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('Error uploading site asset:', err);
    res.status(500).json({ error: 'No se pudo subir la foto' });
  }
});

module.exports = router;
