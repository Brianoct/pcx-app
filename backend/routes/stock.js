const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { getInventoryAccessScope } = require('../lib/inventory');
const { ensureProductCatalogReady } = require('../lib/products');
const { sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// ─── GET stock for a SKU in a specific store ───────────────────────────────
router.get('/api/stock', authenticateToken, async (req, res) => {
  const { sku, store_location } = req.query;

  if (!sku || !store_location) {
    return res.status(400).json({ error: 'SKU y store_location son requeridos' });
  }

  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[store_location];

  if (!warehouseField) return res.status(400).json({ error: 'Almacén no válido' });

  try {
    const result = await pool.query(
      `SELECT ${warehouseField} AS stock FROM products WHERE sku = $1`,
      [sku.toUpperCase()]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });

    res.json({ stock: result.rows[0].stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener stock' });
  }
});

// ─── UPDATE stock for a specific SKU in a warehouse ────────────────────────
router.patch('/api/products/:sku/stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const { store_location, new_stock } = req.body;

  if (!store_location || new_stock === undefined || isNaN(new_stock) || new_stock < 0) {
    return res.status(400).json({ error: 'store_location y new_stock (número >= 0) son requeridos' });
  }

  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[store_location];

  if (!warehouseField) return res.status(400).json({ error: 'Almacén no válido' });
  if (!inventoryScope.isGlobal && store_location !== inventoryScope.scope.canonical) {
    return res.status(403).json({ error: 'No puedes actualizar inventario de otro almacén' });
  }

  try {
    const result = await pool.query(
      `UPDATE products 
       SET ${warehouseField} = $1, last_updated = NOW() 
       WHERE sku = $2 
       RETURNING sku, ${warehouseField} AS stock`,
      [new_stock, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ 
      message: 'Stock actualizado', 
      sku: result.rows[0].sku, 
      stock: result.rows[0].stock 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar stock' });
  }
});

// ─── UPDATE minimum stock thresholds for a SKU ──────────────────────────────
router.patch('/api/products/:sku/min-stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const minFields = ['min_stock_cochabamba', 'min_stock_santacruz', 'min_stock_lima'];
  const maxFields = ['max_stock_cochabamba', 'max_stock_santacruz', 'max_stock_lima'];

  const isValidLevel = (v) => !(v === undefined || v === null || Number.isNaN(Number(v)) || Number(v) < 0);

  try {
    if (!inventoryScope.isGlobal) {
      const allowedMinField = inventoryScope.scope.minField;
      const allowedMaxField = inventoryScope.scope.maxField;
      const providedFields = [...minFields, ...maxFields].filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
      if (providedFields.length === 0) {
        return res.status(400).json({ error: `Debes enviar ${allowedMinField}` });
      }
      if (providedFields.some((field) => field !== allowedMinField && field !== allowedMaxField)) {
        return res.status(403).json({ error: 'No puedes actualizar mínimos de otro almacén' });
      }

      const sets = [];
      const values = [];
      for (const field of [allowedMinField, allowedMaxField]) {
        if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;
        if (!isValidLevel(req.body[field])) {
          return res.status(400).json({ error: 'Los niveles deben ser números >= 0' });
        }
        values.push(Number(req.body[field]));
        sets.push(`${field} = $${values.length}`);
      }
      values.push(sku.toUpperCase());

      const result = await pool.query(
        `UPDATE products
         SET ${sets.join(', ')},
             last_updated = NOW()
         WHERE sku = $${values.length}
         RETURNING sku, ${allowedMinField}, ${allowedMaxField}`,
        values
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      return res.json({
        message: 'Niveles actualizados',
        ...result.rows[0]
      });
    }

    const {
      min_stock_cochabamba,
      min_stock_santacruz,
      min_stock_lima
    } = req.body;

    const values = [min_stock_cochabamba, min_stock_santacruz, min_stock_lima];
    if (values.some((v) => !isValidLevel(v))) {
      return res.status(400).json({ error: 'Los mínimos por almacén son requeridos y deben ser números >= 0' });
    }

    // Max levels are optional; only provided ones are updated.
    const maxSets = [];
    const maxValues = [];
    for (const field of maxFields) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;
      if (!isValidLevel(req.body[field])) {
        return res.status(400).json({ error: 'Los máximos deben ser números >= 0' });
      }
      maxValues.push(Number(req.body[field]));
      maxSets.push(`${field} = $${3 + maxValues.length}`);
    }

    const result = await pool.query(
      `UPDATE products
       SET min_stock_cochabamba = $1,
           min_stock_santacruz = $2,
           min_stock_lima = $3${maxSets.length ? `, ${maxSets.join(', ')}` : ''},
           last_updated = NOW()
       WHERE sku = $${4 + maxValues.length}
       RETURNING sku, min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
                 max_stock_cochabamba, max_stock_santacruz, max_stock_lima`,
      [min_stock_cochabamba, min_stock_santacruz, min_stock_lima, ...maxValues, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({
      message: 'Niveles actualizados',
      ...result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar mínimos' });
  }
});

// ─── MARKETING: Combos ──────────────────────────────────────────────────────

// ─── INVENTORY ──────────────────────────────────────────────────────────────
router.get('/api/products', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  try {
    await ensureProductCatalogReady();
    if (!inventoryScope.isGlobal) {
      const stockField = inventoryScope.scope.stockField;
      const minField = inventoryScope.scope.minField;
      const maxField = inventoryScope.scope.maxField;
      const result = await pool.query(`
        SELECT sku, name, ${stockField}, ${minField}, ${maxField}, last_updated
        FROM products
        WHERE is_active = TRUE
        ORDER BY sku
      `);
      return res.json(result.rows);
    }

    const result = await pool.query(`
      SELECT sku, name, stock_cochabamba, stock_santacruz, stock_lima,
             min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
             max_stock_cochabamba, max_stock_santacruz, max_stock_lima,
             last_updated
      FROM products
      WHERE is_active = TRUE
      ORDER BY sku
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});


// ─── Sugerencias de mín/máx a partir de las ventas reales ───────────────────
// Criterio del negocio: activar producción ~una vez al mes por producto.
//   · máx − mín ≈ 1 mes de venta → el stock baja de máx a mín en ~un mes y
//     el disparo de producción ocurre mensualmente.
//   · mín ≈ 3 semanas de venta (producción + transporte + colchón), para no
//     quedar en cero mientras se repone.
// La velocidad de venta sale de las cotizaciones cobradas (Pagado/Embalado/
// Enviado) de los últimos `days` días, expandiendo combos a sus componentes.
//
// Atribución por DESTINO (Logística PCX — rutas y días de envío): cada venta
// cuenta para el almacén que atiende su destino, no para el store_location
// tecleado. Regla: primero ciudades con ruta explícita (el dpto. de Potosí se
// parte: Uyuni/Llallagua/Uncía salen por Cbba, Tupiza/Villazón por SCZ),
// después el departamento; si no hay destino, el store_location de la venta.
const CITY_KEY_BY_STORE = { Cochabamba: 'cochabamba', 'Santa Cruz': 'santacruz', Lima: 'lima' };

const stripAccents = (value) => String(value || '')
  .toLowerCase().trim()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Ciudades con ruta explícita en el afiche de logística.
const ROUTE_BY_CITY = {
  // Salen de Santa Cruz (nacionales diarios + provincias de los viernes)
  trinidad: 'santacruz', riberalta: 'santacruz', guayaramerin: 'santacruz',
  cobija: 'santacruz', tarija: 'santacruz', bermejo: 'santacruz',
  'entre rios': 'santacruz', camargo: 'santacruz', tupiza: 'santacruz',
  villazon: 'santacruz', 'puerto suarez': 'santacruz', montero: 'santacruz',
  yapacani: 'santacruz', warnes: 'santacruz', cotoca: 'santacruz',
  vallegrande: 'santacruz', 'santa cruz de la sierra': 'santacruz',
  'santa cruz': 'santacruz',
  // Salen de Cochabamba
  potosi: 'cochabamba', uyuni: 'cochabamba', llallagua: 'cochabamba',
  uncia: 'cochabamba', oruro: 'cochabamba', 'la paz': 'cochabamba',
  'el alto': 'cochabamba', sucre: 'cochabamba', 'villa tunari': 'cochabamba',
  shinahota: 'cochabamba', chimore: 'cochabamba', ivirgarzama: 'cochabamba',
  'san gabriel': 'cochabamba', cochabamba: 'cochabamba',
  lima: 'lima'
};

// Sin ciudad con ruta explícita: el departamento decide.
const ROUTE_BY_DEPARTMENT = {
  'santa cruz': 'santacruz', beni: 'santacruz', pando: 'santacruz', tarija: 'santacruz',
  cochabamba: 'cochabamba', 'la paz': 'cochabamba', oruro: 'cochabamba',
  chuquisaca: 'cochabamba', potosi: 'cochabamba',
  lima: 'lima'
};

const routeWarehouseKey = ({ ciudad, department, store_location: storeLocation }) => {
  const cityRoute = ROUTE_BY_CITY[stripAccents(ciudad)];
  if (cityRoute) return cityRoute;
  const deptRoute = ROUTE_BY_DEPARTMENT[stripAccents(department)];
  if (deptRoute) return deptRoute;
  return CITY_KEY_BY_STORE[storeLocation] || null;
};

router.get('/api/inventory/minmax-suggestions', authenticateToken, async (req, res) => {
  try {
    const userContext = await loadUserContext(req.user.id);
    if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
    const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
    const scope = getInventoryAccessScope(userContext, access);
    if (scope.error) return res.status(403).json({ error: scope.error });

    const windowDays = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 90, 30), 365);

    const salesRes = await pool.query(
      `SELECT q.store_location, q.department, q.ciudad, UPPER(item->>'sku') AS sku,
              SUM(COALESCE((item->>'qty')::numeric, 0)) AS units
       FROM quotes q
       CROSS JOIN LATERAL jsonb_array_elements(q.line_items::jsonb) item
       WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
         AND q.created_at >= NOW() - ($1 * INTERVAL '1 day')
       GROUP BY 1, 2, 3, 4`,
      [windowDays]
    );

    // Combos venden componentes: COMBO_<id> se expande vía combo_items.
    const unitsBySkuCity = new Map();
    const addUnits = (sku, cityKey, units) => {
      if (!sku || !cityKey || !(units > 0)) return;
      if (!unitsBySkuCity.has(sku)) unitsBySkuCity.set(sku, { cochabamba: 0, santacruz: 0, lima: 0 });
      unitsBySkuCity.get(sku)[cityKey] += units;
    };
    const comboRows = [];
    for (const row of salesRes.rows) {
      const cityKey = routeWarehouseKey(row);
      const comboMatch = String(row.sku || '').match(/^COMBO_(\d+)$/);
      if (comboMatch) {
        comboRows.push({ comboId: Number(comboMatch[1]), cityKey, units: Number(row.units) });
      } else {
        addUnits(row.sku, cityKey, Number(row.units));
      }
    }
    if (comboRows.length > 0) {
      const comboIds = [...new Set(comboRows.map((r) => r.comboId))];
      const itemsRes = await pool.query(
        'SELECT combo_id, UPPER(sku) AS sku, quantity FROM combo_items WHERE combo_id = ANY($1)',
        [comboIds]
      );
      const itemsByCombo = new Map();
      for (const item of itemsRes.rows) {
        if (!itemsByCombo.has(Number(item.combo_id))) itemsByCombo.set(Number(item.combo_id), []);
        itemsByCombo.get(Number(item.combo_id)).push(item);
      }
      for (const comboRow of comboRows) {
        for (const item of itemsByCombo.get(comboRow.comboId) || []) {
          addUnits(item.sku, comboRow.cityKey, comboRow.units * Number(item.quantity));
        }
      }
    }

    const productsRes = await pool.query(
      `SELECT sku, name,
              min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
              max_stock_cochabamba, max_stock_santacruz, max_stock_lima
       FROM products
       WHERE is_active = TRUE
       ORDER BY sku`
    );

    const suggestFor = (monthly) => {
      if (!(monthly > 0)) return { suggested_min: 0, suggested_max: 0 };
      const min = Math.max(1, Math.ceil(monthly * 0.75));
      const max = min + Math.max(1, Math.ceil(monthly));
      return { suggested_min: min, suggested_max: max };
    };

    const rows = productsRes.rows.map((product) => {
      const sold = unitsBySkuCity.get(String(product.sku).toUpperCase()) || { cochabamba: 0, santacruz: 0, lima: 0 };
      const cities = {};
      for (const [cityKey, suffix] of [['cochabamba', 'cochabamba'], ['santacruz', 'santacruz'], ['lima', 'lima']]) {
        const units = sold[cityKey] || 0;
        const monthly = Math.round((units * 30 / windowDays) * 10) / 10;
        cities[cityKey] = {
          units_sold: units,
          monthly,
          current_min: Number(product[`min_stock_${suffix}`] ?? 0),
          current_max: Number(product[`max_stock_${suffix}`] ?? 0),
          ...suggestFor(monthly)
        };
      }
      return { sku: product.sku, name: product.name, cities };
    });

    res.json({
      window_days: windowDays,
      criteria: 'Producción ~1 vez al mes: máx−mín ≈ 1 mes de venta; mín ≈ 3 semanas de venta. Venta atribuida al almacén que atiende el destino (rutas Logística PCX).',
      rows,
      products_with_sales: rows.filter((r) => Object.values(r.cities).some((c) => c.units_sold > 0)).length
    });
  } catch (err) {
    console.error('Error computing min/max suggestions:', err);
    res.status(500).json({ error: 'No se pudieron calcular las sugerencias' });
  }
});

module.exports = router;
