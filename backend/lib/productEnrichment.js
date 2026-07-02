// Shared logic for the product-enrichment CSV round-trip.
//
// Used by both the CLI scripts (scripts/export-products-csv.js,
// scripts/import-products-csv.js) and the admin API endpoints in
// routes/catalogAdmin.js, so the CSV format and update rules stay in one place.
//
// Column semantics (v2 — content in Spanish):
//   Context (read-only):  sku, name, category, is_active, sf_price, cf_price
//   Attributes (JSONB):   product_line, color, size, dimensions, material,
//                         weight, load_capacity, capacidad, unidades_por_lote,
//                         presentacion, works_with, compatible, variant_group,
//                         long_description, ambientes
//   Workflow meta:        status, notes
//
// Conventions:
//   * sf_price/cf_price are the price of ONE sellable unit = one "presentación"
//     (e.g. a dozen of hooks is one unit at 84 Bs). `unidades_por_lote` says how
//     many pieces that presentación contains; `presentacion` is the label shown
//     to people ("Docena", "Media docena", "Unidad").
//   * `capacidad` says how many items a holder holds ("10 desarmadores").
//   * `compatible` lists SKUs this product works with, in either direction
//     (accessory -> boards, board -> accessories). Import warns when A lists B
//     but B doesn't list A back, so the two directions can't silently drift.

const CONTEXT_COLUMNS = ['sku', 'name', 'category', 'is_active', 'sf_price', 'cf_price'];
const ARRAY_ATTRS = ['works_with', 'compatible'];
const SCALAR_ATTRS = [
  'product_line', 'color', 'size', 'dimensions', 'material', 'weight', 'load_capacity',
  'capacidad', 'unidades_por_lote', 'presentacion', 'variant_group', 'long_description', 'ambientes'
];
const ATTR_COLUMNS = [
  'product_line', 'color', 'size', 'dimensions', 'material', 'weight', 'load_capacity',
  'capacidad', 'unidades_por_lote', 'presentacion', 'works_with', 'compatible',
  'variant_group', 'long_description', 'ambientes'
];
const META_COLUMNS = ['status', 'notes'];
const COLUMNS = [...CONTEXT_COLUMNS, ...ATTR_COLUMNS, ...META_COLUMNS];

// Older exports / hand-edited sheets may use these header names.
const HEADER_ALIASES = {
  menu_category: 'category',
  categoria: 'category',
  compatible_boards: 'compatible',
  compatible_con: 'compatible',
  lote: 'unidades_por_lote',
  notas: 'notes',
  descripcion_larga: 'long_description'
};

const MAX_LONG_DESCRIPTION = 2000;
const MAX_NAME = 120;
const MAX_DESCRIPTION_COLUMN = 1000;

// ── CSV serialization ────────────────────────────────────────────────────────
const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const flattenProductRow = (row) => {
  const attrs = row.attributes && typeof row.attributes === 'object' ? row.attributes : {};
  const record = {
    sku: row.sku,
    name: row.name,
    category: row.menu_category || '',
    is_active: row.is_active,
    sf_price: row.sf_price,
    cf_price: row.cf_price,
    status: attrs.status || '',
    notes: attrs.notes || ''
  };
  for (const key of SCALAR_ATTRS) record[key] = attrs[key] ?? '';
  for (const key of ARRAY_ATTRS) {
    record[key] = Array.isArray(attrs[key]) ? attrs[key].join('; ') : (attrs[key] ?? '');
  }
  return record;
};

