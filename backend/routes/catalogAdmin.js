const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { PRODUCT_COST_COMPONENT_KEYS, buildProductCostingResponseRow, parseProductCostingPayload } = require('../lib/costing');
const { PRODUCT_PROCESS_KEYS, buildEquipmentResponseRow, buildMaterialResponseRow, getProductProductionConfig, normalizeEquipmentPayload, normalizeMaterialPayload, normalizeProductProductionConfigPayload, saveProductProductionConfig } = require('../lib/productionResources');
const { ensureProductCatalogReady, loadProductCatalogRows, normalizeProductPayload, validateProductSku } = require('../lib/products');
const { exportProductsCsv, importProductsCsv } = require('../lib/productEnrichment');
const { normalizeText, sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const { createHttpError, parseOptionalBoolean } = require('../lib/util');

const router = express.Router();

// ─── PRODUCT CATALOG (Admin CRUD for Cotizador) ─────────────────────────────
router.get('/api/product-catalog', authenticateToken, async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const includeInactive = Boolean(
      access?.admin &&
      ['1', 'true', 'si', 'yes'].includes(normalizeText(req.query?.include_inactive || ''))
    );
    const rows = await loadProductCatalogRows({ includeInactive });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar catálogo de productos' });
  }
});

// ─── Product enrichment CSV round-trip (admin) ──────────────────────────────
// Download the full catalog as an enrichment CSV.
router.get('/api/product-catalog/export', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const activeOnly = ['1', 'true', 'si', 'yes'].includes(normalizeText(req.query?.active_only || ''));
    const { csv } = await exportProductsCsv(pool, { activeOnly });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products-enrichment.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Product export error:', err);
    res.status(500).json({ error: 'No se pudo exportar el catálogo' });
  }
});

// Import an enriched CSV. Defaults to a dry-run preview; pass commit=true to apply.
router.post('/api/product-catalog/import', authenticateToken, requireRole(['admin']), async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) {
    return res.status(400).json({ error: 'Debes enviar el contenido CSV en el campo "csv"' });
  }
  if (csv.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'El CSV es demasiado grande (máx 5MB)' });
  }
  const commit = parseOptionalBoolean(req.body?.commit, false);
  const updateNames = parseOptionalBoolean(req.body?.update_names, false);
  const syncDescription = parseOptionalBoolean(req.body?.sync_description, false);
  try {
    await ensureProductCatalogReady();
    const result = await importProductsCsv(pool, { text: csv, commit, updateNames, syncDescription });
    res.json({
      applied: result.applied,
      counts: {
        to_update: result.updates.length,
        unknown: result.unknown.length,
        skipped: result.skipped.length
      },
      updates: result.updates.map((u) => ({ sku: u.sku, name: u.name, fields: Object.keys(u.attrs) })),
      unknown: result.unknown,
      warnings: result.warnings
    });
  } catch (err) {
    console.error('Product import error:', err);
    res.status(500).json({ error: 'No se pudo importar el CSV' });
  }
});

