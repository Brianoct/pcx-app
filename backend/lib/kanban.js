const { pool } = require('../db');
const { INVENTORY_CITY_SCOPE } = require('./inventory');
const { ensureProductCatalogReady } = require('./products');
const { normalizeText } = require('./rbac');

// Board (display) order. 'planificacion' is where new cards pile up (quantity
// still fluid); 'recepcion' is where finished goods wait to be confirmed at
// the destination warehouse (only intact pieces enter stock).
const PRODUCTION_KANBAN_STAGES = [
  'planificacion',
  'impresion_3d',
  'corte_laser',
  'punzonado',
  'plegado',
  'soldado',
  'lavado',
  'pintado',
  'embalado',
  'recepcion'
];

const PRODUCTION_KANBAN_PLANNING_STAGE = 'planificacion';
const PRODUCTION_KANBAN_RECEPTION_STAGE = 'recepcion';

// Every product route is wrapped with the shared first/last stages.
const wrapProductionRoute = (steps = []) => {
  const middle = (Array.isArray(steps) ? steps : [])
    .filter((step) => step && step !== PRODUCTION_KANBAN_PLANNING_STAGE && step !== PRODUCTION_KANBAN_RECEPTION_STAGE);
  return [PRODUCTION_KANBAN_PLANNING_STAGE, ...middle, PRODUCTION_KANBAN_RECEPTION_STAGE];
};

const PRODUCTION_KANBAN_START_STAGES = new Set(['corte_laser', 'impresion_3d', 'punzonado']);

// Base routes by first operation. Metal parts share plegado → lavado → pintado →
// embalado; 3D (plastic) parts are only printed and packed. "soldado" (welding)
// is not in any base route — it is injected only for products that are welded
// (see WELDED_SKUS / getProductionRouteStages).
const PRODUCTION_KANBAN_ROUTE_BY_START = {
  corte_laser: ['corte_laser', 'plegado', 'lavado', 'pintado', 'embalado'],
  impresion_3d: ['impresion_3d', 'embalado'],
  punzonado: ['punzonado', 'plegado', 'lavado', 'pintado', 'embalado']
};

// Products that require a welding step. Soldado is inserted right after plegado
// in their route. Only the steel box is welded for now; add SKUs here as more
// welded products come online (a per-product route table can replace this later).
const WELDED_SKUS = new Set(['C15N']);

// Products configured as resale ("comprar") are excluded from the production
// board; purchasing will be handled by a dedicated board in a later step.
const RESALE_START_PROCESS = 'comprar';

const PRODUCTION_KANBAN_LOCATION_FIELDS = Object.values(INVENTORY_CITY_SCOPE).map((scope) => ({
  label: scope.canonical,
  stockField: scope.stockField,
  minField: scope.minField,
  maxField: scope.maxField
}));

const normalizeProductionKanbanStage = (value = '', { allowNull = false } = {}) => {
  if ((value === null || value === undefined || value === '') && allowNull) return null;
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (normalized === 'corte_laser' || normalized === 'laser' || normalized === 'corte') return 'corte_laser';
  if (normalized === 'impresion_3d' || normalized === 'impresion3d' || normalized === 'impresion' || normalized === '3d' || normalized === 'print_3d' || normalized === 'print3d') return 'impresion_3d';
  if (normalized === 'punzonado' || normalized === 'punzonadora' || normalized === 'punch') return 'punzonado';
  if (normalized === 'plegado' || normalized === 'doblado' || normalized === 'folding') return 'plegado';
  if (normalized === 'soldado' || normalized === 'soldadura' || normalized === 'weld' || normalized === 'welding') return 'soldado';
  if (normalized === 'lavado' || normalized === 'wash') return 'lavado';
  if (normalized === 'pintado' || normalized === 'pintura' || normalized === 'paint' || normalized === 'painting') return 'pintado';
  if (normalized === 'embalado' || normalized === 'empaque' || normalized === 'pack') return 'embalado';
  if (normalized === 'planificacion' || normalized === 'planeacion' || normalized === 'planning' || normalized === 'plan') return 'planificacion';
  if (normalized === 'recepcion' || normalized === 'reception' || normalized === 'recibir' || normalized === 'en_camino') return 'recepcion';
  return null;
};

const isResaleStartProcess = (value = '') => normalizeText(value).replace(/\s+/g, '_') === RESALE_START_PROCESS;

const normalizeProductionStartProcess = (value = '') => {
  const stage = normalizeProductionKanbanStage(value, { allowNull: true });
  if (stage === null) return null;
  return PRODUCTION_KANBAN_START_STAGES.has(stage) ? stage : null;
};

const getProductionRouteStages = (startProcess = 'corte_laser', sku = '') => {
  const normalizedStart = normalizeProductionStartProcess(startProcess) || 'corte_laser';
  const base = PRODUCTION_KANBAN_ROUTE_BY_START[normalizedStart] || PRODUCTION_KANBAN_ROUTE_BY_START.corte_laser;
  // Inject the welding step right after plegado for welded products only.
  const normalizedSku = String(sku || '').trim().toUpperCase();
  if (WELDED_SKUS.has(normalizedSku)) {
    const plegadoIdx = base.indexOf('plegado');
    if (plegadoIdx >= 0 && !base.includes('soldado')) {
      return [...base.slice(0, plegadoIdx + 1), 'soldado', ...base.slice(plegadoIdx + 1)];
    }
  }
  return base;
};

