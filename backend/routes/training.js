const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');

// La Montaña: programa de entrenamiento de élite. Todo es de acceso admin —
// vive aparte del negocio del día a día.
const router = express.Router();
const adminOnly = [authenticateToken, requireRole(['admin'])];

const STATUSES = ['activo', 'graduado', 'baja'];

const buildCandidate = (row) => ({
  id: Number(row.id),
  full_name: row.full_name,
  number: Number(row.number),
  phone: row.phone || null,
  city: row.city || null,
  objective: row.objective || '',
  status: row.status,
  start_date: row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : String(row.start_date).slice(0, 10),
  created_at: row.created_at,
  avg_score: row.avg_score !== undefined ? (row.avg_score === null ? null : Number(row.avg_score)) : undefined,
  scored_count: row.scored_count !== undefined ? Number(row.scored_count || 0) : undefined,
  challenge_count: row.challenge_count !== undefined ? Number(row.challenge_count || 0) : undefined,
  last_note: row.last_note !== undefined ? (row.last_note || null) : undefined
});

const parseCandidate = (body = {}, { partial = false } = {}) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const out = {};
  if (!partial || has('full_name')) {
    const name = String(body.full_name || '').trim().slice(0, 120);
    if (!name) return { error: 'El nombre es obligatorio' };
    out.full_name = name;
  }
  if (!partial || has('number')) {
    const number = Number.parseInt(body.number, 10);
    if (!Number.isInteger(number) || number < 1 || number > 99) {
      return { error: 'El número debe estar entre 1 y 99' };
    }
    out.number = number;
  }
  if (has('phone')) out.phone = String(body.phone || '').trim().slice(0, 40) || null;
  if (has('city')) out.city = String(body.city || '').trim().slice(0, 80) || null;
  if (has('objective')) out.objective = String(body.objective || '').trim().slice(0, 300);
  if (has('status')) {
    const status = String(body.status || '').trim().toLowerCase();
    if (!STATUSES.includes(status)) return { error: 'Estado inválido' };
    out.status = status;
  }
  if (has('start_date')) {
    const raw = String(body.start_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: 'Fecha de inicio inválida (AAAA-MM-DD)' };
    out.start_date = raw;
  }
  return { fields: out };
};

const CANDIDATE_LIST_SQL = `
  SELECT c.*,
         s.avg_score, s.scored_count,
         (SELECT COUNT(*)::int FROM training_challenges ch WHERE ch.is_active) AS challenge_count,
         n.last_note
  FROM training_candidates c
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(score)::numeric, 1) AS avg_score, COUNT(*)::int AS scored_count
    FROM training_scores ts
    JOIN training_challenges tc ON tc.id = ts.challenge_id AND tc.is_active
    WHERE ts.candidate_id = c.id
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT note AS last_note FROM training_notes
    WHERE candidate_id = c.id ORDER BY created_at DESC LIMIT 1
  ) n ON TRUE`;

router.get('/api/training/candidates', ...adminOnly, async (_req, res) => {
  try {
    const result = await pool.query(
      `${CANDIDATE_LIST_SQL}
       ORDER BY (c.status = 'activo') DESC, c.number ASC, c.created_at DESC`
    );
    res.json({ candidates: result.rows.map(buildCandidate) });
  } catch (err) {
    console.error('Error loading candidates:', err);
    res.status(500).json({ error: 'No se pudieron cargar los candidatos' });
  }
});

router.post('/api/training/candidates', ...adminOnly, async (req, res) => {
  const parsed = parseCandidate(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const f = parsed.fields;
  try {
    const result = await pool.query(
      `INSERT INTO training_candidates (full_name, number, phone, city, objective, start_date, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7)
       RETURNING *`,
      [f.full_name, f.number, f.phone || null, f.city || null, f.objective || '', f.start_date || null, req.user.id]
    );
    res.status(201).json({ message: 'Candidato enlistado', candidate: buildCandidate(result.rows[0]) });
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: `El número ${f.number} ya está en uso por un candidato activo` });
    console.error('Error creating candidate:', err);
    res.status(500).json({ error: 'No se pudo enlistar al candidato' });
  }
});

