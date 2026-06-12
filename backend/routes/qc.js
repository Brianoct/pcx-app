const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../lib/authMiddleware');
const { loadProductCatalogRows, loadProductNameMap } = require('../lib/products');
const { ensureQcProductSettingsSeeded, loadQcSettingsMap, normalizeQcResult } = require('../lib/qc');
const { ROLE_KEYS, normalizeRole, sanitizePanelAccess } = require('../lib/rbac');
const { buildDateFilter } = require('../lib/reporting');
const { loadUserContext } = require('../lib/users');

const router = express.Router();

// ─── QUALITY CONTROL ─────────────────────────────────────────────────────────
router.get('/api/qc/products', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para control de calidad' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productCatalog = await loadProductCatalogRows();
    const rows = productCatalog.map((item) => {
      const settings = settingsMap.get(String(item.sku || '').toUpperCase()) || { base_price: 0, commission_rate: 0 };
      return {
        sku: item.sku,
        name: item.name,
        base_price: Number(settings.base_price || 0),
        commission_rate: Number(settings.commission_rate || 0)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar productos de control de calidad' });
  }
});

router.post('/api/qc/checks', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para registrar control de calidad' });
  }

  const sku = String(req.body?.sku || '').toUpperCase().trim();
  const quantity = Number.parseInt(req.body?.quantity, 10);
  const resultValue = normalizeQcResult(req.body?.result);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Cantidad inválida. Debe ser un entero mayor a 0' });
  }
  if (!resultValue) {
    return res.status(400).json({ error: 'Resultado inválido. Debe ser Aprobado o Rechazado' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const productMap = await loadProductNameMap();
    if (!sku || !productMap.has(sku)) {
      return res.status(400).json({ error: 'Producto inválido para control de calidad' });
    }
    const productName = productMap.get(sku) || sku;
    const insertRes = await pool.query(
      `INSERT INTO quality_control_records (user_id, sku, product_name, quantity, result)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, sku, product_name, quantity, result, created_at`,
      [req.user.id, sku, productName, quantity, resultValue]
    );
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar control de calidad' });
  }
});

router.get('/api/qc/checks', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para ver control de calidad' });
  }

  const dateFilter = buildDateFilter(req.query.month, req.query.year, 'r', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    await ensureQcProductSettingsSeeded();
    const result = await pool.query(
      `SELECT r.id, r.user_id, u.email AS user_email, r.sku, r.product_name, r.quantity, r.result, r.created_at
       FROM quality_control_records r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE 1=1${dateFilter.sql}
       ORDER BY r.created_at DESC, r.id DESC`,
      [...dateFilter.params]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar registros de control de calidad' });
  }
});