router.post('/api/product-catalog', authenticateToken, requireRole(['admin']), async (req, res) => {
  let client;
  try {
    const sku = validateProductSku(req.body?.sku);
    const normalized = normalizeProductPayload(req.body, { partial: false });
    const productionConfig = normalizeProductProductionConfigPayload(req.body || {});

    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO products (sku, name, description, sf_price, cf_price, is_active, is_gift_eligible, menu_category, image_url, last_updated)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, NOW())
       RETURNING sku, name, description, sf_price, cf_price, is_active, is_gift_eligible, menu_category, image_url`,
      [
        sku,
        normalized.name,
        normalized.description || null,
        normalized.sf_price,
        normalized.cf_price,
        Boolean(normalized.is_gift_eligible),
        normalized.menu_category || null,
        normalized.image_url || null
      ]
    );
    await saveProductProductionConfig(client, sku, productionConfig);
    await client.query('COMMIT');
    client.release();
    client = null;

    await loadProductCatalogRows();
    res.status(201).json({
      sku: String(result.rows[0].sku || '').toUpperCase(),
      name: result.rows[0].name,
      description: String(result.rows[0].description || '').trim() || null,
      sf: Number(result.rows[0].sf_price || 0),
      cf: Number(result.rows[0].cf_price || 0),
      is_active: Boolean(result.rows[0].is_active),
      is_gift_eligible: Boolean(result.rows[0].is_gift_eligible),
      menu_category: String(result.rows[0].menu_category || '').trim() || null,
      image_url: String(result.rows[0].image_url || '').trim() || null,
      equipment_ids: productionConfig.equipment_ids,
      material_ids: productionConfig.material_ids,
      processes: productionConfig.processes
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback error create product-catalog:', rollbackErr);
      }
      client.release();
    }
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'El SKU ya existe' });
    res.status(500).json({ error: 'No se pudo crear producto' });
  }
});

router.patch('/api/product-catalog/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const sku = validateProductSku(req.params.sku);
    const normalized = normalizeProductPayload(req.body, { partial: true });
    const sets = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(normalized, 'name')) {
      values.push(normalized.name);
      sets.push(`name = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'description')) {
      values.push(normalized.description || null);
      sets.push(`description = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'sf_price')) {
      values.push(normalized.sf_price);
      sets.push(`sf_price = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'cf_price')) {
      values.push(normalized.cf_price);
      sets.push(`cf_price = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'is_active')) {
      values.push(Boolean(normalized.is_active));
      sets.push(`is_active = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'is_gift_eligible')) {
      values.push(Boolean(normalized.is_gift_eligible));
      sets.push(`is_gift_eligible = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'menu_category')) {
      values.push(normalized.menu_category || null);
      sets.push(`menu_category = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'image_url')) {
      values.push(normalized.image_url || null);
      sets.push(`image_url = $${values.length}`);
    }
    values.push(sku);
    const result = await pool.query(
      `UPDATE products
       SET ${sets.join(', ')}, last_updated = NOW()
       WHERE sku = $${values.length}
       RETURNING sku, name, description, sf_price, cf_price, is_active, is_gift_eligible, menu_category, image_url`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    await loadProductCatalogRows();
    res.json({
      sku: String(result.rows[0].sku || '').toUpperCase(),
      name: result.rows[0].name,
      description: String(result.rows[0].description || '').trim() || null,
      sf: Number(result.rows[0].sf_price || 0),
      cf: Number(result.rows[0].cf_price || 0),
      is_active: Boolean(result.rows[0].is_active),
      is_gift_eligible: Boolean(result.rows[0].is_gift_eligible),
      menu_category: String(result.rows[0].menu_category || '').trim() || null,
      image_url: String(result.rows[0].image_url || '').trim() || null
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'No se pudo actualizar producto' });
  }
});

router.delete('/api/product-catalog/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await ensureProductCatalogReady();
    const sku = validateProductSku(req.params.sku);
    const inUseRes = await pool.query(
      `SELECT 1
       FROM combo_items
       WHERE UPPER(sku) = $1
       LIMIT 1`,
      [sku]
    );
    if (inUseRes.rowCount > 0) {
      return res.status(409).json({ error: 'No se puede eliminar: producto usado en combos' });
    }
    const result = await pool.query(
      `UPDATE products
       SET is_active = FALSE, last_updated = NOW()
       WHERE sku = $1
       RETURNING sku`,
      [sku]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    await loadProductCatalogRows();
    res.json({ message: 'Producto desactivado', sku });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '42P01') return res.status(409).json({ error: 'No se pudo validar combos asociados' });
    res.status(500).json({ error: 'No se pudo eliminar producto' });
  }
});

router.get('/api/admin/product-production/options', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const [equipmentRes, materialRes] = await Promise.all([
      pool.query(
        `SELECT id, code, name
         FROM production_equipment_catalog
         WHERE is_active = TRUE
         ORDER BY UPPER(name) ASC, UPPER(code) ASC, id ASC`
      ),
      pool.query(
        `SELECT id, code, name, unit_measure
         FROM production_material_catalog
         WHERE is_active = TRUE
         ORDER BY UPPER(name) ASC, UPPER(code) ASC, id ASC`
      )
    ]);
    return res.json({
      process_options: PRODUCT_PROCESS_KEYS.map((key) => ({
        value: key,
        label: key === 'laser' ? 'Laser' : 'Punzonado'
      })),
      equipment_options: (equipmentRes.rows || []).map((row) => ({
        id: Number(row.id),
        code: String(row.code || '').trim().toUpperCase(),
        name: String(row.name || '').trim()
      })),
      material_options: (materialRes.rows || []).map((row) => ({
        id: Number(row.id),
        code: String(row.code || '').trim().toUpperCase(),
        name: String(row.name || '').trim(),
        unit_measure: String(row.unit_measure || '').trim() || null
      }))
    });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudieron cargar opciones de producción' });
  }
});

router.get('/api/admin/product-production/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const sku = validateProductSku(req.params.sku);
    const productRes = await pool.query(
      `SELECT sku
       FROM products
       WHERE UPPER(sku) = $1
       LIMIT 1`,
      [sku]
    );
    if (productRes.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    const config = await getProductProductionConfig(pool, sku);
    return res.json(config);
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo cargar configuración de producción del producto' });
  }
});

