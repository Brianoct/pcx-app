const { pool } = require('../db');
const { PRODUCTION_KANBAN_STAGES, PRODUCTION_KANBAN_START_STAGES, normalizeProductionKanbanStage } = require('./kanban');
const { validateProductSku } = require('./products');
const { createHttpError } = require('./util');

// ─── Production settings (plant-wide costing knobs) ─────────────────────────

const loadProductionSettings = async () => {
  const res = await pool.query(
    'SELECT labor_rate_bs_hour, updated_at FROM production_settings WHERE id = 1'
  );
  return {
    labor_rate_bs_hour: Number(res.rows[0]?.labor_rate_bs_hour || 0),
    updated_at: res.rows[0]?.updated_at || null
  };
};

const saveProductionSettings = async ({ labor_rate_bs_hour }, userId) => {
  const rate = Number(labor_rate_bs_hour);
  if (!Number.isFinite(rate) || rate < 0) {
    throw createHttpError(400, 'labor_rate_bs_hour debe ser un número >= 0');
  }
  await pool.query(
    `INSERT INTO production_settings (id, labor_rate_bs_hour, updated_by, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
     SET labor_rate_bs_hour = EXCLUDED.labor_rate_bs_hour,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
    [rate, userId || null]
  );
  return loadProductionSettings();
};

// ─── Structure payload validation ────────────────────────────────────────────

const parseStructureSteps = (value) => {
  if (!Array.isArray(value)) throw createHttpError(400, 'steps debe ser un arreglo');
  if (value.length === 0) throw createHttpError(400, 'La ruta necesita al menos un paso');
  const seen = new Set();
  const steps = value.map((item, index) => {
    const process = normalizeProductionKanbanStage(item?.process || '');
    if (!process) {
      throw createHttpError(400, `Paso ${index + 1}: proceso inválido. Usa: ${PRODUCTION_KANBAN_STAGES.join(', ')}`);
    }
    if (seen.has(process)) {
      throw createHttpError(400, `Paso duplicado en la ruta: ${process}`);
    }
    seen.add(process);
    let stdMinutes = null;
    if (item?.std_minutes !== undefined && item?.std_minutes !== null && item?.std_minutes !== '') {
      stdMinutes = Number(item.std_minutes);
      if (!Number.isFinite(stdMinutes) || stdMinutes < 0) {
        throw createHttpError(400, `Paso ${index + 1}: std_minutes debe ser un número >= 0`);
      }
    }
    let equipmentId = null;
    if (item?.equipment_id !== undefined && item?.equipment_id !== null && item?.equipment_id !== '') {
      equipmentId = Number.parseInt(item.equipment_id, 10);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        throw createHttpError(400, `Paso ${index + 1}: equipment_id inválido`);
      }
    }
    return { process, std_minutes: stdMinutes, equipment_id: equipmentId };
  });
  return steps;
};

const parseStructureMaterials = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw createHttpError(400, 'materials debe ser un arreglo');
  const seen = new Set();
  return value.map((item, index) => {
    const materialId = Number.parseInt(item?.material_id, 10);
    if (!Number.isInteger(materialId) || materialId <= 0) {
      throw createHttpError(400, `Material ${index + 1}: material_id inválido`);
    }
    if (seen.has(materialId)) {
      throw createHttpError(400, `Material repetido en la lista (id ${materialId})`);
    }
    seen.add(materialId);
    const qty = Number(item?.qty_per_unit);
    if (!Number.isFinite(qty) || qty < 0) {
      throw createHttpError(400, `Material ${index + 1}: qty_per_unit debe ser un número >= 0`);
    }
    const process = normalizeProductionKanbanStage(item?.process || '', { allowNull: true });
    return { material_id: materialId, qty_per_unit: qty, process };
  });
};

// ─── Persistence ─────────────────────────────────────────────────────────────

const saveProductStructure = async (sku, payload, userId) => {
  const normalizedSku = validateProductSku(sku);
  const steps = parseStructureSteps(payload?.steps);
  const materials = parseStructureMaterials(payload?.materials);

  // Materials may only reference processes present in the route.
  const routeSet = new Set(steps.map((step) => step.process));
  for (const material of materials) {
    if (material.process && !routeSet.has(material.process)) {
      throw createHttpError(400, `Material asignado a un proceso fuera de la ruta: ${material.process}`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const productRes = await client.query(
      'SELECT sku FROM products WHERE UPPER(sku) = $1 AND is_active = TRUE',
      [normalizedSku]
    );
    if (productRes.rowCount === 0) throw createHttpError(404, 'Producto no encontrado o inactivo');

    const equipmentIds = steps.map((s) => s.equipment_id).filter(Boolean);
    if (equipmentIds.length > 0) {
      const eqRes = await client.query(
        'SELECT id FROM production_equipment_catalog WHERE id = ANY($1::bigint[])',
        [equipmentIds]
      );
      if (eqRes.rowCount !== new Set(equipmentIds).size) {
        throw createHttpError(400, 'Uno o más equipos no existen');
      }
    }
    if (materials.length > 0) {
      const mtRes = await client.query(
        'SELECT id FROM production_material_catalog WHERE id = ANY($1::bigint[])',
        [materials.map((m) => m.material_id)]
      );
      if (mtRes.rowCount !== materials.length) {
        throw createHttpError(400, 'Uno o más materiales no existen');
      }
    }

    await client.query('DELETE FROM product_process_steps WHERE UPPER(sku) = $1', [normalizedSku]);
    for (let i = 0; i < steps.length; i++) {
      await client.query(
        `INSERT INTO product_process_steps (sku, step_order, process, std_minutes, equipment_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [normalizedSku, i + 1, steps[i].process, steps[i].std_minutes, steps[i].equipment_id]
      );
    }

    await client.query('DELETE FROM product_material_map WHERE UPPER(sku) = $1', [normalizedSku]);
    for (const material of materials) {
      await client.query(
        `INSERT INTO product_material_map (sku, material_id, qty_per_unit, process, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [normalizedSku, material.material_id, material.qty_per_unit, material.process]
      );
    }

    // Keep the legacy start-process route in sync so kanban card grouping and
    // the fallback route match the explicit steps.
    const firstStep = steps[0].process;
    if (PRODUCTION_KANBAN_START_STAGES.has(firstStep)) {
      await client.query(
        `INSERT INTO production_process_routes (sku, start_process, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (sku) DO UPDATE
         SET start_process = EXCLUDED.start_process,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [normalizedSku, firstStep, userId || null]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Read + derived costing ──────────────────────────────────────────────────

// Equipment cost attributed to one produced unit: monthly ownership cost
// (straight-line depreciation + running extras) spread over monthly capacity.
const equipmentCostPerUnit = (equipment) => {
  if (!equipment) return 0;
  const capacity = Number(equipment.monthly_capacity_units || 0);
  if (capacity <= 0) return 0;
  const life = Number(equipment.useful_life_months || 0);
  const depreciation = life > 0 ? Number(equipment.replacement_cost_bs || 0) / life : 0;
  const monthly = depreciation + Number(equipment.monthly_extra_cost_bs || 0);
  return monthly / capacity;
};

const getProductStructure = async (sku) => {
  const normalizedSku = validateProductSku(sku);

  const [stepsRes, materialsRes, settings, manualRes, productRes] = await Promise.all([
    pool.query(
      `SELECT s.step_order, s.process, s.std_minutes, s.equipment_id,
              e.code AS equipment_code, e.name AS equipment_name,
              e.replacement_cost_bs, e.useful_life_months,
              e.monthly_extra_cost_bs, e.monthly_capacity_units
       FROM product_process_steps s
       LEFT JOIN production_equipment_catalog e ON e.id = s.equipment_id
       WHERE UPPER(s.sku) = $1
       ORDER BY s.step_order`,
      [normalizedSku]
    ),
    pool.query(
      `SELECT m.material_id, m.qty_per_unit, m.process,
              c.code, c.name, c.unit_measure, c.unit_cost_bs, c.waste_pct
       FROM product_material_map m
       JOIN production_material_catalog c ON c.id = m.material_id
       WHERE UPPER(m.sku) = $1
       ORDER BY UPPER(c.name)`,
      [normalizedSku]
    ),
    loadProductionSettings(),
    pool.query(
      `SELECT acero_carbono_09mm, pintura_electrostatica, laser_punzonado,
              equipo_plegado, equipos_pintura, equipos_soldadura, equipos_corte,
              carton_corrugado, cinta_embalaje, utilidad
       FROM product_cost_allocations
       WHERE UPPER(sku) = $1`,
      [normalizedSku]
    ),
    pool.query(
      'SELECT sku, name, sf_price FROM products WHERE UPPER(sku) = $1',
      [normalizedSku]
    )
  ]);

  if (productRes.rowCount === 0) throw createHttpError(404, 'Producto no encontrado');

  const steps = stepsRes.rows.map((row) => ({
    step_order: Number(row.step_order),
    process: row.process,
    std_minutes: row.std_minutes !== null ? Number(row.std_minutes) : null,
    equipment_id: row.equipment_id !== null ? Number(row.equipment_id) : null,
    equipment_code: row.equipment_code || null,
    equipment_name: row.equipment_name || null,
    equipment_cost_per_unit: Number(equipmentCostPerUnit(row.equipment_id !== null ? row : null).toFixed(4))
  }));

  const materials = materialsRes.rows.map((row) => {
    const qty = Number(row.qty_per_unit || 0);
    const unitCost = Number(row.unit_cost_bs || 0);
    const waste = Number(row.waste_pct || 0);
    return {
      material_id: Number(row.material_id),
      code: row.code,
      name: row.name,
      unit_measure: row.unit_measure,
      unit_cost_bs: unitCost,
      waste_pct: waste,
      qty_per_unit: qty,
      process: row.process || null,
      cost_per_unit: Number((qty * unitCost * (1 + waste / 100)).toFixed(4))
    };
  });

  const materialsCost = materials.reduce((sum, m) => sum + m.cost_per_unit, 0);
  const equipmentCost = steps.reduce((sum, s) => sum + s.equipment_cost_per_unit, 0);
  const totalMinutes = steps.reduce((sum, s) => sum + Number(s.std_minutes || 0), 0);
  const laborCost = (totalMinutes / 60) * settings.labor_rate_bs_hour;

  const manual = manualRes.rows[0] || null;
  const manualUtility = Number(manual?.utilidad || 0);
  const manualTotal = manual
    ? Object.values(manual).reduce((sum, v) => sum + Number(v || 0), 0)
    : 0;

  const computedCost = materialsCost + equipmentCost + laborCost;

  return {
    sku: normalizedSku,
    name: productRes.rows[0].name,
    steps,
    materials,
    costing: {
      labor_rate_bs_hour: settings.labor_rate_bs_hour,
      total_std_minutes: Number(totalMinutes.toFixed(2)),
      materials_cost: Number(materialsCost.toFixed(2)),
      equipment_cost: Number(equipmentCost.toFixed(2)),
      labor_cost: Number(laborCost.toFixed(2)),
      computed_cost: Number(computedCost.toFixed(2)),
      utility: manualUtility,
      computed_price: Number((computedCost + manualUtility).toFixed(2)),
      manual_total: Number(manualTotal.toFixed(2)),
      current_price: Number(productRes.rows[0].sf_price || 0)
    }
  };
};

module.exports = {
  getProductStructure,
  loadProductionSettings,
  saveProductStructure,
  saveProductionSettings
};
