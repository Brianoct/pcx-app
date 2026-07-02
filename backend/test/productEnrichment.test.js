const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLUMNS, toCsv, parseCsv, splitArrayCell, normalizeProductLine, buildAttributes, planImport, flattenProductRow
} = require('../lib/productEnrichment');

test('toCsv emits header + quoted rows and flattens attributes/arrays', () => {
  const csv = toCsv([
    { sku: 'D40N', name: 'Porta Desarmador, Grande', menu_category: 'Accesorios', is_active: true, sf_price: 70, cf_price: 82,
      attributes: { product_line: 'Acero', color: 'Negro', capacidad: '10 desarmadores', presentacion: 'Unidad', unidades_por_lote: '1', works_with: ['Desarmadores'], compatible: ['T6195N', 'T9495N'], long_description: 'Line1\nLine2' } }
  ]);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], COLUMNS);
  const rec = {};
  rows[0].forEach((h, i) => { rec[h] = rows[1][i]; });
  assert.equal(rec.name, 'Porta Desarmador, Grande');   // comma survived quoting
  assert.equal(rec.capacidad, '10 desarmadores');
  assert.equal(rec.presentacion, 'Unidad');
  assert.equal(rec.compatible, 'T6195N; T9495N');       // array joined
  assert.equal(rec.long_description, 'Line1\nLine2');   // newline survived quoting
});

test('splitArrayCell handles semicolons, newlines, and comma-only fallback', () => {
  assert.deepEqual(splitArrayCell('a; b ;c'), ['a', 'b', 'c']);
  assert.deepEqual(splitArrayCell('T4764B\nT4764N\nT6464B '), ['T4764B', 'T4764N', 'T6464B']);
  assert.deepEqual(splitArrayCell('colgar tazas, sostener alicates, colgar tijeras'), ['colgar tazas', 'sostener alicates', 'colgar tijeras']);
  // semicolons win: commas inside items survive
  assert.deepEqual(splitArrayCell('Llaves (boca, corona); Alicates'), ['Llaves (boca, corona)', 'Alicates']);
  assert.deepEqual(splitArrayCell('  '), []);
});

test('normalizeProductLine canonicalizes casing and accents', () => {
  assert.equal(normalizeProductLine('acero'), 'Acero');
  assert.equal(normalizeProductLine('ARMONÍA'), 'Armonia');
  const warnings = [];
  assert.equal(normalizeProductLine('Otro', warnings), 'Otro');
  assert.equal(warnings.length, 1);
});

test('buildAttributes maps scalars/arrays/meta, uppercases compatible, validates lote', () => {
  const warnings = [];
  const attrs = buildAttributes({
    product_line: 'armonia', color: 'Negro', capacidad: '8 llaves', unidades_por_lote: '6', presentacion: 'Media docena',
    works_with: 'Martillos; Mazos', compatible: 't4764b\nT4764N', status: 'VERIFIED'
  }, warnings, 'X1');
  assert.equal(attrs.product_line, 'Armonia');
  assert.equal(attrs.capacidad, '8 llaves');
  assert.deepEqual(attrs.compatible, ['T4764B', 'T4764N']); // newline split + uppercased
  assert.deepEqual(attrs.works_with, ['Martillos', 'Mazos']);
  assert.equal(warnings.length, 0);
  buildAttributes({ unidades_por_lote: 'media' }, warnings, 'X2');
  assert.ok(warnings.some((w) => w.includes('X2') && w.includes('unidades_por_lote')));
});

test('planImport accepts legacy/renamed headers via aliases', () => {
  const csv = 'sku,menu_category,compatible_boards\nR40N,Accesorios,"T6195N; T9495N"\n';
  const plan = planImport(csv, ['R40N', 'T6195N', 'T9495N']);
  assert.deepEqual(plan.updates[0].attrs.compatible, ['T6195N', 'T9495N']);
});

test('planImport flags duplicates (first wins), empty SKUs, unknown refs', () => {
  const csv = [
    'sku,name,compatible',
    'T1099N,Tablero 10x99 Negro,',
    'T1099N,Tablero 94x95 Rojo,',        // duplicate — must not win
    ',Tablero 94x95 Plomo,',             // empty sku
    'R40N,Repisa,"T6195N; GHOST1"'       // ghost compatible ref
  ].join('\n');
  const plan = planImport(csv, ['T1099N', 'R40N', 'T6195N'], { updateNames: true });
  assert.deepEqual(plan.duplicates, ['T1099N']);
  assert.equal(plan.updates.find((u) => u.sku === 'T1099N').name, 'Tablero 10x99 Negro');
  assert.ok(plan.warnings.some((w) => w.includes('Fila sin SKU') && w.includes('Plomo')));
  assert.ok(plan.warnings.some((w) => w.includes('GHOST1')));
});

test('planImport warns on asymmetric compatibility', () => {
  const csv = [
    'sku,compatible',
    'T6195N,"D22N"',
    'D22N,""'                            // D22N has no list → not comparable, no warning
  ].join('\n');
  const plan1 = planImport(csv, ['T6195N', 'D22N']);
  assert.ok(!plan1.warnings.some((w) => w.includes('asimétrica')));

  const csv2 = [
    'sku,compatible',
    'T6195N,"D22N"',
    'D22N,"T9495N"'                      // both have lists; D22N omits T6195N
  ].join('\n');
  const plan2 = planImport(csv2, ['T6195N', 'D22N', 'T9495N']);
  assert.ok(plan2.warnings.some((w) => w.includes('asimétrica') && w.includes('D22N')));
});

test('planImport applies rename only with updateNames', () => {
  const csv = 'sku,name\nR40N,Nuevo Nombre\n';
  assert.equal(planImport(csv, ['R40N'], { updateNames: false }).updates.length, 0);
  assert.equal(planImport(csv, ['R40N'], { updateNames: true }).updates[0].name, 'Nuevo Nombre');
});

test('flattenProductRow tolerates null attributes', () => {
  const rec = flattenProductRow({ sku: 'X', name: 'Y', attributes: null });
  assert.equal(rec.capacidad, '');
  assert.equal(rec.compatible, '');
});
