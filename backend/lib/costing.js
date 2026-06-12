const { pool } = require('../db');
const { ensureProductCatalogReady } = require('./products');
const { normalizeText } = require('./rbac');
const { createHttpError } = require('./util');

const PRODUCT_COST_COMPONENT_KEYS = [
  'acero_carbono_09mm',
  'pintura_electrostatica',
  'laser_punzonado',
  'equipo_plegado',
  'equipos_pintura',
  'equipos_soldadura',
  'equipos_corte',
  'carton_corrugado',
  'cinta_embalaje',
  'utilidad'
];

const parseNonNegativeAmount = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, `${label} debe ser un número mayor o igual a 0`);
  }
  return parsed;
};

const normalizeProductCostingProcess = (value = '', { allowNull = false } = {}) => {
  if ((value === null || value === undefined || value === '') && allowNull) return null;
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (normalized === 'laser' || normalized === 'corte_laser') return 'laser';
  if (normalized === 'punzonadora' || normalized === 'punzonado' || normalized === 'punch_press') return 'punzonadora';
  return null;
};

const inferProductCostingProcess = (skuValue = '') => {
  const sku = String(skuValue || '').toUpperCase().trim();
  if (sku.startsWith('T')) return 'punzonadora';
  return 'laser';
};

const parseProductCostingPayload = (payload = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const parsed = {};
  for (const key of PRODUCT_COST_COMPONENT_KEYS) {
    parsed[key] = parseNonNegativeAmount(src[key], key);
  }
  const mode = normalizeProductCostingProcess(src.laser_punzonado_mode || '');
  if (!mode) {
    throw createHttpError(400, 'laser_punzonado_mode inválido. Usa laser o punzonadora');
  }
  parsed.laser_punzonado_mode = mode;
  return parsed;
};

const buildProductCostingResponseRow = (row = {}) => {
  const components = Object.fromEntries(
    PRODUCT_COST_COMPONENT_KEYS.map((key) => [key, Number(row[key] || 0)])
  );
  const computedPrice = PRODUCT_COST_COMPONENT_KEYS
    .reduce((sum, key) => sum + Number(components[key] || 0), 0);
  const percentages = Object.fromEntries(
    PRODUCT_COST_COMPONENT_KEYS.map((key) => {
      const pct = computedPrice > 0 ? ((Number(components[key] || 0) / computedPrice) * 100) : 0;
      return [key, Number(pct.toFixed(2))];
    })
  );
  return {
    sku: String(row.sku || '').toUpperCase(),
    name: String(row.name || '').trim(),
    current_sf: Number(row.sf_price || 0),
    current_cf: Number(row.cf_price || 0),
    laser_punzonado_mode: normalizeProductCostingProcess(row.laser_punzonado_mode || '', { allowNull: true })
      || inferProductCostingProcess(row.sku),
    components,
    percentages,
    computed_price: Number(computedPrice.toFixed(2)),
    updated_at: row.updated_at || null
  };
};

let productCostingInitPromise = null;

const ensureProductCostingTable = async () => {
  if (!productCostingInitPromise) {
    productCostingInitPromise = (async () => {
      await ensureProductCatalogReady();
      await pool.query(
        `CREATE TABLE IF NOT EXISTS product_cost_allocations (
          sku TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
          acero_carbono_09mm NUMERIC(12,2) NOT NULL DEFAULT 0,
          pintura_electrostatica NUMERIC(12,2) NOT NULL DEFAULT 0,
          laser_punzonado NUMERIC(12,2) NOT NULL DEFAULT 0,
          laser_punzonado_mode TEXT NOT NULL DEFAULT 'laser',
          equipo_plegado NUMERIC(12,2) NOT NULL DEFAULT 0,
          equipos_pintura NUMERIC(12,2) NOT NULL DEFAULT 0,
          equipos_soldadura NUMERIC(12,2) NOT NULL DEFAULT 0,
          equipos_corte NUMERIC(12,2) NOT NULL DEFAULT 0,
          carton_corrugado NUMERIC(12,2) NOT NULL DEFAULT 0,
          cinta_embalaje NUMERIC(12,2) NOT NULL DEFAULT 0,
          utilidad NUMERIC(12,2) NOT NULL DEFAULT 0,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT product_cost_allocations_mode_chk
            CHECK (laser_punzonado_mode IN ('laser', 'punzonadora'))
        )`
      );
      for (const key of PRODUCT_COST_COMPONENT_KEYS) {
        await pool.query(
          `ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS ${key} NUMERIC(12,2) NOT NULL DEFAULT 0`
        );
      }
      await pool.query(
        `ALTER TABLE product_cost_allocations
         ADD COLUMN IF NOT EXISTS laser_punzonado_mode TEXT NOT NULL DEFAULT 'laser'`
      );
      await pool.query(
        `ALTER TABLE product_cost_allocations
         ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
      );
      await pool.query(
        `ALTER TABLE product_cost_allocations
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()`
      );
      await pool.query(
        `ALTER TABLE product_cost_allocations
         DROP CONSTRAINT IF EXISTS product_cost_allocations_mode_chk`
      );
      await pool.query(
        `ALTER TABLE product_cost_allocations
         ADD CONSTRAINT product_cost_allocations_mode_chk
         CHECK (laser_punzonado_mode IN ('laser', 'punzonadora'))`
      );
    })();
  }
  await productCostingInitPromise;
};

module.exports = {
  PRODUCT_COST_COMPONENT_KEYS,
  buildProductCostingResponseRow,
  ensureProductCostingTable,
  inferProductCostingProcess,
  normalizeProductCostingProcess,
  parseNonNegativeAmount,
  parseProductCostingPayload,
  productCostingInitPromise
};
