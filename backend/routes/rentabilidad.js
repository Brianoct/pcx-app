// Rentabilidad por producto: junta el costo (Estructura: materiales + equipos
// + mano de obra, con fallback al costeo manual), el precio y las ventas
// reales del período en una sola respuesta. Todo se calcula en vivo con los
// costos de materiales de HOY: cambiar un precio en Materiales mueve todos
// los márgenes al instante.
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { COMPLETED_STATUSES, buildDateFilter } = require('../lib/reporting');
const { loadProductionSettings } = require('../lib/productStructure');
const { PRODUCT_COST_COMPONENT_KEYS } = require('../lib/costing');

const router = express.Router();

// Mismo criterio que Estructura: costo de equipo por unidad producida =
// (depreciación mensual + extras mensuales) / capacidad mensual.
const equipmentCostPerUnit = (row) => {
  const capacity = Number(row.monthly_capacity_units || 0);
  if (capacity <= 0) return 0;
  const life = Number(row.useful_life_months || 0);
  const depreciation = life > 0 ? Number(row.replacement_cost_bs || 0) / life : 0;
  return (depreciation + Number(row.monthly_extra_cost_bs || 0)) / capacity;
};

router.get('/api/admin/rentabilidad', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { month, year } = req.query;
    const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
    const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;
    if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
      return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
    }
    if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
      return res.status(400).json({ error: 'Año inválido' });
    }
    const dateFilter = buildDateFilter(month, year, 'q', 1);
    if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

    const [productsRes, bomRes, stepsRes, settings, manualRes, salesRes, combosRes, comboItemsRes, samplesRes] = await Promise.all([
      pool.query(
        `SELECT sku, name, sf_price, cf_price, product_line, product_type
         FROM products WHERE is_active = TRUE`
      ),
      pool.query(
        `SELECT UPPER(m.sku) AS sku, m.material_id, m.qty_per_unit, c.unit_cost_bs, c.waste_pct
         FROM product_material_map m
         JOIN production_material_catalog c ON c.id = m.material_id`
      ),
      pool.query(
        `SELECT UPPER(s.sku) AS sku, s.std_minutes,
                e.replacement_cost_bs, e.useful_life_months,
                e.monthly_extra_cost_bs, e.monthly_capacity_units
         FROM product_process_steps s
         LEFT JOIN production_equipment_catalog e ON e.id = s.equipment_id`
      ),
      loadProductionSettings(),
      pool.query('SELECT * FROM product_cost_allocations'),
      pool.query(
        `SELECT UPPER(TRIM(li->>'sku')) AS sku,
                SUM(COALESCE((li->>'qty')::numeric, 0))::numeric AS units,
                SUM(COALESCE((li->>'lineTotal')::numeric, 0))::numeric AS revenue
         FROM quotes q, LATERAL jsonb_array_elements(q.line_items) li
         WHERE q.status IN (${COMPLETED_STATUSES.map((s) => `'${s}'`).join(', ')})
           AND q.line_items IS NOT NULL ${dateFilter.sql}
         GROUP BY UPPER(TRIM(li->>'sku'))`,
        dateFilter.params
      ),
      pool.query('SELECT id, name, sf_price, cf_price, product_line FROM combos'),
      pool.query('SELECT combo_id, UPPER(sku) AS sku, quantity FROM combo_items'),
      // Consumo REAL medido por el muestreo de producción: piezas y material
      // usado por (producto, material) en tareas completadas.
      pool.query(
        `SELECT UPPER(sku) AS sku, material_id,
                SUM(qty_used)::numeric AS used,
                SUM(batch_qty)::int AS pieces,
                COUNT(*)::int AS n
         FROM production_task_samples
         WHERE status = 'done' AND qty_used IS NOT NULL AND batch_qty > 0
         GROUP BY UPPER(sku), material_id`
      )
    ]);

    // Costo por SKU desde la Estructura (agregado en memoria: ~26 productos).
    // En paralelo, el costo REAL de materiales: donde el muestreo tiene 3+
    // mediciones para (producto, material), usa el consumo real promedio (que
    // ya incluye la merma real) en vez del estándar del BOM.
    const MIN_SAMPLES = 3;
    const realUsage = new Map(); // "SKU|materialId" → { perUnit, n }
    for (const row of samplesRes.rows) {
      if (Number(row.n) >= MIN_SAMPLES && Number(row.pieces) > 0) {
        realUsage.set(`${row.sku}|${row.material_id}`, {
          perUnit: Number(row.used) / Number(row.pieces),
          n: Number(row.n)
        });
      }
    }
    const materialsCost = new Map();
    const realMaterialsCost = new Map();
    const realSampleCount = new Map();
    for (const row of bomRes.rows) {
      const unitCost = Number(row.unit_cost_bs || 0);
      const stdCost = Number(row.qty_per_unit || 0) * unitCost * (1 + Number(row.waste_pct || 0) / 100);
      materialsCost.set(row.sku, (materialsCost.get(row.sku) || 0) + stdCost);
      const real = realUsage.get(`${row.sku}|${row.material_id}`);
      const realCost = real ? real.perUnit * unitCost : stdCost;
      realMaterialsCost.set(row.sku, (realMaterialsCost.get(row.sku) || 0) + realCost);
      if (real) realSampleCount.set(row.sku, (realSampleCount.get(row.sku) || 0) + real.n);
    }
    const equipCost = new Map();
    const minutes = new Map();
    for (const row of stepsRes.rows) {
      equipCost.set(row.sku, (equipCost.get(row.sku) || 0) + equipmentCostPerUnit(row));
      minutes.set(row.sku, (minutes.get(row.sku) || 0) + Number(row.std_minutes || 0));
    }
    // Costeo manual (fallback): suma de componentes SIN la utilidad.
    const manualCost = new Map();
    for (const row of manualRes.rows) {
      const total = PRODUCT_COST_COMPONENT_KEYS
        .filter((key) => key !== 'utilidad')
        .reduce((sum, key) => sum + Number(row[key] || 0), 0);
      manualCost.set(String(row.sku || '').toUpperCase(), total);
    }
    const sales = new Map(salesRes.rows.map((row) => [row.sku, { units: Number(row.units || 0), revenue: Number(row.revenue || 0) }]));

    const laborRate = Number(settings.labor_rate_bs_hour || 0);
    const costOf = new Map();

    const products = productsRes.rows.map((p) => {
      const sku = String(p.sku || '').toUpperCase();
      const mat = materialsCost.get(sku) || 0;
      const eq = equipCost.get(sku) || 0;
      const labor = ((minutes.get(sku) || 0) / 60) * laborRate;
      let costSource = 'none';
      let cost = null;
      let realCost = null;
      if (mat > 0) {
        costSource = 'estructura';
        cost = mat + eq + labor;
        // Costo real solo cuando el muestreo aportó datos (si no, sería el mismo).
        if (realSampleCount.has(sku)) {
          realCost = (realMaterialsCost.get(sku) || 0) + eq + labor;
        }
      } else if (manualCost.get(sku) > 0) {
        costSource = 'manual';
        cost = manualCost.get(sku);
      }
      if (cost !== null) costOf.set(sku, cost);
      const sold = sales.get(sku) || { units: 0, revenue: 0 };
      const sf = Number(p.sf_price || 0);
      return {
        sku,
        name: p.name,
        product_line: p.product_line || null,
        product_type: p.product_type || null,
        cost_source: costSource,
        cost: cost !== null ? Number(cost.toFixed(2)) : null,
        cost_breakdown: costSource === 'estructura'
          ? { materials: Number(mat.toFixed(2)), equipment: Number(eq.toFixed(2)), labor: Number(labor.toFixed(2)) }
          : null,
        real_cost: realCost !== null ? Number(realCost.toFixed(2)) : null,
        real_delta_pct: realCost !== null && cost > 0 ? Number((((realCost - cost) / cost) * 100).toFixed(1)) : null,
        real_samples: realSampleCount.get(sku) || 0,
        sf,
        cf: Number(p.cf_price || 0),
        margin: cost !== null ? Number((sf - cost).toFixed(2)) : null,
        margin_pct: cost !== null && sf > 0 ? Number((((sf - cost) / sf) * 100).toFixed(1)) : null,
        units_sold: sold.units,
        revenue: Number(sold.revenue.toFixed(2)),
        est_profit: cost !== null ? Number((sold.revenue - sold.units * cost).toFixed(2)) : null
      };
    });

    // Combos: costo = suma de costos de sus componentes; si a alguno le falta
    // costeo, el combo queda sin costo (y marcado).
    const itemsByCombo = new Map();
    for (const row of comboItemsRes.rows) {
      if (!itemsByCombo.has(row.combo_id)) itemsByCombo.set(row.combo_id, []);
      itemsByCombo.get(row.combo_id).push(row);
    }
    const combos = combosRes.rows.map((c) => {
      const items = itemsByCombo.get(c.id) || [];
      let cost = 0;
      let complete = items.length > 0;
      for (const item of items) {
        const unitCost = costOf.get(item.sku);
        if (unitCost === undefined) { complete = false; break; }
        cost += unitCost * Number(item.quantity || 0);
      }
      const sold = sales.get(`COMBO_${c.id}`) || { units: 0, revenue: 0 };
      const sf = Number(c.sf_price || 0);
      const finalCost = complete ? Number(cost.toFixed(2)) : null;
      return {
        id: Number(c.id),
        name: c.name,
        product_line: c.product_line || null,
        cost: finalCost,
        sf,
        margin: finalCost !== null ? Number((sf - finalCost).toFixed(2)) : null,
        margin_pct: finalCost !== null && sf > 0 ? Number((((sf - finalCost) / sf) * 100).toFixed(1)) : null,
        units_sold: sold.units,
        revenue: Number(sold.revenue.toFixed(2)),
        est_profit: finalCost !== null ? Number((sold.revenue - sold.units * finalCost).toFixed(2)) : null
      };
    });

    const all = [...products, ...combos];
    const totals = {
      revenue: Number(all.reduce((sum, r) => sum + r.revenue, 0).toFixed(2)),
      est_profit: Number(all.filter((r) => r.est_profit !== null).reduce((sum, r) => sum + r.est_profit, 0).toFixed(2)),
      sin_costeo: products.filter((r) => r.cost_source === 'none').length,
      costeo_manual: products.filter((r) => r.cost_source === 'manual').length
    };

    res.json({ labor_rate_bs_hour: laborRate, products, combos, totals });
  } catch (err) {
    console.error('Error en rentabilidad:', err);
    res.status(500).json({ error: 'No se pudo calcular la rentabilidad' });
  }
});

module.exports = router;
