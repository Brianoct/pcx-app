// Export the live product catalog to a CSV for enrichment.
//
//   node scripts/export-products-csv.js                 -> writes products-enrichment.csv
//   node scripts/export-products-csv.js --out mine.csv  -> custom path
//   node scripts/export-products-csv.js --active-only    -> only is_active = TRUE
//
// The first columns are read-only CONTEXT (sku/name/price/category); the rest are
// the enrichable attributes stored in products.attributes (JSONB). Fill them in,
// then run scripts/import-products-csv.js. The same logic backs the admin
// "Download products CSV" button (routes/catalogAdmin.js) via lib/productEnrichment.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../db');
const { exportProductsCsv } = require('../lib/productEnrichment');

const run = async () => {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'products-enrichment.csv';
  const activeOnly = args.includes('--active-only');

  const { csv, count } = await exportProductsCsv(pool, { activeOnly });
  fs.writeFileSync(path.resolve(process.cwd(), outPath), csv, 'utf-8');
  console.log(`Exported ${count} products -> ${outPath}`);
};

if (require.main === module) {
  run()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
