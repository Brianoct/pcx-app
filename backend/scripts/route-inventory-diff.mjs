// Verifies the mounted Express routes match the inventory parsed from the
// pre-split index.js (see /tmp/routes_map.txt format: "<line> <method> <path>").
//   node scripts/route-inventory-diff.mjs
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/workspace/backend/index.js');

const routerFiles = ['whatsapp', 'auth', 'customerMenu', 'quotes', 'timeoff', 'projects',
  'expenses', 'stock', 'marketing', 'adminUsers', 'performance', 'catalogAdmin',
  'production', 'adminStats', 'qc', 'profile'];

const mounted = new Set();
for (const name of routerFiles) {
  const router = require(`/workspace/backend/routes/${name}.js`);
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods || {});
    for (const m of methods) {
      mounted.add(`${m} ${layer.route.path}`);
    }
  }
}

const expected = new Set(
  fs.readFileSync('/tmp/routes_map.txt', 'utf-8').trim().split('\n').map((l) => {
    const parts = l.split(' ');
    // lines look like "6295 post /api/register" or "4944:app.post(" (multiline route)
    if (parts.length >= 3 && parts[1].match(/^(get|post|patch|put|delete)$/)) {
      return `${parts[1]} ${parts[2]}`;
    }
    return null;
  }).filter(Boolean)
);
// the one multiline route parsed manually:
expected.add('post /api/whatsapp/inbox/media/upload');

const missing = [...expected].filter((r) => !mounted.has(r));
const extra = [...mounted].filter((r) => !expected.has(r));
console.log(`expected=${expected.size} mounted=${mounted.size}`);
if (missing.length) console.log('MISSING:', missing);
if (extra.length) console.log('EXTRA:', extra);
console.log(missing.length === 0 && extra.length === 0 ? 'ROUTE SETS IDENTICAL' : 'ROUTE MISMATCH');
process.exit(missing.length || extra.length ? 1 : 0);