const inferDefaultProductionStartProcess = (product = {}) => {
  const menuCategory = normalizeText(product.menu_category || '');
  const sku = String(product.sku || '').trim().toUpperCase();
  if (menuCategory.includes('tablero') || sku.startsWith('T')) return 'punzonado';
  return 'corte_laser';
};

// Per-product routes now live in product_process_steps (seeded by migration);
// the computed base route remains as fallback for unseeded/new products.
const loadProductProcessStepsMap = async () => {
  const res = await pool.query(
    `SELECT sku, process
     FROM product_process_steps
     ORDER BY sku, step_order`
  );
  const map = new Map();
  for (const row of res.rows || []) {
    const sku = String(row.sku || '').toUpperCase();
    if (!map.has(sku)) map.set(sku, []);
    map.get(sku).push(row.process);
  }
  return map;
};

const getRouteStagesForSku = async (sku, startProcess = 'corte_laser') => {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const res = await pool.query(
    `SELECT process
     FROM product_process_steps
     WHERE UPPER(sku) = $1
     ORDER BY step_order`,
    [normalizedSku]
  );
  const steps = res.rowCount > 0
    ? res.rows.map((row) => row.process)
    : getProductionRouteStages(startProcess, normalizedSku);
  return wrapProductionRoute(steps);
};

// Regenerate a product's steps from its start process (used when the start
// process is changed from the admin control). Preserves nothing custom — the
// steps become the standard route for that start.
const replaceProductProcessSteps = async (client, sku, startProcess) => {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const route = getProductionRouteStages(startProcess, normalizedSku);
  await client.query('DELETE FROM product_process_steps WHERE UPPER(sku) = $1', [normalizedSku]);
  for (let i = 0; i < route.length; i++) {
    await client.query(
      `INSERT INTO product_process_steps (sku, step_order, process)
       VALUES ($1, $2, $3)`,
      [normalizedSku, i + 1, route[i]]
    );
  }
  return route;
};

