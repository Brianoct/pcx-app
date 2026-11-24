const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');

const router = express.Router();

// Atajos de Cotizar: lo que este vendedor cotiza más seguido, para agregarlo
// con un toque. Mira las cotizaciones de los últimos 120 días; primero lo
// propio y, si falta historia, lo que más cotiza toda la empresa.
const WINDOW = "INTERVAL '120 days'";

const topProducts = async (userId) => {
  const res = await pool.query(
    `WITH items AS (
       SELECT q.id, (q.user_id = $1 OR q.created_by_user_id = $1) AS mine,
              UPPER(TRIM(li->>'sku')) AS sku
       FROM quotes q
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(q.line_items) = 'array' THEN q.line_items ELSE '[]'::jsonb END
       ) li
       WHERE q.created_at >= NOW() - ${WINDOW}
         AND COALESCE(TRIM(li->>'sku'), '') <> ''
     )
     SELECT sku,
            COUNT(DISTINCT id) FILTER (WHERE mine)::int AS mine,
            COUNT(DISTINCT id)::int AS everyone
     FROM items
     GROUP BY sku
     ORDER BY mine DESC, everyone DESC, sku
     LIMIT 16`,
    [userId]
  );
  return res.rows.map((row) => ({ sku: row.sku, mine: row.mine, everyone: row.everyone }));
};

const topDestinations = async (userId) => {
  const res = await pool.query(
    `SELECT g.id, g.municipio, g.provincia, g.departamento,
            COUNT(*) FILTER (WHERE q.user_id = $1 OR q.created_by_user_id = $1)::int AS mine,
            COUNT(*)::int AS everyone
     FROM quotes q
     JOIN geo_destinations g ON g.id = q.dest_geo_id AND g.active = TRUE
     WHERE q.created_at >= NOW() - ${WINDOW}
     GROUP BY g.id, g.municipio, g.provincia, g.departamento
     ORDER BY mine DESC, everyone DESC, g.municipio
     LIMIT 4`,
    [userId]
  );
  return res.rows.map((row) => ({
    id: row.id, municipio: row.municipio, provincia: row.provincia, departamento: row.departamento
  }));
};

// Un atajo que falla nunca debe estorbar la cotización: devuelve vacío.
const safely = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    console.error(`Atajos de Cotizar (${label}):`, err.message);
    return [];
  }
};

router.get('/api/quote-shortcuts', authenticateToken, async (req, res) => {
  const userId = Number(req.user.id);
  const [products, destinations] = await Promise.all([
    safely('productos', () => topProducts(userId)),
    safely('destinos', () => topDestinations(userId))
  ]);
  res.json({ top_products: products, top_destinations: destinations });
});

module.exports = router;