router.put('/api/admin/product-production/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  let client;
  try {
    const sku = validateProductSku(req.params.sku);
    const payload = normalizeProductProductionConfigPayload(req.body || {});

    client = await pool.connect();
    await client.query('BEGIN');

    const productRes = await client.query(
      `SELECT sku
       FROM products
       WHERE UPPER(sku) = $1
       LIMIT 1`,
      [sku]
    );
    if (productRes.rowCount === 0) throw createHttpError(404, 'Producto no encontrado');

    await saveProductProductionConfig(client, sku, payload);

    await client.query('COMMIT');
    client.release();
    client = null;

    return res.json({
      sku,
      ...payload
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback error product-production config:', rollbackErr);
      }
      client.release();
    }
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo guardar configuración de producción del producto' });
  }
});

router.get('/api/admin/equipos', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const includeInactive = parseOptionalBoolean(req.query.include_inactive, false);
    const whereSql = includeInactive ? '' : 'WHERE is_active = TRUE';
    const rowsRes = await pool.query(
      `SELECT
         id, code, name, replacement_cost_bs, useful_life_months, monthly_extra_cost_bs,
         monthly_capacity_units, usage_unit, notes, is_active, updated_by, created_at, updated_at
       FROM production_equipment_catalog
       ${whereSql}
       ORDER BY UPPER(name) ASC, UPPER(code) ASC, id ASC`
    );
    return res.json((rowsRes.rows || []).map(buildEquipmentResponseRow));
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo cargar catálogo de equipos' });
  }
});

router.post('/api/admin/equipos', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const payload = normalizeEquipmentPayload(req.body || {}, { partial: false });
    const insertRes = await pool.query(
      `INSERT INTO production_equipment_catalog (
         code, name, replacement_cost_bs, useful_life_months, monthly_extra_cost_bs,
         monthly_capacity_units, usage_unit, notes, is_active, updated_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
       )
       RETURNING id, code, name, replacement_cost_bs, useful_life_months, monthly_extra_cost_bs,
                 monthly_capacity_units, usage_unit, notes, is_active, updated_by, created_at, updated_at`,
      [
        payload.code,
        payload.name,
        payload.replacement_cost_bs,
        payload.useful_life_months,
        payload.monthly_extra_cost_bs,
        payload.monthly_capacity_units,
        payload.usage_unit || null,
        payload.notes || null,
        Boolean(payload.is_active),
        req.user.id
      ]
    );
    return res.status(201).json(buildEquipmentResponseRow(insertRes.rows[0]));
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'El código de equipo ya existe' });
    return res.status(500).json({ error: 'No se pudo crear equipo' });
  }
});

router.patch('/api/admin/equipos/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const equipmentId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
      return res.status(400).json({ error: 'ID de equipo inválido' });
    }
    const payload = normalizeEquipmentPayload(req.body || {}, { partial: true });
    const sets = [];
    const values = [];
    const assignField = (fieldName, value) => {
      values.push(value);
      sets.push(`${fieldName} = $${values.length}`);
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'code')) assignField('code', payload.code);
    if (Object.prototype.hasOwnProperty.call(payload, 'name')) assignField('name', payload.name);
    if (Object.prototype.hasOwnProperty.call(payload, 'replacement_cost_bs')) assignField('replacement_cost_bs', payload.replacement_cost_bs);
    if (Object.prototype.hasOwnProperty.call(payload, 'useful_life_months')) assignField('useful_life_months', payload.useful_life_months);
    if (Object.prototype.hasOwnProperty.call(payload, 'monthly_extra_cost_bs')) assignField('monthly_extra_cost_bs', payload.monthly_extra_cost_bs);
    if (Object.prototype.hasOwnProperty.call(payload, 'monthly_capacity_units')) assignField('monthly_capacity_units', payload.monthly_capacity_units);
    if (Object.prototype.hasOwnProperty.call(payload, 'usage_unit')) assignField('usage_unit', payload.usage_unit || null);
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) assignField('notes', payload.notes || null);
    if (Object.prototype.hasOwnProperty.call(payload, 'is_active')) assignField('is_active', Boolean(payload.is_active));
    assignField('updated_by', req.user.id);
    sets.push('updated_at = NOW()');
    values.push(equipmentId);

    const updateRes = await pool.query(
      `UPDATE production_equipment_catalog
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, code, name, replacement_cost_bs, useful_life_months, monthly_extra_cost_bs,
                 monthly_capacity_units, usage_unit, notes, is_active, updated_by, created_at, updated_at`,
      values
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: 'Equipo no encontrado' });
    }
    return res.json(buildEquipmentResponseRow(updateRes.rows[0]));
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'El código de equipo ya existe' });
    return res.status(500).json({ error: 'No se pudo actualizar equipo' });
  }
});

