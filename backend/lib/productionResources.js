const { pool } = require('../db');
const { parseNonNegativeAmount } = require('./costing');
const { ensureProductCatalogReady, validateProductSku } = require('./products');
const { createHttpError } = require('./util');

const PRODUCT_PROCESS_KEYS = ['laser', 'punzonado'];

const normalizeProductProcessKey = (value = '') => {
  const processKey = String(value || '').trim().toLowerCase();
  if (!processKey) return '';
  if (!PRODUCT_PROCESS_KEYS.includes(processKey)) {
    throw createHttpError(400, `Proceso inválido. Usa: ${PRODUCT_PROCESS_KEYS.join(', ')}`);
  }
  return processKey;
};

const parseIntegerIdArray = (value, fieldLabel) => {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw createHttpError(400, `${fieldLabel} debe ser un arreglo`);
  const unique = new Set();
  const parsed = [];
  for (const item of value) {
    const id = Number.parseInt(item, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw createHttpError(400, `${fieldLabel} contiene IDs inválidos`);
    }
    if (!unique.has(id)) {
      unique.add(id);
      parsed.push(id);
    }
  }
  return parsed;
};

const parseProcessArray = (value, fieldLabel = 'processes') => {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw createHttpError(400, `${fieldLabel} debe ser un arreglo`);
  const unique = new Set();
  const parsed = [];
  for (const item of value) {
    const processKey = normalizeProductProcessKey(item);
    if (processKey && !unique.has(processKey)) {
      unique.add(processKey);
      parsed.push(processKey);
    }
  }
  return parsed;
};

const normalizeProductProductionConfigPayload = (payload = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  return {
    equipment_ids: parseIntegerIdArray(src.equipment_ids, 'equipment_ids'),
    material_ids: parseIntegerIdArray(src.material_ids, 'material_ids'),
    processes: parseProcessArray(src.processes, 'processes')
  };
};

const assertProductProductionReferencesExist = async (db, { equipment_ids = [], material_ids = [] } = {}) => {
  if (equipment_ids.length > 0) {
    const eqRes = await db.query(
      `SELECT id
       FROM production_equipment_catalog
       WHERE id = ANY($1::bigint[])`,
      [equipment_ids]
    );
    if (eqRes.rowCount !== equipment_ids.length) {
      throw createHttpError(400, 'Uno o más equipment_ids no existen');
    }
  }
  if (material_ids.length > 0) {
    const mtRes = await db.query(
      `SELECT id
       FROM production_material_catalog
       WHERE id = ANY($1::bigint[])`,
      [material_ids]
    );
    if (mtRes.rowCount !== material_ids.length) {
      throw createHttpError(400, 'Uno o más material_ids no existen');
    }
  }
};

const saveProductProductionConfig = async (db, sku, config = {}) => {
  const normalizedSku = validateProductSku(sku);
  const payload = normalizeProductProductionConfigPayload(config);
  await assertProductProductionReferencesExist(db, payload);

  await db.query('DELETE FROM product_equipment_map WHERE UPPER(sku) = $1', [normalizedSku]);
  await db.query('DELETE FROM product_material_map WHERE UPPER(sku) = $1', [normalizedSku]);
  await db.query('DELETE FROM product_process_map WHERE UPPER(sku) = $1', [normalizedSku]);

  for (const equipmentId of payload.equipment_ids) {
    await db.query(
      `INSERT INTO product_equipment_map (sku, equipment_id, created_at)
       VALUES ($1, $2, NOW())`,
      [normalizedSku, equipmentId]
    );
  }
  for (const materialId of payload.material_ids) {
    await db.query(
      `INSERT INTO product_material_map (sku, material_id, created_at)
       VALUES ($1, $2, NOW())`,
      [normalizedSku, materialId]
    );
  }
  for (const processKey of payload.processes) {
    await db.query(
      `INSERT INTO product_process_map (sku, process_key, created_at)
       VALUES ($1, $2, NOW())`,
      [normalizedSku, processKey]
    );
  }
  return payload;
};

const getProductProductionConfig = async (db, sku) => {
  const normalizedSku = validateProductSku(sku);
  const [equipmentRes, materialRes, processRes] = await Promise.all([
    db.query(
      `SELECT equipment_id
       FROM product_equipment_map
       WHERE UPPER(sku) = $1
       ORDER BY equipment_id ASC`,
      [normalizedSku]
    ),
    db.query(
      `SELECT material_id
       FROM product_material_map
       WHERE UPPER(sku) = $1
       ORDER BY material_id ASC`,
      [normalizedSku]
    ),
    db.query(
      `SELECT process_key
       FROM product_process_map
       WHERE UPPER(sku) = $1
       ORDER BY process_key ASC`,
      [normalizedSku]
    )
  ]);
  return {
    sku: normalizedSku,
    equipment_ids: (equipmentRes.rows || []).map((row) => Number(row.equipment_id)),
    material_ids: (materialRes.rows || []).map((row) => Number(row.material_id)),
    processes: (processRes.rows || []).map((row) => String(row.process_key || '').trim().toLowerCase()).filter(Boolean)
  };
};

