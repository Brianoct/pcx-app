import { describe, expect, it } from 'vitest';
import { parsePickerQuery, searchProducts } from './quotePickerSearch';

const ITEMS = [
  { sku: 'T6195N', displayName: 'Tablero 61x95 Negro', product_type: 'tablero', product_line: 'acero' },
  { sku: 'T9495R', displayName: 'Tablero 94x95 Rojo', product_type: 'tablero', product_line: 'acero' },
  { sku: 'T9495N', displayName: 'Tablero 94x95 Negro', product_type: 'tablero', product_line: 'acero' },
  { sku: 'G05C', displayName: 'Gancho 5cm Cromo', product_type: 'accesorio', product_line: 'acero' },
  { sku: 'G10C', displayName: 'Gancho 10cm Cromo', product_type: 'accesorio', product_line: 'acero' },
  { sku: 'R40N', displayName: 'Repisa Grande Negro', product_type: 'accesorio', product_line: 'armonia' },
  { sku: 'COMBO_3', displayName: 'Kit Taller (Combo)', isCombo: true, product_line: 'acero' }
];
const skus = (result) => result.list.map((item) => item.sku);

describe('parsePickerQuery', () => {
  it('lee la cantidad antes o después del texto', () => {
    expect(parsePickerQuery('3x gancho')).toEqual({ term: 'gancho', qty: 3 });
    expect(parsePickerQuery('3 x gancho')).toEqual({ term: 'gancho', qty: 3 });
    expect(parsePickerQuery('gancho x3')).toEqual({ term: 'gancho', qty: 3 });
    expect(parsePickerQuery('gancho x 12')).toEqual({ term: 'gancho', qty: 12 });
    expect(parsePickerQuery('g10c*4')).toEqual({ term: 'g10c', qty: 4 });
  });

  it('no confunde una medida con una cantidad', () => {
    expect(parsePickerQuery('61x95')).toEqual({ term: '61x95', qty: 1 });
    expect(parsePickerQuery('tablero 94x95 rojo')).toEqual({ term: 'tablero 94x95 rojo', qty: 1 });
    expect(parsePickerQuery('  gancho  ')).toEqual({ term: 'gancho', qty: 1 });
  });

  it('acota la cantidad a un rango razonable', () => {
    expect(parsePickerQuery('gancho x0').qty).toBe(1);
    expect(parsePickerQuery('9999x gancho').qty).toBe(9999);
  });
});

describe('searchProducts', () => {
  it('sin texto devuelve todo en el orden del catálogo', () => {
    expect(skus(searchProducts(ITEMS, ''))).toEqual(ITEMS.map((item) => item.sku));
  });

  it('el código exacto o su comienzo va primero', () => {
    expect(skus(searchProducts(ITEMS, 'g10c'))[0]).toBe('G10C');
    // «g» también aparece dentro de «Negro» o «Grande», pero los códigos que
    // empiezan con G van primero.
    expect(skus(searchProducts(ITEMS, 'g')).slice(0, 2)).toEqual(['G05C', 'G10C']);
  });

  it('cada palabra debe coincidir, sin importar acentos ni mayúsculas', () => {
    expect(skus(searchProducts(ITEMS, '94 ROJO'))).toEqual(['T9495R']);
    expect(skus(searchProducts(ITEMS, 'tablero negro'))).toEqual(['T6195N', 'T9495N']);
    expect(skus(searchProducts(ITEMS, 'repisá'))).toEqual(['R40N']);
    expect(skus(searchProducts(ITEMS, 'zzz'))).toEqual([]);
  });

  it('a igual coincidencia gana lo que el vendedor cotiza más', () => {
    const popularity = new Map([['T9495N', 0], ['T6195N', 1]]);
    expect(skus(searchProducts(ITEMS, 'tablero negro', { popularity }))).toEqual(['T9495N', 'T6195N']);
  });

  it('entrega la cantidad escrita y busca solo el resto', () => {
    const result = searchProducts(ITEMS, 'gancho 10 x3');
    expect(skus(result)).toEqual(['G10C']);
    expect(result.qty).toBe(3);
  });

  it('una medida del catálogo nunca se lee como cantidad', () => {
    for (const query of ['tablero 61 x95', '61 x 95', '61x95']) {
      const result = searchProducts(ITEMS, query);
      expect(skus(result)).toEqual(['T6195N']);
      expect(result.qty).toBe(1);
    }
  });

  it('sin resultados la cantidad vuelve a 1', () => {
    expect(searchProducts(ITEMS, 'zzz x5')).toMatchObject({ list: [], qty: 1 });
  });

  it('filtra por tipo y por línea', () => {
    expect(skus(searchProducts(ITEMS, '', { typeFilter: 'tablero' }))).toEqual(['T6195N', 'T9495R', 'T9495N']);
    expect(skus(searchProducts(ITEMS, '', { typeFilter: 'combo' }))).toEqual(['COMBO_3']);
    expect(skus(searchProducts(ITEMS, '', { typeFilter: 'accesorio', lineFilter: 'armonia' }))).toEqual(['R40N']);
  });
});
