const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tokenize,
  scoreCatalogCandidates,
  safeParseJsonObject,
  attachCatalogToSuggestion,
  buildFallbackSuggestion
} = require('../lib/salesAssistant');

const CATALOG = [
  { sku: 'T6195R', name: 'Tablero 61x95 Rojo', sf: 330, cf: 383, menu_category: 'tableros' },
  { sku: 'T6195A', name: 'Tablero 61x95 Azul', sf: 330, cf: 383, menu_category: 'tableros' },
  { sku: 'ESC120', name: 'Escalera 120cm', sf: 500, cf: 560, menu_category: 'escaleras' },
  { sku: 'MES80', name: 'Mesa plegable 80', sf: 700, cf: 760, menu_category: 'mesas' }
];

test('tokenize strips stopwords, accents and short tokens', () => {
  const tokens = tokenize('Hola, quiero un Tablero rojo de 61x95');
  assert.ok(tokens.includes('tablero'));
  assert.ok(tokens.includes('rojo'));
  assert.ok(!tokens.includes('de'));
  assert.ok(!tokens.includes('un'));
  assert.ok(!tokens.includes('hola'));
});

test('scoreCatalogCandidates ranks by keyword overlap', () => {
  const ranked = scoreCatalogCandidates('quiero un tablero rojo', CATALOG, 10);
  assert.equal(ranked[0].sku, 'T6195R');
  assert.ok(ranked.some((r) => r.sku === 'T6195A'));
});

test('scoreCatalogCandidates boosts exact sku mention', () => {
  const ranked = scoreCatalogCandidates('me interesa el ESC120 por favor', CATALOG, 10);
  assert.equal(ranked[0].sku, 'ESC120');
});

test('scoreCatalogCandidates falls back to slice when nothing matches', () => {
  const ranked = scoreCatalogCandidates('zzz qqq', CATALOG, 2);
  assert.equal(ranked.length, 2);
});

test('safeParseJsonObject handles code fences and surrounding text', () => {
  const parsed = safeParseJsonObject('```json\n{"reply_draft":"hola"}\n```');
  assert.equal(parsed.reply_draft, 'hola');
  assert.equal(safeParseJsonObject('no json here'), null);
  assert.equal(safeParseJsonObject(''), null);
});

test('attachCatalogToSuggestion uses authoritative prices and drops unknown skus', () => {
  const bySku = new Map(CATALOG.map((c) => [c.sku, c]));
  const result = attachCatalogToSuggestion({
    reply_draft: 'Hola',
    suggested_skus: [{ sku: 't6195r', reason: 'pidió rojo' }, { sku: 'FAKE', reason: 'x' }],
    quote_rows: [{ sku: 'T6195R', qty: 2 }, { sku: 'NOPE', qty: 5 }],
    notes: 'nota'
  }, bySku);

  assert.equal(result.suggested_products.length, 1);
  assert.equal(result.suggested_products[0].sku, 'T6195R');
  assert.equal(result.quote_draft.rows.length, 1);
  assert.equal(result.quote_draft.rows[0].unitPrice, 330);
  assert.equal(result.quote_draft.rows[0].qty, 2);
  assert.equal(result.quote_draft.rows[0].lineTotal, 660);
});

test('attachCatalogToSuggestion extracts customer_name and destination', () => {
  const bySku = new Map(CATALOG.map((c) => [c.sku, c]));
  const result = attachCatalogToSuggestion({
    reply_draft: 'Hola',
    customer_name: 'Pedro Rojas',
    destination: 'Sucre',
    quote_rows: [{ sku: 'T6195R', qty: 1 }]
  }, bySku);
  assert.equal(result.quote_draft.customer_name, 'Pedro Rojas');
  assert.equal(result.quote_draft.destination, 'Sucre');
});

test('attachCatalogToSuggestion defaults invalid qty to 1', () => {
  const bySku = new Map(CATALOG.map((c) => [c.sku, c]));
  const result = attachCatalogToSuggestion({
    quote_rows: [{ sku: 'MES80', qty: -3 }, { sku: 'ESC120' }]
  }, bySku);
  assert.equal(result.quote_draft.rows[0].qty, 1);
  assert.equal(result.quote_draft.rows[1].qty, 1);
});

test('buildFallbackSuggestion produces reply, products and quote rows', () => {
  const candidates = scoreCatalogCandidates('quiero un tablero', CATALOG, 10);
  const fb = buildFallbackSuggestion({ contactName: 'Ana', candidates });
  assert.ok(fb.reply_draft.includes('Ana'));
  assert.ok(fb.suggested_products.length > 0);
  assert.ok(fb.quote_draft.rows.length > 0);
  assert.equal(fb.quote_draft.rows[0].qty, 1);
});

test('buildFallbackSuggestion handles empty candidates gracefully', () => {
  const fb = buildFallbackSuggestion({ contactName: '', candidates: [] });
  assert.equal(fb.suggested_products.length, 0);
  assert.equal(fb.quote_draft.rows.length, 0);
  assert.ok(fb.reply_draft.length > 0);
});
