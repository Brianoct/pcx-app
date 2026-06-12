const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBusinessDaysInclusive,
  normalizeTimeOffStatus,
  normalizeTimeOffType
} = require('../lib/timeoff');

test('computeBusinessDaysInclusive skips weekends', () => {
  // Mon 2026-06-08 .. Fri 2026-06-12 = 5 business days
  assert.equal(computeBusinessDaysInclusive('2026-06-08', '2026-06-12'), 5);
  // Fri .. Mon spans a weekend = 2 business days
  assert.equal(computeBusinessDaysInclusive('2026-06-12', '2026-06-15'), 2);
  // Sat .. Sun = 0
  assert.equal(computeBusinessDaysInclusive('2026-06-13', '2026-06-14'), 0);
  // invalid input
  assert.equal(computeBusinessDaysInclusive('garbage', '2026-06-14'), 0);
});

test('normalizeTimeOffType accepts spanish aliases', () => {
  assert.equal(normalizeTimeOffType('vacation'), 'vacation');
  assert.equal(normalizeTimeOffType('VACACIONES'), 'vacation');
  assert.equal(normalizeTimeOffType('nonsense'), null);
});

test('normalizeTimeOffStatus maps labels', () => {
  assert.equal(normalizeTimeOffStatus('approved'), 'approved');
  assert.equal(normalizeTimeOffStatus('aprobado'), 'approved');
  assert.equal(normalizeTimeOffStatus('whatever'), null);
});
