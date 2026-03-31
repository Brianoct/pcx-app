export const PRODUCT_CATALOG = [
  { sku: 'T6195R', name: 'Tablero 61x95 Rojo', sf: 330, cf: 383, isCombo: false },
  { sku: 'T6195N', name: 'Tablero 61x95 Negro', sf: 330, cf: 383, isCombo: false },
  { sku: 'T6195AM', name: 'Tablero 61x95 Amarillo', sf: 330, cf: 383, isCombo: false },
  { sku: 'T6195AP', name: 'Tablero 61x95 Azul Petroleo', sf: 330, cf: 383, isCombo: false },
  { sku: 'T6195PL', name: 'Tablero 61x95 Plomo', sf: 330, cf: 383, isCombo: false },
  { sku: 'T9495R', name: 'Tablero 94x95 Rojo', sf: 450, cf: 522, isCombo: false },
  { sku: 'T9495N', name: 'Tablero 94x95 Negro', sf: 450, cf: 522, isCombo: false },
  { sku: 'T9495AM', name: 'Tablero 94x95 Amarillo', sf: 450, cf: 522, isCombo: false },
  { sku: 'T9495AP', name: 'Tablero 94x95 Azul Petroleo', sf: 450, cf: 522, isCombo: false },
  { sku: 'T9495PL', name: 'Tablero 94x95 Plomo', sf: 450, cf: 522, isCombo: false },
  { sku: 'T1099R', name: 'Tablero 10x99 Rojo', sf: 105, cf: 122, isCombo: false },
  { sku: 'T1099N', name: 'Tablero 10x99 Negro', sf: 105, cf: 122, isCombo: false },
  { sku: 'T1099AP', name: 'Tablero 10x99 Azul Petroleo', sf: 105, cf: 122, isCombo: false },
  { sku: 'R40N', name: 'Repisa Grande Negro', sf: 85, cf: 99, isCombo: false },
  { sku: 'R25N', name: 'Repisa Pequeña Negro', sf: 40, cf: 47, isCombo: false },
  { sku: 'D40N', name: 'Desarmador Grande Negro', sf: 70, cf: 82, isCombo: false },
  { sku: 'D22N', name: 'Desarmador Pequeño Negro', sf: 45, cf: 53, isCombo: false },
  { sku: 'L40N', name: 'Llave Grande Negro', sf: 80, cf: 93, isCombo: false },
  { sku: 'L22N', name: 'Llave Pequeño Negro', sf: 50, cf: 58, isCombo: false },
  { sku: 'C15N', name: 'Caja Negro', sf: 48, cf: 56, isCombo: false },
  { sku: 'M08N', name: 'Martillo Negro', sf: 17, cf: 20, isCombo: false },
  { sku: 'A15N', name: 'Amoladora Negro', sf: 30, cf: 35, isCombo: false },
  { sku: 'RR15N', name: 'Repisa/Rollo Negro', sf: 90, cf: 105, isCombo: false },
  { sku: 'G05C', name: 'Gancho 5cm Cromo', sf: 65, cf: 76, isCombo: false },
  { sku: 'G10C', name: 'Gancho 10cm Cromo', sf: 84, cf: 98, isCombo: false }
];

export const REGULAR_PRODUCTS = PRODUCT_CATALOG;

const PRODUCT_ORDER_INDEX = PRODUCT_CATALOG.reduce((acc, item, index) => {
  acc[item.sku] = index;
  return acc;
}, {});

export const sortProductsByCatalogOrder = (products = []) => (
  [...products].sort((a, b) => {
    const aIndex = Object.prototype.hasOwnProperty.call(PRODUCT_ORDER_INDEX, a?.sku)
      ? PRODUCT_ORDER_INDEX[a.sku]
      : Number.MAX_SAFE_INTEGER;
    const bIndex = Object.prototype.hasOwnProperty.call(PRODUCT_ORDER_INDEX, b?.sku)
      ? PRODUCT_ORDER_INDEX[b.sku]
      : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    const aName = String(a?.name || '');
    const bName = String(b?.name || '');
    return aName.localeCompare(bName, 'es', { sensitivity: 'base' });
  })
);