router.patch('/api/training/candidates/:id', ...adminOnly, async (req, res) => {
  const candidateId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(candidateId) || candidateId <= 0) return res.status(400).json({ error: 'ID inválido' });
  const parsed = parseCandidate(req.body, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const keys = Object.keys(parsed.fields);
  if (keys.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  try {
    const sets = [];
    const values = [candidateId];
    for (const key of keys) {
      values.push(parsed.fields[key]);
      sets.push(`${key} = $${values.length}`);
    }
    const result = await pool.query(
      `UPDATE training_candidates SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Candidato no encontrado' });
    res.json({ message: 'Candidato actualizado', candidate: buildCandidate(result.rows[0]) });
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Ese número ya está en uso por un candidato activo' });
    console.error('Error updating candidate:', err);
    res.status(500).json({ error: 'No se pudo actualizar el candidato' });
  }
});

router.delete('/api/training/candidates/:id', ...adminOnly, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM training_candidates WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Candidato no encontrado' });
    res.json({ message: 'Candidato eliminado' });
  } catch (err) {
    console.error('Error deleting candidate:', err);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

// Ficha completa: candidato + desafíos con su calificación + bitácora.
router.get('/api/training/candidates/:id', ...adminOnly, async (req, res) => {
  const candidateId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(candidateId) || candidateId <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const candRes = await pool.query(`${CANDIDATE_LIST_SQL} WHERE c.id = $1`, [candidateId]);
    if (candRes.rowCount === 0) return res.status(404).json({ error: 'Candidato no encontrado' });
    const [challengesRes, notesRes] = await Promise.all([
      pool.query(
        `SELECT ch.id, ch.title, ch.description, ch.week, ch.position,
                ts.score, ts.comment, ts.graded_at,
                COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS graded_by
         FROM training_challenges ch
         LEFT JOIN training_scores ts ON ts.challenge_id = ch.id AND ts.candidate_id = $1
         LEFT JOIN users u ON u.id = ts.graded_by
         WHERE ch.is_active
         ORDER BY ch.week, ch.position, ch.id`,
        [candidateId]
      ),
      pool.query(
        `SELECT n.id, n.note, n.created_at,
                COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS author
         FROM training_notes n
         LEFT JOIN users u ON u.id = n.created_by
         WHERE n.candidate_id = $1
         ORDER BY n.created_at DESC
         LIMIT 100`,
        [candidateId]
      )
    ]);
    res.json({
      candidate: buildCandidate(candRes.rows[0]),
      challenges: challengesRes.rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        description: row.description || '',
        week: Number(row.week),
        score: row.score === null ? null : Number(row.score),
        comment: row.comment || '',
        graded_by: row.graded_by || null,
        graded_at: row.graded_at
      })),
      notes: notesRes.rows.map((row) => ({
        id: Number(row.id),
        note: row.note,
        author: row.author || null,
        created_at: row.created_at
      }))
    });
  } catch (err) {
    console.error('Error loading candidate detail:', err);
    res.status(500).json({ error: 'No se pudo cargar la ficha' });
  }
});

// Calificar (o recalificar) un desafío.
router.put('/api/training/scores', ...adminOnly, async (req, res) => {
  const candidateId = Number.parseInt(req.body?.candidate_id, 10);
  const challengeId = Number.parseInt(req.body?.challenge_id, 10);
  const score = Number(req.body?.score);
  if (!Number.isInteger(candidateId) || !Number.isInteger(challengeId)) {
    return res.status(400).json({ error: 'Candidato y desafío requeridos' });
  }
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'La nota debe estar entre 0 y 100' });
  }
  const comment = String(req.body?.comment || '').trim().slice(0, 500);
  try {
    await pool.query(
      `INSERT INTO training_scores (candidate_id, challenge_id, score, comment, graded_by, graded_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (candidate_id, challenge_id)
       DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, graded_by = EXCLUDED.graded_by, graded_at = NOW()`,
      [candidateId, challengeId, score, comment, req.user.id]
    );
    res.json({ message: 'Calificación registrada' });
  } catch (err) {
    if (err?.code === '23503') return res.status(404).json({ error: 'Candidato o desafío no encontrado' });
    console.error('Error saving score:', err);
    res.status(500).json({ error: 'No se pudo guardar la calificación' });
  }
});

router.post('/api/training/candidates/:id/notes', ...adminOnly, async (req, res) => {
  const candidateId = Number.parseInt(req.params.id, 10);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!Number.isInteger(candidateId) || candidateId <= 0) return res.status(400).json({ error: 'ID inválido' });
  if (!note) return res.status(400).json({ error: 'La nota no puede estar vacía' });
  try {
    const result = await pool.query(
      `INSERT INTO training_notes (candidate_id, note, created_by)
       VALUES ($1, $2, $3) RETURNING id, note, created_at`,
      [candidateId, note, req.user.id]
    );
    res.status(201).json({ message: 'Nota registrada en la bitácora', note: result.rows[0] });
  } catch (err) {
    if (err?.code === '23503') return res.status(404).json({ error: 'Candidato no encontrado' });
    console.error('Error adding note:', err);
    res.status(500).json({ error: 'No se pudo registrar la nota' });
  }
});

// ─── Desafíos (el plan de las 6 semanas) ─────────────────────────────────────

router.get('/api/training/challenges', ...adminOnly, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, week, position, is_active
       FROM training_challenges
       WHERE is_active
       ORDER BY week, position, id`
    );
    res.json({ challenges: result.rows.map((row) => ({ ...row, id: Number(row.id), week: Number(row.week) })) });
  } catch (err) {
    console.error('Error loading challenges:', err);
    res.status(500).json({ error: 'No se pudieron cargar los desafíos' });
  }
});

const parseChallenge = (body = {}) => {
  const title = String(body.title || '').trim().slice(0, 160);
  if (!title) return { error: 'El título del desafío es obligatorio' };
  const week = Number.parseInt(body.week, 10);
  if (!Number.isInteger(week) || week < 1 || week > 6) return { error: 'La semana debe estar entre 1 y 6' };
  return { title, week, description: String(body.description || '').trim().slice(0, 1000) };
};

router.post('/api/training/challenges', ...adminOnly, async (req, res) => {
  const parsed = parseChallenge(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const posRes = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM training_challenges WHERE week = $1',
      [parsed.week]
    );
    const result = await pool.query(
      `INSERT INTO training_challenges (title, description, week, position)
       VALUES ($1, $2, $3, $4) RETURNING id, title, description, week, position, is_active`,
      [parsed.title, parsed.description, parsed.week, posRes.rows[0].pos]
    );
    res.status(201).json({ message: 'Desafío creado', challenge: result.rows[0] });
  } catch (err) {
    console.error('Error creating challenge:', err);
    res.status(500).json({ error: 'No se pudo crear el desafío' });
  }
});

router.put('/api/training/challenges/:id', ...adminOnly, async (req, res) => {
  const parsed = parseChallenge(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const result = await pool.query(
      `UPDATE training_challenges SET title = $2, description = $3, week = $4
       WHERE id = $1 RETURNING id`,
      [req.params.id, parsed.title, parsed.description, parsed.week]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Desafío no encontrado' });
    res.json({ message: 'Desafío actualizado' });
  } catch (err) {
    console.error('Error updating challenge:', err);
    res.status(500).json({ error: 'No se pudo actualizar el desafío' });
  }
});

// Retirar un desafío del plan (se conserva el historial de notas ya puestas).
router.delete('/api/training/challenges/:id', ...adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE training_challenges SET is_active = FALSE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Desafío no encontrado' });
    res.json({ message: 'Desafío retirado del plan' });
  } catch (err) {
    console.error('Error removing challenge:', err);
    res.status(500).json({ error: 'No se pudo retirar el desafío' });
  }
});

module.exports = router;
