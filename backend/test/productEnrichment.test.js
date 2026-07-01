const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLUMNS, toCsv, parseCsv, normalizeProductLine, buildAttributes, planImport, flattenProductRow
} = require('../lib/productEnrichment');

test('toCsv emits header + quoted rows and flattens attributes/arrays', () => {
  const csv = toCsv([
    { sku: 'D40N', name: 'Desarmador, Grande', menu_category: 'Accesorios', is_active: true, sf_price: 70, cf_price: 82,
      attributes: { product_line: 'Acero', color: 'Negro', works_with: ['Desarmadores', 'Llaves'], long_description: 'Line1\nLine2' } }
  ]);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], COLUMNS);
  const rec = {};
  rows[0].forEach((h, i) => { rec[h] = rows[1][i]; });
  assert.equal(rec.name, 'Desarmador, Grande');       // comma survived quoting
  assert.equal(rec.product_line, 'Acero');
  assert.equal(rec.works_with, 'Desarmadores; Llaves'); // array joined
  assert.equal(rec.long_description, 'Line1\nLine2');   // newline survived quoting
});

test('normalizeProductLine canonicalizes casing and accents', () => {
  assert.equal(normalizeProductLine('acero'), 'Acero');
  assert.equal(normalizeProductLine('ARMONÍA'), 'Armonia');
  assert.equal(normalizeProductLine('  Armonia '), 'Armonia');
  const warnings = [];
  assert.equal(normalizeProductLine('Otro', warnings), 'Otro');
  assert.equal(warnings.length, 1);
});

test('buildAttributes maps scalars, arrays, meta and skips blanks', () => {
  const attrs = buildAttributes({
    product_line: 'armonia', color: 'Negro', size: '', works_with: 'Martillos; ; Clavos', notes: 'check', status: 'VERIFIED'
  });
  assert.equal(attrs.product_line, 'Armonia');
  assert.equal(attrs.color, 'Negro');
  assert.ok(!('size' in attrs));                         // blank skipped
  assert.deepEqual(attrs.works_with, ['Martillos', 'Clavos']); // empty segment dropped
  assert.equal(attrs.status, 'VERIFIED');
});

test('planImport separates updates, unknown SKUs, and no-op rows', () => {
  const csv = toCsv([
    { sku: 'R40N', name: 'Repisa', menu_category: 'Accesorios', is_active: true, sf_price: 85, cf_price: 99, attributes: { color: 'Negro' } },
    { sku: 'BLANKROW', name: 'Nothing', menu_category: '', is_active: true, sf_price: 0, cf_price: 0, attributes: {} },
    { sku: 'GHOST', name: 'Not in db', menu_category: '', is_active: true, sf_price: 0, cf_price: 0, attributes: { color: 'X' } }
  ]);
  const plan = planImport(csv, ['R40N', 'BLANKROW'], { updateNames: false });
  assert.deepEqual(plan.updates.map((u) => u.sku), ['R40N']);
  assert.deepEqual(plan.unknown, ['GHOST']);
  assert.deepEqual(plan.skipped, ['BLANKROW']);
});

test('planImport applies rename only with updateNames', () => {
  const row = { sku: 'R40N', name: 'Nuevo Nombre', menu_category: '', is_active: true, sf_price: 0, cf_price: 0, attributes: {} };
  const csv = toCsv([row]);
  assert.equal(planImport(csv, ['R40N'], { updateNames: false }).updates.length, 0); // name-only, ignored
  const withNames = planImport(csv, ['R40N'], { updateNames: true });
  assert.equal(withNames.updates[0].name, 'Nuevo Nombre');
});

test('flattenProductRow tolerates null attributes', () => {
  const rec = flattenProductRow({ sku: 'X', name: 'Y', attributes: null });
  assert.equal(rec.product_line, '');
  assert.equal(rec.works_with, '');
});
