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
// extra_terms son alias guardados por Admin al reclasificar (el sync del
// arranque no los toca).
const searchGeoDestinations = async (query) => {
  const normalized = normalizeGeoText(query);
  if (normalized.length < 2) return [];
  const prefix = `${normalized}%`;
  const wordPrefix = `% ${normalized}%`;
  const anywhere = `%${normalized}%`;
  const result = await pool.query(
    `SELECT id, departamento, provincia, municipio
     FROM geo_destinations
     WHERE active = TRUE AND (search_terms || ' | ' || extra_terms) LIKE $3
     ORDER BY
       CASE
         WHEN (search_terms || ' | ' || extra_terms) LIKE $1 THEN 0
         WHEN (search_terms || ' | ' || extra_terms) LIKE $2 THEN 1
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

// ── Reclasificación de cotizaciones históricas (fase 2) ─────────────────────

// Índices en memoria a partir del catálogo: término exacto → municipios, y
// nombre de provincia → provincias. El catálogo son ~340 filas, es barato.
const loadGeoIndexes = async () => {
  const result = await pool.query(
    'SELECT id, departamento, provincia, municipio, search_terms, extra_terms FROM geo_destinations WHERE active = TRUE'
  );
  const byTerm = new Map();
  const byProvincia = new Map();
  for (const row of result.rows) {
    const terms = `${row.search_terms} | ${row.extra_terms || ''}`
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const term of terms) {
      if (!byTerm.has(term)) byTerm.set(term, []);
      byTerm.get(term).push(row);
    }
    const provKey = normalizeGeoText(row.provincia);
    if (!byProvincia.has(provKey)) byProvincia.set(provKey, []);
    byProvincia.get(provKey).push(row);
  }
  return { byTerm, byProvincia };
};

// El texto libre que dejó el vendedor: ciudad si existe, si no la provincia
// legacy (antes de fase 1 ahí se escribía la ciudad a mano).
const legacyTextOf = (quote) => {
  const ciudad = String(quote.ciudad || '').trim();
  const provincia = String(quote.provincia || '').trim();
  return ciudad || provincia;
};

const uniqueDept = (rows) => {
  const depts = new Set(rows.map((r) => r.departamento));
  return depts.size === 1 ? rows[0].departamento : null;
};

// Clasifica todas las cotizaciones sin dest_geo_id contra el catálogo.
// apply=false: solo cuenta qué pasaría (para el panel). apply=true: escribe.
// Reglas: match exacto de término (municipio o alias) → canónico completo;
// homónimos se desambiguan por departamento de la cotización; texto igual a
// una provincia → solo corrige departamento/provincia (queda pendiente de
// asignar municipio, con pista para el Admin).
const classifyLegacyQuotes = async ({ apply = false } = {}) => {
  const { byTerm, byProvincia } = await loadGeoIndexes();
  const candidates = await pool.query(
    "SELECT id, department, provincia, ciudad FROM quotes WHERE dest_geo_id IS NULL AND (NULLIF(TRIM(COALESCE(ciudad, '')), '') IS NOT NULL OR NULLIF(TRIM(COALESCE(provincia, '')), '') IS NOT NULL)"
  );

  const fullMatches = new Map();      // geoId → { geo, quoteIds }
  const provMatches = new Map();      // "dep|prov" → { departamento, provincia, quoteIds }
  const unmatched = new Map();        // texto normalizado → { text, count, hint }

  for (const quote of candidates.rows) {
    const rawText = legacyTextOf(quote);
    const key = normalizeGeoText(rawText);
    if (!key) continue;
    const quoteDept = normalizeGeoText(quote.department || '');

    let rows = byTerm.get(key) || [];
    if (rows.length > 1 && quoteDept) {
      const filtered = rows.filter((r) => normalizeGeoText(r.departamento) === quoteDept);
      if (filtered.length >= 1) rows = filtered;
    }
    if (rows.length === 1) {
      const geo = rows[0];
      if (!fullMatches.has(geo.id)) fullMatches.set(geo.id, { geo, quoteIds: [] });
      fullMatches.get(geo.id).quoteIds.push(quote.id);
      continue;
    }
    if (rows.length > 1) {
      const hint = `Hay ${rows.length} municipios "${rawText}" (${rows.map((r) => r.departamento).join(', ')}); elige el correcto`;
      const entry = unmatched.get(key) || { text: rawText, count: 0, hint };
      entry.count += 1;
      unmatched.set(key, entry);
      continue;
    }

    // No es un municipio conocido: ¿es el nombre de una provincia?
    let provRows = byProvincia.get(key) || [];
    if (provRows.length && quoteDept) {
      const filtered = provRows.filter((r) => normalizeGeoText(r.departamento) === quoteDept);
      if (filtered.length) provRows = filtered;
    }
    const provDept = provRows.length ? uniqueDept(provRows) : null;
    if (provDept) {
      const provincia = provRows[0].provincia;
      const provKey = `${provDept}|${provincia}`;
      if (!provMatches.has(provKey)) provMatches.set(provKey, { departamento: provDept, provincia, quoteIds: [] });
      provMatches.get(provKey).quoteIds.push(quote.id);
      const hint = `Es la provincia ${provincia} (${provDept}); asigna el municipio para clasificarla del todo`;
      const entry = unmatched.get(key) || { text: rawText, count: 0, hint };
      entry.count += 1;
      unmatched.set(key, entry);
      continue;
    }

    const entry = unmatched.get(key) || { text: rawText, count: 0, hint: null };
    entry.count += 1;
    unmatched.set(key, entry);
  }

  let updatedFull = 0;
  let updatedProvincia = 0;
  for (const { geo, quoteIds } of fullMatches.values()) {
    updatedFull += quoteIds.length;
    if (apply) {
      await pool.query(
        'UPDATE quotes SET dest_geo_id = $1, department = $2, provincia = $3, ciudad = $4 WHERE id = ANY($5)',
        [geo.id, geo.departamento, geo.provincia, geo.municipio, quoteIds]
      );
    }
  }
  for (const { departamento, provincia, quoteIds } of provMatches.values()) {
    updatedProvincia += quoteIds.length;
    if (apply) {
      await pool.query(
        'UPDATE quotes SET department = $1, provincia = $2 WHERE id = ANY($3)',
        [departamento, provincia, quoteIds]
      );
    }
  }

  const unmatchedList = [...unmatched.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return { candidates: candidates.rows.length, updatedFull, updatedProvincia, unmatched: unmatchedList };
};

// Conteos globales para el panel Destinos.
const geoClassificationCounts = async () => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE dest_geo_id IS NOT NULL)::int AS clasificado,
            COUNT(*) FILTER (WHERE dest_geo_id IS NULL
              AND (NULLIF(TRIM(COALESCE(ciudad, '')), '') IS NOT NULL OR NULLIF(TRIM(COALESCE(provincia, '')), '') IS NOT NULL))::int AS pendiente,
            COUNT(*) FILTER (WHERE dest_geo_id IS NULL
              AND NULLIF(TRIM(COALESCE(ciudad, '')), '') IS NULL AND NULLIF(TRIM(COALESCE(provincia, '')), '') IS NULL
              AND NULLIF(TRIM(COALESCE(department, '')), '') IS NOT NULL)::int AS solo_departamento,
            COUNT(*) FILTER (WHERE dest_geo_id IS NULL
              AND NULLIF(TRIM(COALESCE(ciudad, '')), '') IS NULL AND NULLIF(TRIM(COALESCE(provincia, '')), '') IS NULL
              AND NULLIF(TRIM(COALESCE(department, '')), '') IS NULL)::int AS sin_destino
     FROM quotes`
  );
  return result.rows[0];
};

