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

// Muestra real de cada código de color (swatches del tablero). Mantener en
// sinc con COLOR_SUFFIXES y con COLOR_SWATCH en AdminDashboard.jsx.
export const COLOR_SWATCH = {
  AM: '#facc15', // Amarillo
  AP: '#0e7490', // Azul Petroleo
  PL: '#6b7280', // Plomo
  BL: '#f8fafc', // Blanco
  N: '#1f2937',  // Negro
  R: '#dc2626',  // Rojo
  C: '#cbd5e1',  // Cromo
  B: '#f8fafc'   // Blanco
};

export const parseVariantSku = (sku = '') => {
  const match = String(sku || '').trim().toUpperCase().match(VARIANT_SKU_REGEX);
  if (!match) return null;
  return { base: match[1], colorCode: match[2], colorLabel: COLOR_SUFFIXES[match[2]] || match[2] };
};

// "Tablero 94x95 Negro" -> "Tablero 94x95" (strip the trailing color word).
export const stripColorFromName = (name = '', colorLabel = '') => {
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
        due_date: null,
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
    if (card.due_date && (!batch.due_date || card.due_date < batch.due_date)) {
      batch.due_date = card.due_date;
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

// ── Fecha de entrega → color de la tarjeta ──────────────────────────────────
// Blanco = a tiempo (3+ días), amarillo = faltan 2 días, naranja = falta 1
// día o vence hoy, rojo = atrasado. Sin entrega = blanco. Mismo look glossy
// que los bloques del Plan del día.
const MS_PER_DAY = 86400000;
const dateToUtcMs = (isoDate) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};
export const DUE_STATUS_META = {
  none: { label: 'Sin entrega', short: '' },
  ok: { label: 'A tiempo', short: 'a tiempo' },
  soon: { label: 'Faltan 2 días', short: '2 días' },
  urgent: { label: 'Falta 1 día', short: '1 día' },
  late: { label: 'Atrasado', short: 'atrasado' }
};
export const dueStatus = (dueDate, todayIso) => {
  const due = dateToUtcMs(dueDate);
  const today = dateToUtcMs(todayIso);
  if (due === null || today === null) return { key: 'none', daysLeft: null };
  const daysLeft = Math.round((due - today) / MS_PER_DAY);
  if (daysLeft < 0) return { key: 'late', daysLeft };
  if (daysLeft <= 1) return { key: 'urgent', daysLeft };
  if (daysLeft === 2) return { key: 'soon', daysLeft };
  return { key: 'ok', daysLeft };
};

// "2026-06-04" → "4 jun" sin pasar por Date (evita corrimientos de zona horaria).
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const formatShortDate = (isoDate) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return null;
  return `${Number(match[3])} ${MONTH_SHORT[Number(match[2]) - 1] || ''}`;
};

// Fecha más temprana entre las tarjetas de un lote (inicio o entrega).
export const earliestDate = (cards, field) => cards.reduce((best, card) => {
  const value = card?.[field] ? String(card[field]).slice(0, 10) : null;
  return value && (!best || value < best) ? value : best;
}, null);

// ── Estimación de tiempo por lote ───────────────────────────────────────────
// minutos → "2 h 30 min" / "45 min" / "3 d 4 h".
export const formatMinutes = (minutes) => {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return '0 min';
  const days = Math.floor(total / (8 * 60)); // jornada de 8 h
  const hours = Math.floor((total % (8 * 60)) / 60);
  const mins = total % 60;
  if (days > 0) return `${days} d${hours > 0 ? ` ${hours} h` : ''}`;
  if (hours > 0) return `${hours} h${mins > 0 ? ` ${mins} min` : ''}`;
  return `${mins} min`;
};

// Minutos por pieza para un proceso: el estándar de la estructura si existe,
// si no la mediana medida en el tablero. Devuelve { minutes, source } o null.
export const minutesPerPiece = (card, process) => {
  const std = card?.std_minutes?.[process];
  if (std !== null && std !== undefined && Number.isFinite(Number(std))) return { minutes: Number(std), source: 'std' };
  const measured = card?.measured_minutes?.[process];
  if (measured && Number.isFinite(Number(measured.minutes_per_piece))) return { minutes: Number(measured.minutes_per_piece), source: 'measured' };
  return null;
};

