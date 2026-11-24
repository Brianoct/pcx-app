// Lógica pura del buscador de productos de Cotizar (sin React), para poder
// probarla sola: lectura de la cantidad escrita y orden de los resultados.

export const MAX_QTY = 9999;

export const normalizeText = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim();

export const clampQty = (value) => Math.min(MAX_QTY, Math.max(1, Number.parseInt(value, 10) || 1));

// Cantidad escrita junto a la búsqueda: «3x gancho», «gancho x3», «g10c*3».
// El espacio es obligatorio para no confundirla con medidas como «61x95».
export const parsePickerQuery = (raw) => {
  const text = String(raw || '').trim();
  let match = text.match(/^(\d{1,4})\s*[x*]\s+(.+)$/i);
  if (match) return { term: match[2].trim(), qty: clampQty(match[1]) };
  match = text.match(/^(.+?)\s+[x*]\s*(\d{1,4})$/i);
  if (match) return { term: match[1].trim(), qty: clampQty(match[2]) };
  match = text.match(/^(.+?)\*(\d{1,4})$/);
  if (match) return { term: match[1].trim(), qty: clampQty(match[2]) };
  return { term: text, qty: 1 };
};

// Menor = mejor coincidencia; null = no coincide. Cada palabra escrita debe
// aparecer en el código o en el nombre («94 rojo» encuentra el tablero rojo).
export const scoreMatch = (item, normalizedTerm) => {
  if (!normalizedTerm) return 0;
  const sku = normalizeText(item.sku);
  const name = normalizeText(item.displayName || item.name);
  const haystack = `${sku} ${name}`;
  const words = normalizedTerm.split(/\s+/).filter(Boolean);
  if (!words.every((word) => haystack.includes(word))) return null;
  if (sku === normalizedTerm) return 0;
  if (sku.startsWith(normalizedTerm)) return 1;
  if (name.startsWith(normalizedTerm)) return 2;
  const nameWords = name.split(/[\s/]+/);
  if (words.every((word) => sku.startsWith(word) || nameWords.some((nameWord) => nameWord.startsWith(word)))) return 3;
  return 4;
};

const passesFilters = (item, typeFilter, lineFilter) => {
  if (typeFilter === 'combo') {
    if (!item.isCombo && String(item.product_type || '') !== 'combo') return false;
  } else if (typeFilter !== 'todos') {
    if (item.isCombo) return false;
    if (String(item.product_type || '') !== typeFilter) return false;
  }
  // La línea aplica a productos y combos por igual; lo no clasificado (línea
  // vacía) solo aparece sin filtro de línea.
  if (lineFilter !== 'todas' && String(item.product_line || '') !== lineFilter) return false;
  return true;
};

const matchItems = (items, rawTerm, typeFilter, lineFilter, popularity) => {
  const term = normalizeText(rawTerm);
  const scored = [];
  items.forEach((item, index) => {
    if (!passesFilters(item, typeFilter, lineFilter)) return;
    const score = scoreMatch(item, term);
    if (score === null) return;
    scored.push({ item, score, index });
  });
  // Sin búsqueda se respeta el orden del catálogo; al buscar, primero la
  // mejor coincidencia y, a igualdad, lo que el vendedor cotiza más.
  if (term) {
    const rank = (entry) => popularity.get(String(entry.item.sku || '').toUpperCase()) ?? 999;
    scored.sort((a, b) => (a.score - b.score) || (rank(a) - rank(b)) || (a.index - b.index));
  }
  return { list: scored.map((entry) => entry.item), term };
};

// Devuelve { list, qty, term }: productos visibles, cantidad a agregar con
// Enter y el término ya normalizado.
//
// Primero se busca el texto tal cual: «61 x 95» o «tablero x95» son medidas
// del catálogo, no cantidades. Solo si así no hay resultados se lee la
// cantidad («gancho x3» → 3 ganchos).
export const searchProducts = (items, rawQuery, { typeFilter = 'todos', lineFilter = 'todas', popularity = new Map() } = {}) => {
  const plain = matchItems(items, rawQuery, typeFilter, lineFilter, popularity);
  const parsed = parsePickerQuery(rawQuery);
  if (parsed.qty === 1 || plain.list.length > 0) return { list: plain.list, qty: 1, term: plain.term };
  const withQty = matchItems(items, parsed.term, typeFilter, lineFilter, popularity);
  return { list: withQty.list, qty: withQty.list.length > 0 ? parsed.qty : 1, term: withQty.term };
};
