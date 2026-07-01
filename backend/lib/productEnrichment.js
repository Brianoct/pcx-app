// Shared logic for the product-enrichment CSV round-trip.
//
// Used by both the CLI scripts (scripts/export-products-csv.js,
// scripts/import-products-csv.js) and the admin API endpoints in
// routes/catalogAdmin.js, so the CSV format and update rules stay in one place.

// Column layout of the enrichment CSV. Context columns come first (read-only
// orientation), then the editable attribute columns, then workflow meta.
const CONTEXT_COLUMNS = ['sku', 'name', 'menu_category', 'is_active', 'sf_price', 'cf_price'];
const ARRAY_ATTRS = ['works_with', 'compatible_boards'];
const SCALAR_ATTRS = ['product_line', 'color', 'size', 'dimensions', 'material', 'weight', 'load_capacity', 'variant_group', 'long_description'];
const ATTR_COLUMNS = ['product_line', 'color', 'size', 'dimensions', 'material', 'weight', 'load_capacity', 'works_with', 'compatible_boards', 'variant_group', 'long_description'];
const META_COLUMNS = ['status', 'notes'];
const COLUMNS = [...CONTEXT_COLUMNS, ...ATTR_COLUMNS, ...META_COLUMNS];

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
    menu_category: row.menu_category || '',
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

// ── Attribute mapping ────────────────────────────────────────────────────────
const normalizeProductLine = (value, warnings) => {
  const key = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (key === 'acero') return 'Acero';
  if (key === 'armonia') return 'Armonia';
  if (warnings) warnings.push(`product_line "${value}" is not Acero/Armonia — kept as-is`);
  return String(value).trim();
};

const buildAttributes = (record, warnings) => {
  const attrs = {};
  for (const key of SCALAR_ATTRS) {
    const v = String(record[key] ?? '').trim();
    if (!v) continue;
    if (key === 'long_description') attrs[key] = v.slice(0, MAX_LONG_DESCRIPTION);
    else if (key === 'product_line') attrs[key] = normalizeProductLine(v, warnings);
    else attrs[key] = v;
  }
  for (const key of ARRAY_ATTRS) {
    const v = String(record[key] ?? '').trim();
    if (v) {
      const list = v.split(';').map((s) => s.trim()).filter(Boolean);
      if (list.length) attrs[key] = list;
    }
  }
  for (const key of META_COLUMNS) {
    const v = String(record[key] ?? '').trim();
    if (v) attrs[key] = v;
  }
  return attrs;
};

// Parse a raw CSV string into a planned update set (no DB writes). Pure given
// the set of known SKUs — used for the dry-run preview.
const planImport = (text, knownSkus, { updateNames = false } = {}) => {
  const rows = parseCsv(text);
  const warnings = [];
  if (rows.length < 2) return { header: [], updates: [], unknown: [], skipped: [], warnings: ['CSV has no data rows.'] };
  const header = rows[0].map((h) => h.trim());
  if (!header.includes('sku')) return { header, updates: [], unknown: [], skipped: [], warnings: ['CSV is missing a "sku" column.'] };

  const known = new Set([...knownSkus].map((s) => String(s).toUpperCase()));
  const updates = [];
  const unknown = [];
  const skipped = [];
  for (const cols of rows.slice(1)) {
    const record = {};
    header.forEach((h, i) => { record[h] = cols[i] ?? ''; });
    const sku = String(record.sku || '').trim().toUpperCase();
    if (!sku) continue;
    if (!known.has(sku)) { unknown.push(sku); continue; }
    const attrs = buildAttributes(record, warnings);
    let name = null;
    if (updateNames) {
      const raw = String(record.name || '').trim();
      if (raw && raw.length <= MAX_NAME) name = raw;
      else if (raw.length > MAX_NAME) warnings.push(`${sku}: name too long (max ${MAX_NAME}) — skipping rename`);
    }
    if (Object.keys(attrs).length === 0 && !name) { skipped.push(sku); continue; }
    updates.push({ sku, attrs, name });
  }
  return { header, updates, unknown, skipped, warnings };
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
  COLUMNS, CONTEXT_COLUMNS, ATTR_COLUMNS, ARRAY_ATTRS, SCALAR_ATTRS, META_COLUMNS,
  csvCell, toCsv, parseCsv, flattenProductRow,
  normalizeProductLine, buildAttributes, planImport,
  exportProductsCsv, importProductsCsv
};
