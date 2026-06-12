// End-to-end quote lifecycle against a running local backend:
// create -> confirm (deducts stock) -> delete (restores stock).
//   node scripts/quote-lifecycle.mjs
// confirm (deducts stock), check stock, delete (restores stock).
const BASE = 'http://localhost:4000';

const req = async (method, path, token, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
};

const fail = (msg) => { console.log('FAIL', msg); process.exit(1); };

const { json: login } = await req('POST', '/api/login', null, { email: 'ventas@test.com', password: 'admin123' });
const token = login.token;
const { json: adminL } = await req('POST', '/api/login', null, { email: 'admin@test.com', password: 'admin123' });
const adminToken = adminL.token;

const { json: products } = await req('GET', '/api/products', adminToken);
const prod = products.find((p) => Number(p.stock_scz ?? p.stock ?? 0) > 2) || products[0];
if (!prod) fail('no products');
const sku = prod.sku;
console.log('using product', sku);

const stockBefore = await req('GET', `/api/stock?sku=${sku}&store_location=${encodeURIComponent('Santa Cruz')}`, token);
console.log('stock before:', stockBefore.status, JSON.stringify(stockBefore.json).slice(0, 120));

const create = await req('POST', '/api/quotes', token, {
  customer_name: 'Lifecycle Test',
  customer_phone: '70000002',
  department: 'Santa Cruz',
  store_location: 'Santa Cruz',
  venta_type: 'sf',
  rows: [{ sku, qty: 1, unitPrice: 100, lineTotal: 100 }],
  subtotal: 100,
  total: 100
});
if (create.status !== 201 && create.status !== 200) fail(`create quote: ${create.status} ${JSON.stringify(create.json).slice(0, 200)}`);
const quoteId = create.json?.id || create.json?.quote?.id;
console.log('created quote', quoteId, 'status', create.status);

const confirm = await req('PATCH', `/api/quotes/${quoteId}/status`, token, { status: 'Confirmado' });
if (confirm.status !== 200) fail(`confirm: ${confirm.status} ${JSON.stringify(confirm.json).slice(0, 200)}`);
console.log('confirmed quote (stock deducted)');

const stockAfter = await req('GET', `/api/stock?sku=${sku}&store_location=${encodeURIComponent('Santa Cruz')}`, token);
console.log('stock after confirm:', JSON.stringify(stockAfter.json).slice(0, 120));

const del = await req('DELETE', `/api/quotes/${quoteId}`, adminToken);
if (del.status !== 200) fail(`delete: ${del.status} ${JSON.stringify(del.json).slice(0, 200)}`);
console.log('deleted quote (stock restored)');

const stockFinal = await req('GET', `/api/stock?sku=${sku}&store_location=${encodeURIComponent('Santa Cruz')}`, token);
console.log('stock final:', JSON.stringify(stockFinal.json).slice(0, 120));

const same = JSON.stringify(stockFinal.json) === JSON.stringify(stockBefore.json);
console.log(same ? 'PASS stock restored to original' : 'WARN stock differs from original');
console.log('LIFECYCLE COMPLETE');