const toCsv = (productRows) => {
  const lines = [COLUMNS.map(csvCell).join(',')];
  for (const row of productRows) {
    const record = flattenProductRow(row);
    lines.push(COLUMNS.map((c) => csvCell(record[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
};

// Minimal RFC-4180 CSV parser (handles quotes, commas, and newlines in fields).
const parseCsv = (text) => {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); field = ''; row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
};

// Multi-value cells accept "a; b", one-per-line lists (as pasted from a
// spreadsheet column), and — when neither separator is present — plain commas.
// Prefer semicolons when an item itself contains a comma.
const splitArrayCell = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  let parts = raw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0].includes(',')) {
    parts = parts[0].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return parts;
};

// ── Attribute mapping ────────────────────────────────────────────────────────
// Normalize the two known product lines so casing/accents/typos land consistently.
// Unknown values pass through unchanged (with a warning) to allow future lines.
const normalizeProductLine = (value, warnings) => {
  const key = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (key === 'acero') return 'Acero';
  if (key === 'armonia') return 'Armonia';
  if (warnings) warnings.push(`product_line "${value}" no es Acero/Armonia — se mantiene tal cual`);
  return String(value).trim();
};

const buildAttributes = (record, warnings, sku = '') => {
  const attrs = {};
  for (const key of SCALAR_ATTRS) {
    const v = String(record[key] ?? '').trim();
    if (!v) continue;
    if (key === 'long_description' || key === 'ambientes') attrs[key] = v.slice(0, MAX_LONG_DESCRIPTION);
    else if (key === 'product_line') attrs[key] = normalizeProductLine(v, warnings);
    else attrs[key] = v;
  }
  if (attrs.unidades_por_lote && warnings) {
    const n = Number(attrs.unidades_por_lote);
    if (!Number.isInteger(n) || n <= 0) {
      warnings.push(`${sku || record.sku || '?'}: unidades_por_lote "${attrs.unidades_por_lote}" no es un entero positivo`);
    }
  }
  for (const key of ARRAY_ATTRS) {
    const list = splitArrayCell(record[key]);
    if (list.length) attrs[key] = key === 'compatible' ? list.map((s) => s.toUpperCase()) : list;
  }
  for (const key of META_COLUMNS) {
    const v = String(record[key] ?? '').trim();
    if (v) attrs[key] = v;
  }
  return attrs;
};

// Cross-row check: if A lists B in `compatible` but B (also present in the CSV)
// doesn't list A back, the two directions have drifted. Aggregated per target.
const checkCompatibilitySymmetry = (updates, warnings) => {
  const compatBySku = new Map();
  for (const u of updates) {
    if (Array.isArray(u.attrs.compatible)) compatBySku.set(u.sku, new Set(u.attrs.compatible));
  }
  const missing = new Map();
  for (const [a, set] of compatBySku) {
    for (const b of set) {
      if (!compatBySku.has(b)) continue; // b not in this CSV (or has no list) — can't compare
      if (!compatBySku.get(b).has(a)) {
        if (!missing.has(b)) missing.set(b, []);
        missing.get(b).push(a);
      }
    }
  }
  let emitted = 0;
  for (const [b, froms] of missing) {
    if (emitted >= 15) { warnings.push(`…y ${missing.size - emitted} inconsistencias de compatibilidad más`); break; }
    warnings.push(`Compatibilidad asimétrica: ${b} no lista de vuelta a: ${[...new Set(froms)].join(', ')}`);
    emitted += 1;
  }
};

// Parse a raw CSV string into a planned update set (no DB writes). Pure given
// the set of known SKUs — used for the dry-run preview.
const planImport = (text, knownSkus, { updateNames = false } = {}) => {
  const rows = parseCsv(text);
  const warnings = [];
  const empty = { header: [], updates: [], unknown: [], skipped: [], duplicates: [], warnings };
  if (rows.length < 2) { warnings.push('El CSV no tiene filas de datos.'); return empty; }

  const header = rows[0].map((h) => {
    const key = String(h).trim().toLowerCase();
    return HEADER_ALIASES[key] || key;
  });
  if (!header.includes('sku')) { warnings.push('Al CSV le falta la columna "sku".'); return { ...empty, header }; }

  const known = new Set([...knownSkus].map((s) => String(s).toUpperCase()));
  const updates = [];
  const unknown = [];
  const skipped = [];
  const duplicates = [];
  const seen = new Set();
  for (const cols of rows.slice(1)) {
    const record = {};
    header.forEach((h, i) => { record[h] = cols[i] ?? ''; });
    const sku = String(record.sku || '').trim().toUpperCase();
    if (!sku) {
      const label = String(record.name || '').trim();
      if (label) warnings.push(`Fila sin SKU (omitida): "${label}"`);
      continue;
    }
    if (seen.has(sku)) {
      duplicates.push(sku);
      warnings.push(`SKU duplicado en el CSV: ${sku} — solo se aplica la primera fila`);
      continue;
    }
    seen.add(sku);
    if (!known.has(sku)) { unknown.push(sku); continue; }
    const attrs = buildAttributes(record, warnings, sku);
    // Renaming is opt-in (updateNames). SKU always stays the key.
    let name = null;
    if (updateNames) {
      const raw = String(record.name || '').trim();
      if (raw && raw.length <= MAX_NAME) name = raw;
      else if (raw.length > MAX_NAME) warnings.push(`${sku}: nombre demasiado largo (máx ${MAX_NAME}) — no se renombra`);
    }
    if (Object.keys(attrs).length === 0 && !name) { skipped.push(sku); continue; }
    // Compatibility references must point at products that exist.
    if (Array.isArray(attrs.compatible)) {
      const ghosts = attrs.compatible.filter((s) => !known.has(s));
      if (ghosts.length) warnings.push(`${sku}: "compatible" referencia SKUs inexistentes: ${ghosts.join(', ')}`);
    }
    updates.push({ sku, attrs, name });
  }

  checkCompatibilitySymmetry(updates, warnings);
  return { header, updates, unknown, skipped, duplicates, warnings };
};

// ── DB operations (pool passed in so this stays testable / db-import-free) ────
const exportProductsCsv = async (pool, { activeOnly = false } = {}) => {
  const result = await pool.query(
    `SELECT sku, name, menu_category, is_active, sf_price, cf_price, attributes
     FROM products
     ${activeOnly ? 'WHERE is_active = TRUE' : ''}
     ORDER BY menu_category NULLS LAST, UPPER(name) ASC, UPPER(sku) ASC`
  );
  return { csv: toCsv(result.rows), count: result.rows.length };
};

const importProductsCsv = async (pool, { text, commit = false, updateNames = false, syncDescription = false }) => {
  const existing = await pool.query('SELECT sku FROM products');
  const knownSkus = existing.rows.map((r) => r.sku);
  const plan = planImport(text, knownSkus, { updateNames });

  if (!commit) {
    return { ...plan, applied: false };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of plan.updates) {
      await client.query(
        'UPDATE products SET attributes = attributes || $2::jsonb, last_updated = NOW() WHERE UPPER(sku) = $1',
        [u.sku, JSON.stringify(u.attrs)]
      );
      if (u.name) {
        await client.query('UPDATE products SET name = $2, last_updated = NOW() WHERE UPPER(sku) = $1', [u.sku, u.name]);
      }
      if (syncDescription && u.attrs.long_description) {
        await client.query('UPDATE products SET description = $2 WHERE UPPER(sku) = $1', [u.sku, String(u.attrs.long_description).slice(0, MAX_DESCRIPTION_COLUMN)]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ...plan, applied: true };
};

module.exports = {
  COLUMNS, CONTEXT_COLUMNS, ATTR_COLUMNS, ARRAY_ATTRS, SCALAR_ATTRS, META_COLUMNS, HEADER_ALIASES,
  csvCell, toCsv, parseCsv, splitArrayCell, flattenProductRow,
  normalizeProductLine, buildAttributes, planImport,
  exportProductsCsv, importProductsCsv
};