const mapProductionKanbanCardRow = (row = {}, routeStagesBySku = null) => {
  const sku = String(row.sku || '').toUpperCase();
  const startProcess = normalizeProductionStartProcess(row.start_process || 'corte_laser') || 'corte_laser';
  const stageCandidate = normalizeProductionKanbanStage(row.stage || '', { allowNull: true }) || PRODUCTION_KANBAN_PLANNING_STAGE;
  const validRoute = wrapProductionRoute(
    (routeStagesBySku && routeStagesBySku.get(sku)) || getProductionRouteStages(startProcess, sku)
  );
  const safeStage = validRoute.includes(stageCandidate) ? stageCandidate : validRoute[0];
  return {
    id: Number(row.id),
    sku,
    product_name: String(row.product_name || row.name || '').trim(),
    store_location: String(row.store_location || '').trim(),
    current_stock: Number(row.current_stock || 0),
    min_stock: Number(row.min_stock || 0),
    required_qty: Number(row.required_qty || 0),
    processed_count: Number(row.processed_count || 0),
    qty_frozen: Boolean(row.qty_frozen),
    start_process: startProcess,
    stage: safeStage,
    route: validRoute,
    source: String(row.source || 'min_stock').trim() || 'min_stock',
    last_moved_at: row.last_moved_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
};

const syncProductionKanbanFromInventory = async () => {
  const productsRes = await pool.query(
    `SELECT sku, name, menu_category,
            stock_cochabamba, stock_santacruz, stock_lima,
            min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
            max_stock_cochabamba, max_stock_santacruz, max_stock_lima
     FROM products
     WHERE is_active = TRUE
     ORDER BY sku`
  );
  const routesRes = await pool.query(
    `SELECT sku, start_process
     FROM production_process_routes`
  );
  const routeBySku = new Map(
    (routesRes.rows || []).map((row) => [String(row.sku || '').toUpperCase(), String(row.start_process || '')])
  );
  const stepsBySku = await loadProductProcessStepsMap();

  // (s,S) hysteresis: a card triggers when stock < min, targets max, and stays
  // active until stock reaches the max level — so "produce up to max" doesn't
  // stop the moment stock crosses min again.
  const activeCardsRes = await pool.query(
    `SELECT sku, store_location
     FROM production_kanban_cards
     WHERE source = 'min_stock' AND is_active = TRUE`
  );
  const previouslyActive = new Set(
    (activeCardsRes.rows || []).map((row) => `${String(row.sku || '').toUpperCase()}::${row.store_location}`)
  );

  const activeKeys = [];
  for (const product of productsRes.rows || []) {
    const sku = String(product.sku || '').toUpperCase();
    const productName = String(product.name || sku).trim() || sku;
    const configuredStartRaw = routeBySku.get(sku);
    // Resale items are not produced; they will live on the purchasing board.
    if (isResaleStartProcess(configuredStartRaw)) continue;
    const startProcess = normalizeProductionStartProcess(configuredStartRaw || '') || inferDefaultProductionStartProcess(product);
    for (const location of PRODUCTION_KANBAN_LOCATION_FIELDS) {
      const stock = Math.max(0, Number.parseInt(product[location.stockField], 10) || 0);
      const minStock = Math.max(0, Number.parseInt(product[location.minField], 10) || 0);
      const maxStock = Math.max(0, Number.parseInt(product[location.maxField], 10) || 0);
      // Order-up-to level: max when configured, else min (legacy behavior).
      const targetLevel = Math.max(minStock, maxStock);
      const locationLabel = location.label;
      const key = `${sku}::${locationLabel}`;
      const triggered = stock < minStock;
      const stillReplenishing = previouslyActive.has(key) && stock < targetLevel;
      if (!triggered && !stillReplenishing) continue;
      const requiredQty = Math.max(0, targetLevel - stock);
      if (requiredQty <= 0) continue;
      activeKeys.push(key);
      // Fluid vs frozen: while a card sits in Planificación (or was completed
      // and is being re-triggered) the sync owns its quantity. The moment it
      // left planning, the quantity is a production order — the sync only
      // refreshes the informative stock/min numbers and never rewrites the
      // qty, the stage, or the freeze flag. This is the fix for quantities
      // drifting while a card crossed the factory.
      await pool.query(
        `INSERT INTO production_kanban_cards (
           sku, product_name, store_location, current_stock, min_stock, required_qty, start_process, stage, source, is_active, qty_frozen, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'planificacion', 'min_stock', TRUE, FALSE, NOW())
         ON CONFLICT (sku, store_location, source) DO UPDATE
         SET product_name = EXCLUDED.product_name,
             current_stock = EXCLUDED.current_stock,
             min_stock = EXCLUDED.min_stock,
             required_qty = CASE
               WHEN NOT production_kanban_cards.is_active OR NOT production_kanban_cards.qty_frozen
                 THEN EXCLUDED.required_qty
               ELSE production_kanban_cards.required_qty
             END,
             start_process = CASE
               WHEN NOT production_kanban_cards.is_active OR NOT production_kanban_cards.qty_frozen
                 THEN EXCLUDED.start_process
               ELSE production_kanban_cards.start_process
             END,
             stage = CASE
               WHEN NOT production_kanban_cards.is_active THEN 'planificacion'
               WHEN production_kanban_cards.stage IS NULL THEN 'planificacion'
               ELSE production_kanban_cards.stage
             END,
             qty_frozen = CASE
               WHEN NOT production_kanban_cards.is_active THEN FALSE
               ELSE production_kanban_cards.qty_frozen
             END,
             is_active = TRUE,
             updated_at = NOW()`,
        [sku, productName, locationLabel, stock, minStock, requiredQty, startProcess]
      );
    }
  }

  // Auto-clear only applies to planning cards (quantity still fluid). Frozen
  // cards are real production orders: they finish at Recepción, never by a
  // stock fluctuation.
  if (activeKeys.length === 0) {
    await pool.query(
      `UPDATE production_kanban_cards
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE source = 'min_stock'
         AND is_active = TRUE
         AND qty_frozen = FALSE`
    );
  } else {
    await pool.query(
      `UPDATE production_kanban_cards
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE source = 'min_stock'
         AND is_active = TRUE
         AND qty_frozen = FALSE
         AND NOT ((sku || '::' || store_location) = ANY($1::text[]))`,
      [activeKeys]
    );
  }

  const cardsRes = await pool.query(
    `SELECT id, sku, product_name, store_location, current_stock, min_stock, required_qty,
            processed_count, qty_frozen, start_process, stage, source, last_moved_at, created_at, updated_at
     FROM production_kanban_cards
     WHERE is_active = TRUE
       AND source = 'min_stock'
     ORDER BY CASE stage
        WHEN 'planificacion' THEN 0
        WHEN 'impresion_3d' THEN 1
        WHEN 'corte_laser' THEN 2
        WHEN 'punzonado' THEN 3
        WHEN 'plegado' THEN 4
        WHEN 'soldado' THEN 5
        WHEN 'lavado' THEN 6
        WHEN 'pintado' THEN 7
        WHEN 'embalado' THEN 8
        WHEN 'recepcion' THEN 9
         ELSE 99
       END,
       required_qty DESC,
       UPPER(product_name) ASC,
       UPPER(sku) ASC`
  );
  return (cardsRes.rows || []).map((row) => mapProductionKanbanCardRow(row, stepsBySku));
};

module.exports = {
  PRODUCTION_KANBAN_LOCATION_FIELDS,
  PRODUCTION_KANBAN_ROUTE_BY_START,
  PRODUCTION_KANBAN_STAGES,
  PRODUCTION_KANBAN_START_STAGES,
  getProductionRouteStages,
  getRouteStagesForSku,
  inferDefaultProductionStartProcess,
  loadProductProcessStepsMap,
  mapProductionKanbanCardRow,
  normalizeProductionKanbanStage,
  normalizeProductionStartProcess,
  replaceProductProcessSteps,
  syncProductionKanbanFromInventory
};