router.delete('/api/admin/equipos/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const equipmentId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
      return res.status(400).json({ error: 'ID de equipo inválido' });
    }
    const result = await pool.query(
      `UPDATE production_equipment_catalog
       SET is_active = FALSE,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [equipmentId, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Equipo no encontrado' });
    }
    return res.json({ message: 'Equipo desactivado', id: equipmentId });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo desactivar equipo' });
  }
});

router.get('/api/admin/materiales', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const includeInactive = parseOptionalBoolean(req.query.include_inactive, false);
    const whereSql = includeInactive ? '' : 'WHERE is_active = TRUE';
    const rowsRes = await pool.query(
      `SELECT
         id, code, name, unit_measure, unit_cost_bs, waste_pct,
         reorder_qty, supplier, qr_token,
         notes, is_active, updated_by, created_at, updated_at
       FROM production_material_catalog
       ${whereSql}
       ORDER BY UPPER(name) ASC, UPPER(code) ASC, id ASC`
    );
    return res.json((rowsRes.rows || []).map(buildMaterialResponseRow));
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo cargar catálogo de materiales' });
  }
});

router.post('/api/admin/materiales', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const payload = normalizeMaterialPayload(req.body || {}, { partial: false });
    const insertRes = await pool.query(
      `INSERT INTO production_material_catalog (
         code, name, unit_measure, unit_cost_bs, waste_pct, reorder_qty, supplier, notes, is_active, updated_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
       )
       RETURNING id, code, name, unit_measure, unit_cost_bs, waste_pct, reorder_qty, supplier, qr_token, notes, is_active, updated_by, created_at, updated_at`,
      [
        payload.code,
        payload.name,
        payload.unit_measure,
        payload.unit_cost_bs,
        payload.waste_pct,
        payload.reorder_qty || 0,
        payload.supplier || null,
        payload.notes || null,
        Boolean(payload.is_active),
        req.user.id
      ]
    );
    return res.status(201).json(buildMaterialResponseRow(insertRes.rows[0]));
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'El código de material ya existe' });
    return res.status(500).json({ error: 'No se pudo crear material' });
  }
});

router.patch('/api/admin/materiales/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const materialId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(materialId) || materialId <= 0) {
      return res.status(400).json({ error: 'ID de material inválido' });
    }
    const payload = normalizeMaterialPayload(req.body || {}, { partial: true });
    const sets = [];
    const values = [];
    const assignField = (fieldName, value) => {
      values.push(value);
      sets.push(`${fieldName} = $${values.length}`);
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'code')) assignField('code', payload.code);
    if (Object.prototype.hasOwnProperty.call(payload, 'name')) assignField('name', payload.name);
    if (Object.prototype.hasOwnProperty.call(payload, 'unit_measure')) assignField('unit_measure', payload.unit_measure);
    if (Object.prototype.hasOwnProperty.call(payload, 'unit_cost_bs')) assignField('unit_cost_bs', payload.unit_cost_bs);
    if (Object.prototype.hasOwnProperty.call(payload, 'waste_pct')) assignField('waste_pct', payload.waste_pct);
    if (Object.prototype.hasOwnProperty.call(payload, 'reorder_qty')) assignField('reorder_qty', payload.reorder_qty);
    if (Object.prototype.hasOwnProperty.call(payload, 'supplier')) assignField('supplier', payload.supplier || null);
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) assignField('notes', payload.notes || null);
    if (Object.prototype.hasOwnProperty.call(payload, 'is_active')) assignField('is_active', Boolean(payload.is_active));
    assignField('updated_by', req.user.id);
    sets.push('updated_at = NOW()');
    values.push(materialId);

    const updateRes = await pool.query(
      `UPDATE production_material_catalog
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, code, name, unit_measure, unit_cost_bs, waste_pct, reorder_qty, supplier, qr_token, notes, is_active, updated_by, created_at, updated_at`,
      values
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: 'Material no encontrado' });
    }
    return res.json(buildMaterialResponseRow(updateRes.rows[0]));
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err?.code === '23505') return res.status(409).json({ error: 'El código de material ya existe' });
    return res.status(500).json({ error: 'No se pudo actualizar material' });
  }
});

router.delete('/api/admin/materiales/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const materialId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(materialId) || materialId <= 0) {
      return res.status(400).json({ error: 'ID de material inválido' });
    }
    const result = await pool.query(
      `UPDATE production_material_catalog
       SET is_active = FALSE,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [materialId, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Material no encontrado' });
    }
    return res.json({ message: 'Material desactivado', id: materialId });
  } catch (err) {
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'No se pudo desactivar material' });
  }
});