const PRODUCTION_RESOURCE_CODE_REGEX = /^[A-Z0-9_-]{2,40}$/;

const parseOptionalPositiveInteger = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, `${label} debe ser un entero mayor a 0`);
  }
  return parsed;
};

const parseOptionalPositiveAmount = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createHttpError(400, `${label} debe ser un número mayor a 0`);
  }
  return parsed;
};

const normalizeProductionResourceCode = (value, label = 'code') => {
  const code = String(value || '').trim().toUpperCase();
  if (!code) throw createHttpError(400, `${label} requerido`);
  if (!PRODUCTION_RESOURCE_CODE_REGEX.test(code)) {
    throw createHttpError(400, `${label} inválido. Usa 2-40 caracteres A-Z, 0-9, guion o guion bajo`);
  }
  return code;
};

const normalizeProductionResourceName = (value, label = 'name') => {
  const name = String(value || '').trim();
  if (!name) throw createHttpError(400, `${label} requerido`);
  if (name.length > 140) throw createHttpError(400, `${label} demasiado largo (máx 140)`);
  return name;
};

const normalizeOptionalShortText = (value, label, { maxLength = 140 } = {}) => {
  if (value === undefined) return undefined;
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length > maxLength) throw createHttpError(400, `${label} demasiado largo (máx ${maxLength})`);
  return text;
};

const normalizeOptionalBooleanField = (value, label = 'is_active') => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 'yes', 'active', 'activo'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'inactive', 'inactivo'].includes(normalized)) return false;
  throw createHttpError(400, `${label} debe ser booleano`);
};

const normalizeEquipmentPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const hasCode = Object.prototype.hasOwnProperty.call(src, 'code');
  const hasName = Object.prototype.hasOwnProperty.call(src, 'name');
  const hasReplacementCost = Object.prototype.hasOwnProperty.call(src, 'replacement_cost_bs');
  const hasUsefulLifeMonths = Object.prototype.hasOwnProperty.call(src, 'useful_life_months');
  const hasMonthlyExtraCost = Object.prototype.hasOwnProperty.call(src, 'monthly_extra_cost_bs');
  const hasMonthlyCapacity = Object.prototype.hasOwnProperty.call(src, 'monthly_capacity_units');
  const hasUsageUnit = Object.prototype.hasOwnProperty.call(src, 'usage_unit');
  const hasNotes = Object.prototype.hasOwnProperty.call(src, 'notes');
  const hasIsActive = Object.prototype.hasOwnProperty.call(src, 'is_active');

  if (!partial && (!hasCode || !hasName)) {
    throw createHttpError(400, 'Debes enviar code y name');
  }
  if (partial && !hasCode && !hasName && !hasReplacementCost && !hasUsefulLifeMonths && !hasMonthlyExtraCost && !hasMonthlyCapacity && !hasUsageUnit && !hasNotes && !hasIsActive) {
    throw createHttpError(400, 'No se enviaron cambios para actualizar equipo');
  }

  const normalized = {};
  if (hasCode) normalized.code = normalizeProductionResourceCode(src.code, 'code');
  if (hasName) normalized.name = normalizeProductionResourceName(src.name, 'name');
  if (hasReplacementCost) normalized.replacement_cost_bs = parseNonNegativeAmount(src.replacement_cost_bs, 'replacement_cost_bs');
  if (hasUsefulLifeMonths) normalized.useful_life_months = parseOptionalPositiveInteger(src.useful_life_months, 'useful_life_months');
  if (hasMonthlyExtraCost) normalized.monthly_extra_cost_bs = parseNonNegativeAmount(src.monthly_extra_cost_bs, 'monthly_extra_cost_bs');
  if (hasMonthlyCapacity) normalized.monthly_capacity_units = parseOptionalPositiveAmount(src.monthly_capacity_units, 'monthly_capacity_units');
  if (hasUsageUnit) normalized.usage_unit = normalizeOptionalShortText(src.usage_unit, 'usage_unit', { maxLength: 80 });
  if (hasNotes) normalized.notes = normalizeOptionalShortText(src.notes, 'notes', { maxLength: 1000 });
  if (hasIsActive) normalized.is_active = normalizeOptionalBooleanField(src.is_active, 'is_active');

  if (!partial) {
    if (!Object.prototype.hasOwnProperty.call(normalized, 'replacement_cost_bs')) normalized.replacement_cost_bs = 0;
    if (!Object.prototype.hasOwnProperty.call(normalized, 'monthly_extra_cost_bs')) normalized.monthly_extra_cost_bs = 0;
    if (!Object.prototype.hasOwnProperty.call(normalized, 'is_active')) normalized.is_active = true;
  }
  return normalized;
};

