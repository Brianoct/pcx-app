const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');

const router = express.Router();

const buildPosting = (row) => ({
  id: Number(row.id),
  title: row.title,
  area: row.area || '',
  location: row.location || '',
  employment_type: row.employment_type || 'Tiempo completo',
  description: row.description || '',
  requirements: row.requirements || '',
  is_active: Boolean(row.is_active),
  created_at: row.created_at
});

const parsePosting = (body = {}) => {
  const title = String(body.title || '').trim().slice(0, 120);
  if (!title) return { error: 'El título del puesto es obligatorio' };
  return {
    title,
    area: String(body.area || '').trim().slice(0, 80),
    location: String(body.location || '').trim().slice(0, 80),
    employment_type: String(body.employment_type || 'Tiempo completo').trim().slice(0, 60),
    description: String(body.description || '').trim().slice(0, 4000),
    requirements: String(body.requirements || '').trim().slice(0, 4000)
  };
};

// Public: the careers page is part of the marketing site — no login required.
router.get('/api/careers', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, area, location, employment_type, description, requirements, is_active, created_at
       FROM job_postings
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );
    res.json({ postings: result.rows.map(buildPosting) });
  } catch (err) {
    console.error('Error loading careers:', err);
    res.status(500).json({ error: 'No se pudieron cargar las convocatorias' });
  }
});

// ─── Admin management ────────────────────────────────────────────────────────

router.get('/api/admin/careers', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.display_name AS author_name
       FROM job_postings p
       LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.is_active DESC, p.created_at DESC`
    );
    res.json({ postings: result.rows.map((row) => ({ ...buildPosting(row), author: row.author_name || null })) });
  } catch (err) {
    console.error('Error loading admin careers:', err);
    res.status(500).json({ error: 'No se pudieron cargar las convocatorias' });
  }
});

router.post('/api/admin/careers', authenticateToken, requireRole(['admin']), async (req, res) => {
  const parsed = parsePosting(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const result = await pool.query(
      `INSERT INTO job_postings (title, area, location, employment_type, description, requirements, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [parsed.title, parsed.area, parsed.location, parsed.employment_type, parsed.description, parsed.requirements, req.user.id]
    );
    res.status(201).json({ message: 'Convocatoria publicada', posting: buildPosting(result.rows[0]) });
  } catch (err) {
    console.error('Error creating posting:', err);
    res.status(500).json({ error: 'No se pudo crear la convocatoria' });
  }
});

router.put('/api/admin/careers/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const postingId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(postingId) || postingId <= 0) return res.status(400).json({ error: 'ID inválido' });
  const parsed = parsePosting(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const result = await pool.query(
      `UPDATE job_postings
       SET title = $2, area = $3, location = $4, employment_type = $5, description = $6, requirements = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [postingId, parsed.title, parsed.area, parsed.location, parsed.employment_type, parsed.description, parsed.requirements]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Convocatoria no encontrada' });
    res.json({ message: 'Convocatoria actualizada', posting: buildPosting(result.rows[0]) });
  } catch (err) {
    console.error('Error updating posting:', err);
    res.status(500).json({ error: 'No se pudo actualizar la convocatoria' });
  }
});

// Cerrar/reabrir una convocatoria sin borrarla (mantiene el historial).
router.patch('/api/admin/careers/:id/active', authenticateToken, requireRole(['admin']), async (req, res) => {
  const postingId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(postingId) || postingId <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await pool.query(
      `UPDATE job_postings SET is_active = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [postingId, Boolean(req.body?.is_active)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Convocatoria no encontrada' });
    const posting = buildPosting(result.rows[0]);
    res.json({ message: posting.is_active ? 'Convocatoria publicada' : 'Convocatoria cerrada', posting });
  } catch (err) {
    console.error('Error toggling posting:', err);
    res.status(500).json({ error: 'No se pudo cambiar el estado' });
  }
});

router.delete('/api/admin/careers/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM job_postings WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Convocatoria no encontrada' });
    res.json({ message: 'Convocatoria eliminada' });
  } catch (err) {
    console.error('Error deleting posting:', err);
    res.status(500).json({ error: 'No se pudo eliminar la convocatoria' });
  }
});

module.exports = router;