// Estimación del lote (miembros × min/pza) para una etapa y para lo que
// queda de la ruta desde esa etapa (sin Recepción).
export const estimateLot = (members, route, stage) => {
  const perStage = (process) => {
    let minutes = 0;
    let known = 0;
    let measured = false;
    for (const member of members) {
      const qty = Number(member.required_qty || 0);
      const mpp = minutesPerPiece(member, process);
      if (!mpp) continue;
      known += qty;
      minutes += qty * mpp.minutes;
      if (mpp.source === 'measured') measured = true;
    }
    return known > 0 ? { process, minutes, measured } : null;
  };
  const idx = route.indexOf(stage);
  const remaining = idx >= 0 ? route.slice(idx).filter((s) => s !== 'recepcion' && s !== 'planificacion') : [];
  const stages = remaining.map(perStage).filter(Boolean);
  const current = stages.find((s) => s.process === stage) || null;
  const total = stages.reduce((sum, s) => sum + s.minutes, 0);
  return { current, stages, total, unknown: remaining.length - stages.length };
};

// ── Ticket térmico del lote ─────────────────────────────────────────────────
// Abre una ventana de impresión con el resumen del lote en 80 mm de ancho
// para pegarlo al lote físico. Va por el diálogo de impresión del navegador:
// ahí se elige la impresora térmica.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const printLotTicket = ({ title, sku, qty, stageLabel, startDate, dueDate, colors = [], sedes = [], nextStages = [], lotId, dueLabel, stageEstimate = null, totalEstimate = null }) => {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return false;
  const now = new Date();
  const printed = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const rows = [];
  if (colors.length > 0) rows.push(`<div class="sec"><div class="lbl">Colores</div>${colors.map((c) => `<div class="row"><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.qty)}</b></div>`).join('')}</div>`);
  if (sedes.length > 0) rows.push(`<div class="sec"><div class="lbl">Destino</div>${sedes.map((s) => `<div class="row"><span>${escapeHtml(s.sede)}</span><b>${escapeHtml(s.qty)}</b></div>`).join('')}</div>`);
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Lote ${escapeHtml(lotId)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { width: 72mm; margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11pt; line-height: 1.25; }
  .brand { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 6px; }
  .brand b { font-size: 15pt; letter-spacing: 1px; }
  .brand span { font-size: 9pt; }
  .title { font-size: 16pt; font-weight: 900; line-height: 1.15; margin: 2px 0 4px; }
  .sku { font-size: 10pt; margin-bottom: 6px; }
  .qty { font-size: 26pt; font-weight: 900; margin: 2px 0 6px; }
  .qty small { font-size: 10pt; font-weight: 700; }
  .sec { border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
  .lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
  .row { display: flex; justify-content: space-between; gap: 6px; font-size: 11pt; }
  .dates .row b { font-size: 12pt; }
  .stage { font-size: 12pt; font-weight: 800; }
  .route { font-size: 9pt; margin-top: 2px; }
  .foot { border-top: 2px solid #000; margin-top: 8px; padding-top: 4px; font-size: 8pt; display: flex; justify-content: space-between; }
  .box { border: 2px solid #000; padding: 4px 6px; margin-top: 6px; font-size: 12pt; font-weight: 900; text-align: center; }
</style></head><body>
  <div class="brand"><b>PCX</b><span>LOTE ${escapeHtml(lotId)}</span></div>
  <div class="title">${escapeHtml(title)}</div>
  <div class="sku">SKU ${escapeHtml(sku)}</div>
  <div class="qty">${escapeHtml(qty)} <small>pzas</small></div>
  ${rows.join('')}
  <div class="sec dates">
    <div class="row"><span>Inicio</span><b>${escapeHtml(startDate || '—')}</b></div>
    <div class="row"><span>Entrega</span><b>${escapeHtml(dueDate || '—')}</b></div>
  </div>
  ${dueLabel ? `<div class="box">${escapeHtml(dueLabel)}</div>` : ''}
  <div class="sec">
    <div class="lbl">Etapa actual</div>
    <div class="stage">${escapeHtml(stageLabel)}${stageEstimate ? ` <span style="font-weight:400;font-size:10pt">≈ ${escapeHtml(stageEstimate)}</span>` : ''}</div>
    ${nextStages.length > 0 ? `<div class="route">Sigue: ${escapeHtml(nextStages.join(' → '))}</div>` : ''}
    ${totalEstimate ? `<div class="route">Trabajo restante ≈ ${escapeHtml(totalEstimate)}</div>` : ''}
  </div>
  <div class="foot"><span>Impreso ${escapeHtml(printed)}</span><span>pcxind.com</span></div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`);
  win.document.close();
  return true;
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