router.patch('/api/qc/checks/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
  if (!access.control_calidad && !isAdmin) {
    return res.status(403).json({ error: 'No tienes permiso para editar control de calidad' });
  }

  const recordId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return res.status(400).json({ error: 'ID de registro inválido' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const existingRes = await pool.query(
      `SELECT id, user_id, sku, quantity, result
       FROM quality_control_records
       WHERE id = $1`,
      [recordId]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'Registro de control de calidad no encontrado' });
    }

    const existing = existingRes.rows[0];
    if (!isAdmin && Number(existing.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Solo puedes editar tus propios registros de control de calidad' });
    }

    const hasSku = Object.prototype.hasOwnProperty.call(req.body || {}, 'sku');
    const hasQuantity = Object.prototype.hasOwnProperty.call(req.body || {}, 'quantity');
    const hasResult = Object.prototype.hasOwnProperty.call(req.body || {}, 'result');
    if (!hasSku && !hasQuantity && !hasResult) {
      return res.status(400).json({ error: 'No se enviaron cambios para actualizar' });
    }

    const sku = hasSku
      ? String(req.body?.sku || '').toUpperCase().trim()
      : String(existing.sku || '').toUpperCase().trim();
    const quantity = hasQuantity
      ? Number.parseInt(req.body?.quantity, 10)
      : Number.parseInt(existing.quantity, 10);
    const resultValue = hasResult
      ? normalizeQcResult(req.body?.result)
      : normalizeQcResult(existing.result);

    const productNameMap = await getProductNameMap();
    if (!sku || !productNameMap.has(sku)) {
      return res.status(400).json({ error: 'Producto inválido para control de calidad' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida. Debe ser un entero mayor a 0' });
    }
    if (!resultValue) {
      return res.status(400).json({ error: 'Resultado inválido. Debe ser Aprobado o Rechazado' });
    }

    const productName = productNameMap.get(sku) || sku;
    const updateRes = await pool.query(
      `UPDATE quality_control_records
       SET sku = $1,
           product_name = $2,
           quantity = $3,
           result = $4
       WHERE id = $5
       RETURNING id, user_id, sku, product_name, quantity, result, created_at`,
      [sku, productName, quantity, resultValue, recordId]
    );

    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el registro de control de calidad' });
  }
});

router.delete('/api/qc/checks/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
  if (!access.control_calidad && !isAdmin) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar control de calidad' });
  }

  const recordId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return res.status(400).json({ error: 'ID de registro inválido' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const existingRes = await pool.query(
      `SELECT id, user_id
       FROM quality_control_records
       WHERE id = $1`,
      [recordId]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'Registro de control de calidad no encontrado' });
    }
    const existing = existingRes.rows[0];
    if (!isAdmin && Number(existing.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios registros de control de calidad' });
    }

    await pool.query(
      `DELETE FROM quality_control_records
       WHERE id = $1`,
      [recordId]
    );
    res.json({ message: 'Registro de control de calidad eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar el registro de control de calidad' });
  }
});

router.get('/api/qc/summary', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  if (!access.control_calidad && normalizeRole(userContext.role || '') !== ROLE_KEYS.admin) {
    return res.status(403).json({ error: 'No tienes permiso para ver resumen de control de calidad' });
  }

  const dateFilter = buildDateFilter(req.query.month, req.query.year, 'r', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productNameMap = await loadProductNameMap();
    const summaryRes = await pool.query(
      `SELECT r.sku, r.product_name,
              SUM(CASE WHEN r.result = 'passed' THEN r.quantity ELSE 0 END) AS qty_passed,
              SUM(CASE WHEN r.result = 'rejected' THEN r.quantity ELSE 0 END) AS qty_rejected
       FROM quality_control_records r
       WHERE 1=1${dateFilter.sql}
       GROUP BY r.sku, r.product_name
       ORDER BY r.sku ASC`,
      [...dateFilter.params]
    );
    const rows = summaryRes.rows.map((row) => {
      const sku = String(row.sku || '').toUpperCase();
      const settings = settingsMap.get(sku) || { base_price: 0, commission_rate: 0 };
      const qtyPassed = Number(row.qty_passed || 0);
      const qtyRejected = Number(row.qty_rejected || 0);
      const basePrice = Number(settings.base_price || 0);
      const commissionRate = Number(settings.commission_rate || 0);
      return {
        sku,
        product_name: row.product_name || productNameMap.get(sku) || sku,
        qty_passed: qtyPassed,
        qty_rejected: qtyRejected,
        base_price: basePrice,
        commission_rate: commissionRate,
        commission_total: qtyPassed * (basePrice * commissionRate / 100)
      };
    });
    const totalCommission = rows.reduce((sum, row) => sum + Number(row.commission_total || 0), 0);
    res.json({ rows, total_commission: totalCommission });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar resumen de control de calidad' });
  }
});

