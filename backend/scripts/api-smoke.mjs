// Local API smoke battery. Requires a running backend (node index.js) against
// a dev database seeded with users admin@test.com / ventas@test.com (password
// admin123). Records method/path/status/shape per endpoint.
//
//   node scripts/api-smoke.mjs /tmp/baseline.json            # capture baseline
//   node scripts/api-smoke.mjs /tmp/after.json /tmp/baseline.json  # diff
// Usage: node api_smoke.mjs <output.json> [baseline.json]
import fs from 'fs';

const BASE = 'http://localhost:4000';
const [outFile, baselineFile] = process.argv.slice(2);

const req = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
};

const login = async (email) => {
  const { status, json } = await req('POST', '/api/login', { body: { email, password: 'admin123' } });
  if (status !== 200) throw new Error(`login ${email} failed: ${status}`);
  return json.token;
};

const admin = await login('admin@test.com');
const ventas = await login('ventas@test.com');

const battery = [
  // auth/profile
  ['GET', '/api/me', admin],
  ['GET', '/api/me', ventas],
  ['GET', '/api/sellers/assignable', admin],
  ['GET', '/api/users/sales', admin],
  // admin users / roles / commission settings
  ['GET', '/api/users', admin],
  ['GET', '/api/users', ventas],          // expect 403
  ['GET', '/api/role-access-defaults', admin],
  ['GET', '/api/roles/access-defaults', admin],
  ['GET', '/api/commission/settings', admin],
  // quotes
  ['GET', '/api/quotes', admin],
  ['GET', '/api/quotes', ventas],
  // time off (canonical paths + legacy aliases)
  ['GET', '/api/time-off/mine', ventas],
  ['GET', '/api/time-off/mine/summary', ventas],
  ['GET', '/api/time-off/requests', admin],
  ['GET', '/api/time-off/summary', admin],
  ['GET', '/api/timeoff/requests', admin],
  ['GET', '/api/timeoff/summary', admin],
  // projects / expenses
  ['GET', '/api/projects/users', admin],
  ['GET', '/api/projects/dashboard', admin],
  ['GET', '/api/expenses', admin],
  ['GET', '/api/expenses/variance', admin],
  // stock / products / catalog
  ['GET', '/api/stock', admin],
  ['GET', '/api/products', admin],
  ['GET', '/api/product-catalog', admin],
  ['GET', '/api/product-costing', admin],
  ['GET', '/api/admin/product-production/options', admin],
  ['GET', '/api/admin/equipos', admin],
  ['GET', '/api/admin/materiales', admin],
  // marketing
  ['GET', '/api/combos', admin],
  ['GET', '/api/cupones', admin],
  // performance
  ['GET', '/api/performance', admin],
  ['GET', '/api/commission/current?month=6&year=2026', ventas],
  ['GET', '/api/commission/current/orders?month=6&year=2026', ventas],
  // production
  ['GET', '/api/production/kanban', admin],
  // qc / microfabrica
  ['GET', '/api/qc/products', admin],
  ['GET', '/api/qc/checks', admin],
  ['GET', '/api/qc/summary', admin],
  ['GET', '/api/qc/commissions', admin],
  ['GET', '/api/microfabrica/dashboard', admin],
  // admin stats
  ['GET', '/api/admin/stats?month=6&year=2026', admin],
  // whatsapp inbox
  ['GET', '/api/whatsapp/inbox/conversations', admin],
  ['GET', '/api/whatsapp/inbox/shortcuts', admin],
  ['GET', '/api/whatsapp/inbox/kpis', admin],
  ['GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y', null],
  // customer menu
  ['GET', '/api/customer-menu/images', admin],
  ['GET', '/api/public/menu/invalid-token', null], // expect 4xx not 5xx
  // auth guards
  ['GET', '/api/quotes', null],            // expect 401
  ['GET', '/api/users', null],             // expect 401
  // writes (safe, reversible)
  ['POST', '/api/cupones', admin, { code: 'SMOKE10', discount_percent: 10, valid_until: '2027-01-01' }],
  ['GET', '/api/cupones', admin],
  ['POST', '/api/quotes', ventas, {
    customer_name: 'Smoke Test', customer_phone: '70000001', department: 'Santa Cruz',
    almacen: 'Santa Cruz', venta_type: 'sf', items: [], total: 0, subtotal: 0
  }],
  // centralized calendar
  ['GET', '/api/calendar/types', ventas],
  ['GET', '/api/calendar/events', ventas],
  ['GET', '/api/calendar/summary?year=2026', ventas],
];

const results = [];
for (const [method, path, token, body] of battery) {
  try {
    const { status, json } = await req(method, path, { token, body });
    const shape = json == null ? 'none' : Array.isArray(json) ? 'array' : typeof json;
    results.push({ method, path: path.split('?')[0], status, shape });
  } catch (err) {
    results.push({ method, path: path.split('?')[0], status: 'ERR', shape: String(err.message).slice(0, 60) });
  }
}

fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`${results.length} checks written to ${outFile}`);

if (baselineFile) {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
  let diffs = 0;
  for (let i = 0; i < baseline.length; i++) {
    const a = baseline[i];
    const b = results[i];
    if (!b || a.method !== b.method || a.path !== b.path || a.status !== b.status || a.shape !== b.shape) {
      console.log(`DIFF: ${a.method} ${a.path} baseline=${a.status}/${a.shape} now=${b?.status}/${b?.shape}`);
      diffs++;
    }
  }
  console.log(diffs === 0 ? 'MATCHES BASELINE' : `${diffs} DIFFERENCES`);
  process.exit(diffs === 0 ? 0 : 1);
}