const normalizeMaterialPayload = (payload = {}, { partial = false } = {}) => {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const hasCode = Object.prototype.hasOwnProperty.call(src, 'code');
  const hasName = Object.prototype.hasOwnProperty.call(src, 'name');
  const hasUnitMeasure = Object.prototype.hasOwnProperty.call(src, 'unit_measure');
  const hasUnitCost = Object.prototype.hasOwnProperty.call(src, 'unit_cost_bs');
  const hasWastePct = Object.prototype.hasOwnProperty.call(src, 'waste_pct');
  const hasNotes = Object.prototype.hasOwnProperty.call(src, 'notes');
  const hasIsActive = Object.prototype.hasOwnProperty.call(src, 'is_active');

  if (!partial && (!hasCode || !hasName || !hasUnitMeasure)) {
    throw createHttpError(400, 'Debes enviar code, name y unit_measure');
  }
  if (partial && !hasCode && !hasName && !hasUnitMeasure && !hasUnitCost && !hasWastePct && !hasNotes && !hasIsActive) {
    throw createHttpError(400, 'No se enviaron cambios para actualizar material');
  }

  const normalized = {};
  if (hasCode) normalized.code = normalizeProductionResourceCode(src.code, 'code');
  if (hasName) normalized.name = normalizeProductionResourceName(src.name, 'name');
  if (hasUnitMeasure) normalized.unit_measure = normalizeProductionResourceName(src.unit_measure, 'unit_measure');
  if (hasUnitCost) normalized.unit_cost_bs = parseNonNegativeAmount(src.unit_cost_bs, 'unit_cost_bs');
  if (hasWastePct) {
    const wastePct = parseNonNegativeAmount(src.waste_pct, 'waste_pct');
    if (wastePct > 100) throw createHttpError(400, 'waste_pct no puede ser mayor a 100');
    normalized.waste_pct = wastePct;
  }
  if (hasNotes) normalized.notes = normalizeOptionalShortText(src.notes, 'notes', { maxLength: 1000 });
  if (hasIsActive) normalized.is_active = normalizeOptionalBooleanField(src.is_active, 'is_active');

  if (!partial) {
    if (!Object.prototype.hasOwnProperty.call(normalized, 'unit_cost_bs')) normalized.unit_cost_bs = 0;
    if (!Object.prototype.hasOwnProperty.call(normalized, 'waste_pct')) normalized.waste_pct = 0;
    if (!Object.prototype.hasOwnProperty.call(normalized, 'is_active')) normalized.is_active = true;
  }
  return normalized;
};

const buildEquipmentResponseRow = (row = {}) => ({
  id: Number(row.id),
  code: String(row.code || '').trim().toUpperCase(),
  name: String(row.name || '').trim(),
  replacement_cost_bs: Number(row.replacement_cost_bs || 0),
  useful_life_months: row.useful_life_months !== null ? Number(row.useful_life_months) : null,
  monthly_extra_cost_bs: Number(row.monthly_extra_cost_bs || 0),
  monthly_capacity_units: row.monthly_capacity_units !== null ? Number(row.monthly_capacity_units) : null,
  usage_unit: String(row.usage_unit || '').trim() || null,
  notes: String(row.notes || '').trim() || null,
  is_active: Boolean(row.is_active),
  updated_by: row.updated_by !== null ? Number(row.updated_by) : null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

const buildMaterialResponseRow = (row = {}) => ({
  id: Number(row.id),
  code: String(row.code || '').trim().toUpperCase(),
  name: String(row.name || '').trim(),
  unit_measure: String(row.unit_measure || '').trim(),
  unit_cost_bs: Number(row.unit_cost_bs || 0),
  waste_pct: Number(row.waste_pct || 0),
  notes: String(row.notes || '').trim() || null,
  is_active: Boolean(row.is_active),
  updated_by: row.updated_by !== null ? Number(row.updated_by) : null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

module.exports = {
  PRODUCTION_RESOURCE_CODE_REGEX,
  PRODUCT_PROCESS_KEYS,
  assertProductProductionReferencesExist,
  buildEquipmentResponseRow,
  buildMaterialResponseRow,
  getProductProductionConfig,
  normalizeEquipmentPayload,
  normalizeMaterialPayload,
  normalizeOptionalBooleanField,
  normalizeOptionalShortText,
  normalizeProductProcessKey,
  normalizeProductProductionConfigPayload,
  normalizeProductionResourceCode,
  normalizeProductionResourceName,
  parseIntegerIdArray,
  parseOptionalPositiveAmount,
  parseOptionalPositiveInteger,
  parseProcessArray,
  saveProductProductionConfig
};
