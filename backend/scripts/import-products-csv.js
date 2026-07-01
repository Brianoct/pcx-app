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
//   * The product NAME is only changed with --update-names (SKU stays the key).
//   * --sync-description also copies long_description into products.description.
//
// Shared with the admin "Import products CSV" button via lib/productEnrichment.

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../db');
const { importProductsCsv } = require('../lib/productEnrichment');

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
  const result = await importProductsCsv(pool, { text, commit, updateNames, syncDescription });

  console.log(`${result.updates.length} to update, ${result.skipped.length} with no attribute values, ${result.unknown.length} unknown SKUs.`);
  if (result.unknown.length) console.log(`  Unknown (skipped): ${result.unknown.join(', ')}`);
  for (const u of result.updates) {
    const parts = Object.keys(u.attrs).map((k) => `${k}=${JSON.stringify(u.attrs[k])}`);
    if (u.name) parts.unshift(`name→${JSON.stringify(u.name)}`);
    console.log(`  ${u.sku}: ${parts.join(', ')}`);
  }
  for (const w of result.warnings) console.log(`  ! ${w}`);

  if (!result.applied) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
  } else {
    console.log(`\nApplied ${result.updates.length} product updates.${syncDescription ? ' (description synced)' : ''}`);
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
