// Export the live product catalog to a CSV for enrichment.
//
//   node scripts/export-products-csv.js                 -> writes products-enrichment.csv
//   node scripts/export-products-csv.js --out mine.csv  -> custom path
//   node scripts/export-products-csv.js --active-only    -> only is_active = TRUE
//
// The first columns are read-only CONTEXT (sku/name/price/category) so you know
// what you're editing; the import script never changes those. The remaining
// columns are the enrichable attributes, stored in products.attributes (JSONB).
// Fill them in (any spreadsheet works), then run scripts/import-products-csv.js.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../db');

// Column order of the CSV. Keep in sync with import-products-csv.js.
const CONTEXT_COLUMNS = ['sku', 'name', 'menu_category', 'is_active', 'sf_price', 'cf_price'];
const ARRAY_ATTRS = ['works_with', 'compatible_boards'];
const SCALAR_ATTRS = ['product_line', 'color', 'size', 'dimensions', 'material', 'weight', 'load_capacity', 'variant_group', 'long_description'];
// works_with / compatible_boards are arrays serialized as "a; b; c".
const ATTR_COLUMNS = ['product_line', 'color', 'size', 'dimensions', 'material', 'weight', 'load_capacity', 'works_with', 'compatible_boards', 'variant_group', 'long_description'];
const META_COLUMNS = ['status', 'notes'];
const COLUMNS = [...CONTEXT_COLUMNS, ...ATTR_COLUMNS, ...META_COLUMNS];

const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  // RFC-4180 quoting: wrap in quotes if it contains comma, quote, or newline.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const run = async () => {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'products-enrichment.csv';
  const activeOnly = args.includes('--active-only');

  const result = await pool.query(
    `SELECT sku, name, menu_category, is_active, sf_price, cf_price, attributes
     FROM products
     ${activeOnly ? 'WHERE is_active = TRUE' : ''}
     ORDER BY menu_category NULLS LAST, UPPER(name) ASC, UPPER(sku) ASC`
  );

  const lines = [COLUMNS.map(csvCell).join(',')];
  for (const row of result.rows) {
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
    lines.push(COLUMNS.map((c) => csvCell(record[c])).join(','));
  }

  fs.writeFileSync(path.resolve(process.cwd(), outPath), `${lines.join('\n')}\n`, 'utf-8');
  console.log(`Exported ${result.rows.length} products -> ${outPath}`);
};

module.exports = { COLUMNS, CONTEXT_COLUMNS, ATTR_COLUMNS, ARRAY_ATTRS, SCALAR_ATTRS, META_COLUMNS };

// Only run the export when invoked directly — import-products-csv.js requires
// this module purely for the shared column definitions above.
if (require.main === module) {
  run()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
