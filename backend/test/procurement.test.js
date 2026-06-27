const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUEST_STATUSES,
  buildPurchaseRequestRow,
  normalizeRequestPriority,
  normalizeRequestStatus,
  parsePositiveQuantity
} = require('../lib/procurement');

test('normalizeRequestStatus accepts english/spanish aliases', () => {
  assert.equal(normalizeRequestStatus('pending'), 'pending');
  assert.equal(normalizeRequestStatus('Por comprar'), 'pending');
  assert.equal(normalizeRequestStatus('comprado'), 'purchased');
  assert.equal(normalizeRequestStatus('recibido'), 'received');
  assert.equal(normalizeRequestStatus('cancelado'), 'cancelled');
  assert.equal(normalizeRequestStatus('nope'), null);
});

test('normalizeRequestPriority maps labels and defaults', () => {
  assert.equal(normalizeRequestPriority('urgente'), 'urgent');
  assert.equal(normalizeRequestPriority('Normal'), 'normal');
  assert.equal(normalizeRequestPriority('baja'), 'low');
  assert.equal(normalizeRequestPriority('???'), null);
});

test('parsePositiveQuantity requires a positive number', () => {
  assert.equal(parsePositiveQuantity('5'), 5);
  assert.equal(parsePositiveQuantity(2.005), 2.01);
  assert.equal(parsePositiveQuantity(0), null);
  assert.equal(parsePositiveQuantity(-3), null);
  assert.equal(parsePositiveQuantity('abc'), null);
});

test('buildPurchaseRequestRow normalizes and labels a row', () => {
  const row = buildPurchaseRequestRow({
    id: '7', material_id: '3', material_code: 'mat-1', material_name: ' Acero ',
    quantity: '10', scan_count: '2', status: 'pending', priority: 'urgent', supplier: ' ACME '
  });
  assert.equal(row.id, 7);
  assert.equal(row.material_code, 'MAT-1');
  assert.equal(row.material_name, 'Acero');
  assert.equal(row.quantity, 10);
  assert.equal(row.status_label, 'Por comprar');
  assert.equal(row.priority_label, 'Urgente');
  assert.equal(row.supplier, 'ACME');
});

test('REQUEST_STATUSES contains the four lifecycle states', () => {
  assert.deepEqual([...REQUEST_STATUSES].sort(), ['cancelled', 'pending', 'purchased', 'received']);
});
