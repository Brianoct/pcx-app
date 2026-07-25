// Catálogo geográfico canónico: siembra, búsqueda y resolución de destinos.
const { pool } = require('../db');
const { BOLIVIA_GEO, GEO_ALIASES } = require('../data/boliviaGeo');

// "Ñuflo de Chávez" → "nuflo de chavez": minúsculas y sin acentos, para que la
// búsqueda del vendedor matchee escriba como escriba.
const normalizeGeoText = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

// Upsert idempotente del catálogo al arrancar (339 filas — barato). Editar el
// data file y redeplegar basta para corregir o ampliar el catálogo.
const syncGeoCatalog = async () => {
  const rows = [];
  for (const [departamento, provincias] of Object.entries(BOLIVIA_GEO)) {
    for (const [provincia, municipios] of Object.entries(provincias)) {
      for (const municipio of municipios) {
        const aliases = GEO_ALIASES[municipio] || [];
        const searchTerms = [normalizeGeoText(municipio), ...aliases.map(normalizeGeoText)].join(' | ');
        rows.push([departamento, provincia, municipio, searchTerms]);
      }
    }
  }
  for (const [departamento, provincia, municipio, searchTerms] of rows) {
    await pool.query(
      `INSERT INTO geo_destinations (departamento, provincia, municipio, search_terms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (departamento, provincia, municipio)
       DO UPDATE SET search_terms = EXCLUDED.search_terms, active = TRUE`,
      [departamento, provincia, municipio, searchTerms]
    );
  }
  console.log(`geo catalog synced: ${rows.length} municipios`);
};

// Typeahead: prefijo de palabra primero, luego subcadena; máx 12 resultados.
const searchGeoDestinations = async (query) => {
  const normalized = normalizeGeoText(query);
  if (normalized.length < 2) return [];
  const prefix = `${normalized}%`;
  const wordPrefix = `% ${normalized}%`;
  const anywhere = `%${normalized}%`;
  const result = await pool.query(
    `SELECT id, departamento, provincia, municipio
     FROM geo_destinations
     WHERE active = TRUE AND search_terms LIKE $3
     ORDER BY
       CASE
         WHEN search_terms LIKE $1 THEN 0
         WHEN search_terms LIKE $2 THEN 1
         ELSE 2
       END,
       municipio ASC
     LIMIT 12`,
    [prefix, wordPrefix, anywhere]
  );
  return result.rows;
};

// Resolución servidor-side al guardar una cotización: el id manda; los campos
// canónicos salen del catálogo, nunca del navegador.
const resolveGeoDestination = async (destGeoId) => {
  const id = Number.parseInt(destGeoId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const result = await pool.query(
    'SELECT id, departamento, provincia, municipio FROM geo_destinations WHERE id = $1 AND active = TRUE',
    [id]
  );
  return result.rows[0] || null;
};

module.exports = { normalizeGeoText, resolveGeoDestination, searchGeoDestinations, syncGeoCatalog };
