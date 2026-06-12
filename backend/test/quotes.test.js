const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuotePaymentMethod, QUOTE_STATUSES } = require('../lib/quotes');
const { parseBooleanLike } = require('../lib/util');

test('normalizeQuotePaymentMethod accepts known methods case-insensitively', () => {
  assert.equal(normalizeQuotePaymentMethod('qr'), 'QR');
  assert.equal(normalizeQuotePaymentMethod('EFECTIVO'), 'Efectivo');
  assert.equal(normalizeQuotePaymentMethod('mixto'), 'Mixto');
});

test('normalizeQuotePaymentMethod rejects unknown values', () => {
  assert.equal(normalizeQuotePaymentMethod('bitcoin'), null);
});

test('quote status list keeps its workflow order', () => {
  assert.deepEqual(QUOTE_STATUSES, ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado']);
});

test('parseBooleanLike coerces common representations', () => {
  assert.equal(parseBooleanLike(true), true);
  assert.equal(parseBooleanLike('true'), true);
  assert.equal(parseBooleanLike('0'), false);
  assert.equal(parseBooleanLike(undefined, true), true);
});
