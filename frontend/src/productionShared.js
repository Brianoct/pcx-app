// Shared helpers for the production pages (Planificación / Kanban / Recepción).

// Board (display) order — must match backend PRODUCTION_KANBAN_STAGES.
// Planificación and Recepción live on their own pages; the board shows the rest.
export const ALL_STAGES = [
  { key: 'planificacion', label: 'Planificación' },
  { key: 'impresion_3d', label: 'Impresión 3D' },
  { key: 'corte_laser', label: 'Corte Láser' },
  { key: 'punzonado', label: 'Punzonado' },
  { key: 'plegado', label: 'Plegado' },
  { key: 'soldado', label: 'Soldado' },
  { key: 'lavado', label: 'Lavado' },
  { key: 'pintado', label: 'Pintado' },
  { key: 'embalado', label: 'Embalado' },
  { key: 'recepcion', label: 'Recepción' }
];

export const BOARD_STAGES = ALL_STAGES.filter((s) => s.key !== 'planificacion' && s.key !== 'recepcion');
export const STAGE_LABEL = Object.fromEntries(ALL_STAGES.map((s) => [s.key, s.label]));
const STAGE_ORDER = ALL_STAGES.map((s) => s.key);

// A card carries its own `route` from the backend (welded products include
// soldado). Fall back to the full board order if it's ever missing.
export const cardRoute = (card) => (Array.isArray(card?.route) && card.route.length ? card.route : STAGE_ORDER);

// Live stopwatch since the batch entered its stage: "03:27:45" / "1d 03:27:45".
const pad2 = (n) => String(n).padStart(2, '0');
export const stopwatchSince = (since, now) => {
  if (!since) return null;
  let secs = Math.floor((now - new Date(since).getTime()) / 1000);
  if (!Number.isFinite(secs)) return null;
  if (secs < 0) secs = 0;
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  return `${days > 0 ? `${days}d ` : ''}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
};

// Color variants: SKUs end in a color code (T9495N / T9495R / T9495AP...).
// Same base = same physical part until Pintado, so those cards ride the
// factory as ONE lote. Keep in sync with COLOR_SUFFIXES in backend/lib/kanban.js.
const COLOR_SUFFIXES = { AM: 'Amarillo', AP: 'Azul Petroleo', PL: 'Plomo', BL: 'Blanco', N: 'Negro', R: 'Rojo', C: 'Cromo', B: 'Blanco' };
const VARIANT_SKU_REGEX = /^([A-Z0-9]*?\d)(AM|AP|PL|BL|N|R|C|B)$/;

export const parseVariantSku = (sku = '') => {
  const match = String(sku || '').trim().toUpperCase().match(VARIANT_SKU_REGEX);
  if (!match) return null;
  return { base: match[1], colorCode: match[2], colorLabel: COLOR_SUFFIXES[match[2]] || match[2] };
};

// "Tablero 94x95 Negro" -> "Tablero 94x95" (strip the trailing color word).
const stripColorFromName = (name = '', colorLabel = '') => {
  const trimmed = String(name || '').trim();
  if (!colorLabel) return trimmed;
  const lower = trimmed.toLowerCase();
  const suffix = colorLabel.toLowerCase();
  if (lower.endsWith(suffix)) return trimmed.slice(0, trimmed.length - colorLabel.length).trim();
  return trimmed;
};

// One base part in one stage = one "mother card". Members can span sedes AND
// color variants; `colors` splits the batch by SKU for the Pintado counters.
export const groupIntoBatches = (cards, { stages = null } = {}) => {
  const batches = new Map();
  for (const card of cards) {
    if (stages && !stages.includes(card.stage)) continue;
    const variant = parseVariantSku(card.sku);
    const groupId = variant ? variant.base : card.sku;
    const key = `${groupId}::${card.stage}`;
    if (!batches.has(key)) {
      batches.set(key, {
        key,
        group_id: groupId,
        sku: card.sku,
        product_name: card.product_name,
        stage: card.stage,
        route: cardRoute(card),
        members: [],
        colors: new Map(),
        total_qty: 0,
        processed: 0,
        pending_tasks: 0,
        qty_frozen: false,
        planned_date: null,
        oldest_move: null
      });
    }
    const batch = batches.get(key);
    batch.members.push(card);
    batch.total_qty += Number(card.required_qty || 0);
    batch.processed += Number(card.processed_count || 0);
    batch.pending_tasks += Number(card.pending_tasks || 0);
    batch.qty_frozen = batch.qty_frozen || Boolean(card.qty_frozen);
    if (card.planned_date && (!batch.planned_date || card.planned_date < batch.planned_date)) {
      batch.planned_date = card.planned_date;
    }
    const colorKey = String(card.sku || '').toUpperCase();
    if (!batch.colors.has(colorKey)) {
      batch.colors.set(colorKey, {
        sku: colorKey,
        label: variant ? variant.colorLabel : (card.product_name || colorKey),
        qty: 0,
        processed: 0,
        members: []
      });
    }
    const color = batch.colors.get(colorKey);
    color.qty += Number(card.required_qty || 0);
    color.processed += Number(card.processed_count || 0);
    color.members.push(card);
    const since = card.last_moved_at || card.created_at;
    if (since && (!batch.oldest_move || new Date(since) < new Date(batch.oldest_move))) {
      batch.oldest_move = since;
    }
  }
  // Finalize: variant flag + display name without the color word.
  for (const batch of batches.values()) {
    batch.color_list = [...batch.colors.values()].sort((a, b) => a.label.localeCompare(b.label));
    batch.is_variant_group = batch.color_list.length > 1;
    if (batch.is_variant_group) {
      const first = batch.members[0];
      const variant = parseVariantSku(first.sku);
      batch.display_name = stripColorFromName(first.product_name, variant?.colorLabel);
      batch.display_sku = batch.group_id;
    } else {
      batch.display_name = batch.product_name;
      batch.display_sku = batch.sku;
    }
  }
  return batches;
};

// Per-sede totals of a batch (colors merged), for the sheet's secondary line.
export const sedeTotals = (batch) => {
  const totals = new Map();
  for (const member of batch.members) {
    const sede = member.store_location || '—';
    totals.set(sede, (totals.get(sede) || 0) + Number(member.required_qty || 0));
  }
  return [...totals.entries()].map(([sede, qty]) => ({ sede, qty }));
};
