// Import an enriched product CSV back into products.attributes (JSONB).
//
//   node scripts/import-products-csv.js products-enrichment.csv            (DRY RUN — shows changes, writes nothing)
//   node scripts/import-products-csv.js products-enrichment.csv --commit   (apply)
//   node scripts/import-products-csv.js products-enrichment.csv --commit --sync-description
//   node scripts/import-products-csv.js products-enrichment.csv --commit --update-names
//
// Safety:
//   * Dry run by default; nothing is written without --commit.
//   * Matches rows by SKU. Unknown SKUs are reported and skipped — never created.
//   * Only the attribute columns are written (merged into the JSONB attributes,
//     so keys you left blank are preserved). Price, category, and is_active are
//     IGNORED — manage those in the admin UI.
//   * The product NAME is only changed with --update-names (SKU stays the key);
//     without that flag the name column is context-only.
//   * --sync-description also copies long_description into the products.description
//     column (what the customer-facing menu shows). Off by default.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../db');
const { ARRAY_ATTRS, SCALAR_ATTRS, META_COLUMNS } = require('./export-products-csv');

const EDITABLE_KEYS = [...SCALAR_ATTRS, ...ARRAY_ATTRS, ...META_COLUMNS];
const MAX_LONG_DESCRIPTION = 2000;

// Minimal RFC-4180 CSV parser (handles quotes, commas, and newlines in fields).
const parseCsv = (text) => {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, '\n');
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

// Normalize the two known product lines so casing/accents/typos land consistently.
// Unknown values pass through unchanged (with a warning) to allow future lines.
const normalizeProductLine = (value) => {
  const key = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (key === 'acero') return 'Acero';
  if (key === 'armonia') return 'Armonia';
  console.warn(`  product_line "${value}" is not Acero/Armonia — kept as-is`);
  return String(value).trim();
};

const buildAttributes = (record) => {
  const attrs = {};
  for (const key of SCALAR_ATTRS) {
    const v = String(record[key] ?? '').trim();
    if (!v) continue;
    if (key === 'long_description') attrs[key] = v.slice(0, MAX_LONG_DESCRIPTION);
    else if (key === 'product_line') attrs[key] = normalizeProductLine(v);
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

const run = async () => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const commit = args.includes('--commit');
  const syncDescription = args.includes('--sync-description');
  const updateNames = args.includes('--update-names');
  if (!file) {
    console.error('Usage: node scripts/import-products-csv.js <file.csv> [--commit] [--sync-description] [--update-names]');
    process.exit(1);
  }

  const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }
  const header = rows[0].map((h) => h.trim());
  const skuIdx = header.indexOf('sku');
  if (skuIdx < 0) {
    console.error('CSV is missing a "sku" column.');
    process.exit(1);
  }

  const existing = await pool.query('SELECT sku FROM products');
  const knownSkus = new Set(existing.rows.map((r) => String(r.sku).toUpperCase()));

  const updates = [];
  const unknown = [];
  const skipped = [];
  for (const cols of rows.slice(1)) {
    const record = {};
    header.forEach((h, i) => { record[h] = cols[i] ?? ''; });
    const sku = String(record.sku || '').trim().toUpperCase();
    if (!sku) continue;
    if (!knownSkus.has(sku)) { unknown.push(sku); continue; }
    const attrs = buildAttributes(record);
    // Renaming is opt-in (--update-names). SKU always stays the key; only the
    // display name changes. Empty name = leave unchanged.
    let name = null;
    if (updateNames) {
      const raw = String(record.name || '').trim();
      if (raw && raw.length <= 120) name = raw;
      else if (raw.length > 120) console.warn(`  ${sku}: name too long (max 120) — skipping rename`);
    }
    if (Object.keys(attrs).length === 0 && !name) { skipped.push(sku); continue; }
    updates.push({ sku, attrs, name });
  }

  console.log(`Parsed ${rows.length - 1} data rows: ${updates.length} to update, ${skipped.length} with no attribute values, ${unknown.length} unknown SKUs.`);
  if (unknown.length) console.log(`  Unknown (skipped): ${unknown.join(', ')}`);

  for (const u of updates) {
    const parts = Object.keys(u.attrs).map((k) => `${k}=${JSON.stringify(u.attrs[k])}`);
    if (u.name) parts.unshift(`name→${JSON.stringify(u.name)}`);
    console.log(`  ${u.sku}: ${parts.join(', ')}`);
  }

  if (!commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      // Merge (||) so blank cells preserve any keys already stored.
      await client.query(
        'UPDATE products SET attributes = attributes || $2::jsonb, last_updated = NOW() WHERE UPPER(sku) = $1',
        [u.sku, JSON.stringify(u.attrs)]
      );
      if (u.name) {
        await client.query(
          'UPDATE products SET name = $2, last_updated = NOW() WHERE UPPER(sku) = $1',
          [u.sku, u.name]
        );
      }
      if (syncDescription && u.attrs.long_description) {
        await client.query(
          'UPDATE products SET description = $2 WHERE UPPER(sku) = $1',
          [u.sku, String(u.attrs.long_description).slice(0, 1000)]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`\nApplied ${updates.length} product updates.${syncDescription ? ' (description synced)' : ''}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

if (require.main === module) {
  run()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
