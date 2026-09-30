const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { loadHomeContent } = require('../lib/site');

const router = express.Router();

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

module.exports = router;
