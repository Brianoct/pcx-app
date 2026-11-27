// Variantes de color de un mismo producto (Tablero 61x95 Negro / Rojo / ...).
// Dos productos son variantes si comparten `attributes.variant_group` o, si no
// lo tienen, si su nombre es igual quitando el color. La misma lógica vive en
// frontend/src/productVariants.js: si cambia una, cambia la otra.
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
const splitColor = (name) => {
  const text = plain(name);
  for (const color of COLOR_WORDS) {
    const match = text.match(new RegExp(`(^| )${color}( |$)`));
    if (match) {
      return { base: text.replace(new RegExp(`(^| )${color}( |$)`), ' ').replace(/\s+/g, ' ').trim(), color };
    }
  }
  return { base: text, color: '' };
};

const variantKey = (product) => {
  const group = plain(product?.attributes?.variant_group);
  if (group) return `g:${group}`;
  const { base, color } = splitColor(product?.name);
  return color ? `n:${plain(product?.product_type)}:${base}` : '';
};

const sameVariantGroup = (a, b) => {
  const keyA = variantKey(a);
  return Boolean(keyA) && keyA === variantKey(b);
};

// El vendedor puede cambiar el color de los componentes de un combo. Se
// acepta lo que mandó solo si es el mismo combo con otros colores: cada
// componente configurado tiene su par (el mismo producto o una variante de
// color) con la misma cantidad. Si no calza, vale lo configurado.
const applyComboColorChoices = (configured, chosen, productBySku) => {
  if (!Array.isArray(chosen) || chosen.length !== configured.length) return configured;
  const pending = chosen.map((item) => ({
    sku: String(item?.sku || '').trim().toUpperCase(),
    quantity: Number.parseInt(item?.quantity, 10)
  }));
  const result = [];
  for (const base of configured) {
    const index = pending.findIndex((item) => item.quantity === base.quantity && (
      item.sku === base.sku
      || (productBySku.has(item.sku) && productBySku.has(base.sku) && sameVariantGroup(productBySku.get(item.sku), productBySku.get(base.sku)))
    ));
    if (index < 0) return configured;
    result.push(pending.splice(index, 1)[0]);
  }
  return result;
};

module.exports = { applyComboColorChoices, sameVariantGroup, splitColor, variantKey };
