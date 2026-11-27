const test = require('node:test');
const assert = require('node:assert');
const { applyComboColorChoices, sameVariantGroup, splitColor } = require('../lib/productVariants');

const P = (sku, name, extra = {}) => ({ sku, name, product_type: 'tablero', attributes: {}, ...extra });
const products = new Map([
  P('T6195N', 'Tablero 61x95 Negro'), P('T6195R', 'Tablero 61x95 Rojo'), P('T6195AP', 'Tablero 61x95 Azul Petróleo'),
  P('T9495N', 'Tablero 94x95 Negro'), P('G10C', 'Gancho 10cm Cromo', { product_type: 'accesorio' }),
  P('M08N', 'Martillo Negro', { product_type: 'accesorio' })
].map((p) => [p.sku, p]));

test('separa el color del nombre', () => {
  assert.deepStrictEqual(splitColor('Tablero 61x95 Azul Petróleo'), { base: 'tablero 61x95', color: 'azul petroleo' });
  assert.deepStrictEqual(splitColor('Repisa/Rollo'), { base: 'repisa/rollo', color: '' });
});

test('variantes: mismo producto en otro color, no otro tamaño ni otro producto', () => {
  assert.ok(sameVariantGroup(products.get('T6195N'), products.get('T6195R')));
  assert.ok(sameVariantGroup(products.get('T6195N'), products.get('T6195AP')));
  assert.ok(!sameVariantGroup(products.get('T6195N'), products.get('T9495N')));
  assert.ok(!sameVariantGroup(products.get('G10C'), products.get('M08N')));
});

test('variant_group manda sobre el nombre', () => {
  const a = P('X1', 'Bandeja A', { attributes: { variant_group: 'Bandeja Grande' } });
  const b = P('X2', 'Otra cosa', { attributes: { variant_group: 'bandeja grande' } });
  assert.ok(sameVariantGroup(a, b));
});

test('acepta el combo con otros colores', () => {
  const configured = [{ sku: 'T6195N', quantity: 1 }, { sku: 'G10C', quantity: 4 }];
  assert.deepStrictEqual(
    applyComboColorChoices(configured, [{ sku: 'G10C', quantity: 4 }, { sku: 'T6195R', quantity: 1 }], products),
    [{ sku: 'T6195R', quantity: 1 }, { sku: 'G10C', quantity: 4 }]
  );
});

test('rechaza cambios que no son de color', () => {
  const configured = [{ sku: 'T6195N', quantity: 1 }, { sku: 'G10C', quantity: 4 }];
  for (const chosen of [
    [{ sku: 'T9495N', quantity: 1 }, { sku: 'G10C', quantity: 4 }],   // otro tamaño
    [{ sku: 'T6195R', quantity: 2 }, { sku: 'G10C', quantity: 4 }],   // otra cantidad
    [{ sku: 'T6195R', quantity: 1 }],                                  // falta un componente
    [{ sku: 'T6195R', quantity: 1 }, { sku: 'M08N', quantity: 4 }]    // otro producto
  ]) assert.deepStrictEqual(applyComboColorChoices(configured, chosen, products), configured);
});