router.get('/api/microfabrica/dashboard', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const isAdmin = normalizeRole(userContext.role || '') === ROLE_KEYS.admin;
  if (!access.microfabrica_panel && !isAdmin) {
    return res.status(403).json({ error: 'No tienes permiso para ver el panel de microfabrica' });
  }

  const dateFilter = buildDateFilter(req.query.month, req.query.year, 'r', 1);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productCatalog = await loadProductCatalogRows();
    const summaryRes = await pool.query(
      `SELECT UPPER(r.sku) AS sku,
              SUM(CASE WHEN r.result = 'passed' THEN r.quantity ELSE 0 END) AS qty_passed,
              SUM(CASE WHEN r.result = 'rejected' THEN r.quantity ELSE 0 END) AS qty_rejected
       FROM quality_control_records r
       WHERE 1=1${dateFilter.sql}
       GROUP BY UPPER(r.sku)`,
      [...dateFilter.params]
    );

    const bySku = new Map(
      summaryRes.rows.map((row) => [
        String(row.sku || '').toUpperCase(),
        {
          qty_passed: Number(row.qty_passed || 0),
          qty_rejected: Number(row.qty_rejected || 0)
        }
      ])
    );

    const rows = productCatalog.map((item) => {
      const sku = String(item.sku || '').toUpperCase();
      const totals = bySku.get(sku) || { qty_passed: 0, qty_rejected: 0 };
      const settings = settingsMap.get(sku) || { base_price: Number(item.sf || 0), commission_rate: 0 };
      const basePrice = Number(settings.base_price || 0);
      const commissionRate = Number(settings.commission_rate || 0);
      const commissionPerPiece = basePrice * commissionRate / 100;
      const subtotalCommission = Number(totals.qty_passed || 0) * commissionPerPiece;
      return {
        sku,
        product_name: item.name,
        qty_passed: Number(totals.qty_passed || 0),
        qty_rejected: Number(totals.qty_rejected || 0),
        base_price: basePrice,
        commission_rate: commissionRate,
        commission_per_piece: commissionPerPiece,
        subtotal_commission: subtotalCommission
      };
    });

    const totals = rows.reduce((acc, row) => {
      acc.qty_passed += Number(row.qty_passed || 0);
      acc.qty_rejected += Number(row.qty_rejected || 0);
      acc.total_commission += Number(row.subtotal_commission || 0);
      if (Number(row.qty_passed || 0) > 0 || Number(row.qty_rejected || 0) > 0) {
        acc.products_with_activity += 1;
      }
      return acc;
    }, {
      qty_passed: 0,
      qty_rejected: 0,
      total_commission: 0,
      products_with_activity: 0
    });

    res.json({
      rows,
      totals,
      month: req.query.month ? Number.parseInt(req.query.month, 10) : null,
      year: req.query.year ? Number.parseInt(req.query.year, 10) : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el panel de microfabrica' });
  }
});

router.get('/api/qc/commissions', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    await ensureQcProductSettingsSeeded();
    const settingsMap = await loadQcSettingsMap();
    const productCatalog = await loadProductCatalogRows();
    const rows = productCatalog.map((item) => {
      const settings = settingsMap.get(String(item.sku || '').toUpperCase()) || { base_price: 0, commission_rate: 0 };
      return {
        sku: item.sku,
        name: item.name,
        base_price: Number(settings.base_price || 0),
        commission_rate: Number(settings.commission_rate || 0)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar comisiones por producto de control de calidad' });
  }
});

router.patch('/api/qc/commissions', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No se enviaron filas para actualizar' });
  }

  try {
    await ensureQcProductSettingsSeeded();
    const productNameMap = await loadProductNameMap();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const sku = String(row?.sku || '').toUpperCase().trim();
        if (!sku || !productNameMap.has(sku)) continue;
        const rate = Math.max(0, Math.min(100, Number(row?.commission_rate || 0)));
        const basePrice = Math.max(0, Number(row?.base_price || 0));
        await client.query(
          `INSERT INTO quality_control_settings (sku, base_price, commission_rate, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (sku) DO UPDATE
           SET base_price = EXCLUDED.base_price,
               commission_rate = EXCLUDED.commission_rate,
               updated_at = NOW()`,
          [sku, basePrice, rate]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ message: 'Comisiones por producto actualizadas' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron guardar comisiones de control de calidad' });
  }
});

module.exports = router;