// Asigna manualmente un texto libre a un municipio: actualiza todas las
// cotizaciones pendientes con ese texto y, si se pide, guarda el alias en
// extra_terms para que el buscador y futuras reclasificaciones lo reconozcan.
const assignGeoText = async ({ text, destGeoId, saveAlias = false }) => {
  const geo = await resolveGeoDestination(destGeoId);
  if (!geo) return { error: 'Destino inválido' };
  const key = normalizeGeoText(text);
  if (!key) return { error: 'Texto vacío' };

  const candidates = await pool.query(
    "SELECT id, provincia, ciudad FROM quotes WHERE dest_geo_id IS NULL AND (NULLIF(TRIM(COALESCE(ciudad, '')), '') IS NOT NULL OR NULLIF(TRIM(COALESCE(provincia, '')), '') IS NOT NULL)"
  );
  const ids = candidates.rows
    .filter((q) => normalizeGeoText(legacyTextOf(q)) === key)
    .map((q) => q.id);
  if (ids.length) {
    await pool.query(
      'UPDATE quotes SET dest_geo_id = $1, department = $2, provincia = $3, ciudad = $4 WHERE id = ANY($5)',
      [geo.id, geo.departamento, geo.provincia, geo.municipio, ids]
    );
  }

  let aliasSaved = false;
  if (saveAlias) {
    const current = await pool.query('SELECT search_terms, extra_terms FROM geo_destinations WHERE id = $1', [geo.id]);
    const existing = `${current.rows[0].search_terms} | ${current.rows[0].extra_terms || ''}`
      .split('|').map((t) => t.trim());
    if (!existing.includes(key)) {
      await pool.query(
        `UPDATE geo_destinations
         SET extra_terms = CASE WHEN extra_terms = '' THEN $2 ELSE extra_terms || ' | ' || $2 END
         WHERE id = $1`,
        [geo.id, key]
      );
      aliasSaved = true;
    }
  }
  return { updated: ids.length, aliasSaved, geo };
};

module.exports = {
  assignGeoText,
  classifyLegacyQuotes,
  geoClassificationCounts,
  normalizeGeoText,
  resolveGeoDestination,
  searchGeoDestinations,
  syncGeoCatalog
};
