// Variantes de color de un mismo producto (Tablero 61x95 Negro / Rojo / ...).
// Dos productos son variantes si comparten `attributes.variant_group` o, si no
// lo tienen, si su nombre es igual quitando el color. La misma lógica vive en
// backend/lib/productVariants.js: si cambia una, cambia la otra.
const COLOR_WORDS = [
  'azul petroleo', 'negro', 'blanco', 'rojo', 'amarillo', 'azul', 'plomo', 'gris', 'cromo',
  'verde', 'naranja', 'rosado', 'rosa', 'celeste', 'morado', 'beige', 'cafe', 'madera',
  'natural', 'dorado', 'plateado'
];

const plain = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// { base, color }: el nombre sin el color y el color encontrado ('' si no hay).
export const splitColor = (name) => {
  const text = plain(name);
  for (const color of COLOR_WORDS) {
    const match = text.match(new RegExp(`(^| )${color}( |$)`));
    if (match) {
      return { base: text.replace(new RegExp(`(^| )${color}( |$)`), ' ').replace(/\s+/g, ' ').trim(), color };
    }
  }
  return { base: text, color: '' };
};

export const variantKey = (product) => {
  const group = plain(product?.attributes?.variant_group);
  if (group) return `g:${group}`;
  const { base, color } = splitColor(product?.name);
  return color ? `n:${plain(product?.product_type)}:${base}` : '';
};

export const sameVariantGroup = (a, b) => {
  const keyA = variantKey(a);
  return Boolean(keyA) && keyA === variantKey(b);
};

// Etiqueta del color para el selector: el atributo del catálogo o el que se
// lee del nombre («Azul Petroleo»).
export const colorLabel = (product) => {
  const fromAttr = String(product?.attributes?.color || '').trim();
  if (fromAttr) return fromAttr;
  const { color } = splitColor(product?.name);
  return color ? color.replace(/(^| )\p{L}/gu, (m) => m.toUpperCase()) : String(product?.name || product?.sku || '');
};