router.get('/api/product-costing', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.sku,
         p.name,
         p.sf_price,
         p.cf_price,
         c.acero_carbono_09mm,
         c.pintura_electrostatica,
         c.laser_punzonado,
         c.laser_punzonado_mode,
         c.equipo_plegado,
         c.equipos_pintura,
         c.equipos_soldadura,
         c.equipos_corte,
         c.carton_corrugado,
         c.cinta_embalaje,
         c.utilidad,
         c.updated_at
       FROM products p
       LEFT JOIN product_cost_allocations c ON UPPER(c.sku) = UPPER(p.sku)
       WHERE p.is_active = TRUE
       ORDER BY UPPER(p.name) ASC, UPPER(p.sku) ASC`
    );
    const rows = (result.rows || []).map(buildProductCostingResponseRow);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar costeo de productos' });
  }
});

router.patch('/api/product-costing/:sku', authenticateToken, requireRole(['admin']), async (req, res) => {
  let client;
  try {
    const sku = validateProductSku(req.params.sku);
    const payload = parseProductCostingPayload(req.body || {});
    const computedPrice = PRODUCT_COST_COMPONENT_KEYS
      .reduce((sum, key) => sum + Number(payload[key] || 0), 0);
    const roundedPrice = Number(computedPrice.toFixed(2));

    client = await pool.connect();
    await client.query('BEGIN');

    const productRes = await client.query(
      `SELECT sku, name, sf_price, cf_price
       FROM products
       WHERE UPPER(sku) = $1
         AND is_active = TRUE`,
      [sku]
    );
    if (productRes.rowCount === 0) {
      throw createHttpError(404, 'Producto no encontrado o inactivo');
    }

    await client.query(
      `INSERT INTO product_cost_allocations (
         sku,
         acero_carbono_09mm,
         pintura_electrostatica,
         laser_punzonado,
         laser_punzonado_mode,
         equipo_plegado,
         equipos_pintura,
         equipos_soldadura,
         equipos_corte,
         carton_corrugado,
         cinta_embalaje,
         utilidad,
         updated_by,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (sku) DO UPDATE
       SET acero_carbono_09mm = EXCLUDED.acero_carbono_09mm,
           pintura_electrostatica = EXCLUDED.pintura_electrostatica,
           laser_punzonado = EXCLUDED.laser_punzonado,
           laser_punzonado_mode = EXCLUDED.laser_punzonado_mode,
           equipo_plegado = EXCLUDED.equipo_plegado,
           equipos_pintura = EXCLUDED.equipos_pintura,
           equipos_soldadura = EXCLUDED.equipos_soldadura,
           equipos_corte = EXCLUDED.equipos_corte,
           carton_corrugado = EXCLUDED.carton_corrugado,
           cinta_embalaje = EXCLUDED.cinta_embalaje,
           utilidad = EXCLUDED.utilidad,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [
        sku,
        payload.acero_carbono_09mm,
        payload.pintura_electrostatica,
        payload.laser_punzonado,
        payload.laser_punzonado_mode,
        payload.equipo_plegado,
        payload.equipos_pintura,
        payload.equipos_soldadura,
        payload.equipos_corte,
        payload.carton_corrugado,
        payload.cinta_embalaje,
        payload.utilidad,
        req.user.id
      ]
    );

    const updatedProductRes = await client.query(
      `UPDATE products
       SET sf_price = $2,
           cf_price = $2,
           last_updated = NOW()
       WHERE UPPER(sku) = $1
       RETURNING sku, name, sf_price, cf_price`,
      [sku, roundedPrice]
    );

    const updatedCostRes = await client.query(
      `SELECT
         acero_carbono_09mm,
         pintura_electrostatica,
         laser_punzonado,
         laser_punzonado_mode,
         equipo_plegado,
         equipos_pintura,
         equipos_soldadura,
         equipos_corte,
         carton_corrugado,
         cinta_embalaje,
         utilidad,
         updated_at
       FROM product_cost_allocations
       WHERE UPPER(sku) = $1`,
      [sku]
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    await loadProductCatalogRows();

    const productRow = updatedProductRes.rows[0] || productRes.rows[0];
    const costingRow = updatedCostRes.rows[0] || payload;
    res.json(buildProductCostingResponseRow({
      ...productRow,
      ...costingRow
    }));
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback error product costing:', rollbackErr);
      }
      client.release();
    }
    console.error(err);
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'No se pudo guardar costeo de producto' });
  }
});

module.exports = router;
