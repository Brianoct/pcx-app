const express = require('express');
const { pool } = require('../db');
const { isPgUndefinedTableError } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { canAccessPanel } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const {
  OPEN_STATUSES,
  buildPurchaseRequestRow,
  normalizeRequestPriority,
  normalizeRequestStatus,
  parsePositiveQuantity
} = require('../lib/procurement');

const router = express.Router();

const ensureComprasAccess = async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) {
    res.status(401).json({ error: 'Usuario no encontrado' });
    return null;
  }
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'compras_panel')) {
    res.status(403).json({ error: 'No tienes acceso a Compras' });
    return null;
  }
  return userContext;
};

const REQUEST_SELECT = `
  r.id, r.material_id, r.material_code, r.material_name, r.unit_measure,
  r.quantity, r.scan_count, r.status, r.priority, r.note, r.store_location,
  r.requested_by, requester.email AS requested_by_email,
  r.purchased_by, r.purchased_at, r.received_by, r.received_at,
  r.created_at, r.updated_at, m.supplier`;

const resolveMaterialByToken = async (token) => {
  const value = String(token || '').trim();
  if (!value) return null;
  const byToken = await pool.query(
    `SELECT id, code, name, unit_measure, reorder_qty, supplier, qr_token, is_active
     FROM production_material_catalog
     WHERE qr_token = $1`,
    [value]
  );
  if (byToken.rowCount > 0) return byToken.rows[0];
  // Fallback: allow scanning by material code (URL-safe) for resilience.
  const byCode = await pool.query(
    `SELECT id, code, name, unit_measure, reorder_qty, supplier, qr_token, is_active
     FROM production_material_catalog
     WHERE UPPER(code) = UPPER($1)`,
    [value]
  );
  return byCode.rows[0] || null;
};

const findOpenRequest = async (materialId) => {
  const res = await pool.query(
    `SELECT id, quantity, scan_count, status
     FROM material_purchase_requests
     WHERE material_id = $1 AND status = ANY($2::text[])
     ORDER BY id DESC
     LIMIT 1`,
    [materialId, OPEN_STATUSES]
  );
  return res.rows[0] || null;
};

// ─── Resolve a scanned material (any authenticated user) ─────────────────────
router.get('/api/procurement/materials/:token', authenticateToken, async (req, res) => {
  try {
    const material = await resolveMaterialByToken(req.params.token);
    if (!material) return res.status(404).json({ error: 'Material no encontrado' });
    const openRequest = await findOpenRequest(material.id);
    res.json({
      material: {
        id: Number(material.id),
        code: String(material.code || '').toUpperCase(),
        name: material.name,
        unit_measure: material.unit_measure,
        reorder_qty: Number(material.reorder_qty || 0),
        supplier: material.supplier || null,
        is_active: Boolean(material.is_active)
      },
      open_request: openRequest ? { id: Number(openRequest.id), quantity: Number(openRequest.quantity), scan_count: Number(openRequest.scan_count), status: openRequest.status } : null
    });
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.status(503).json({ error: 'Compras no inicializado. Falta aplicar migración.' });
    console.error('Resolve material error:', err);
    res.status(500).json({ error: 'No se pudo resolver el material' });
  }
});

// ─── Scan / add a material to the shopping list (any authenticated user) ──────
router.post('/api/procurement/scan', authenticateToken, async (req, res) => {
  const { token, material_id: materialIdRaw, quantity, note, store_location, priority } = req.body || {};
  try {
    let material = null;
    if (token) {
      material = await resolveMaterialByToken(token);
    } else if (materialIdRaw !== undefined) {
      const id = Number.parseInt(materialIdRaw, 10);
      if (Number.isInteger(id) && id > 0) {
        const r = await pool.query(
          `SELECT id, code, name, unit_measure, reorder_qty, supplier, is_active
           FROM production_material_catalog WHERE id = $1`,
          [id]
        );
        material = r.rows[0] || null;
      }
    }
    if (!material) return res.status(404).json({ error: 'Material no encontrado' });
    if (material.is_active === false) return res.status(400).json({ error: 'El material está inactivo' });

    const reorderQty = Number(material.reorder_qty || 0);
    const addQty = parsePositiveQuantity(quantity) || (reorderQty > 0 ? reorderQty : 1);
    const normalizedPriority = normalizeRequestPriority(priority) || 'normal';
    const noteText = note ? String(note).slice(0, 1000) : null;
    const location = store_location ? String(store_location).slice(0, 120) : null;

    const open = await findOpenRequest(material.id);
    let row;
    if (open) {
      // Two-bin: another empty bin for the same material accumulates on the card.
      const updated = await pool.query(
        `UPDATE material_purchase_requests
         SET quantity = quantity + $2,
             scan_count = scan_count + 1,
             priority = CASE WHEN $3 = 'urgent' THEN 'urgent' ELSE priority END,
             note = COALESCE($4, note),
             store_location = COALESCE($5, store_location),
             updated_at = NOW()
         WHERE id = $1
         RETURNING ${'id, material_id, material_code, material_name, unit_measure, quantity, scan_count, status, priority, note, store_location, requested_by, purchased_by, purchased_at, received_by, received_at, created_at, updated_at'}`,
        [open.id, addQty, normalizedPriority, noteText, location]
      );
      row = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO material_purchase_requests
           (material_id, material_code, material_name, unit_measure, quantity, scan_count,
            status, priority, note, store_location, requested_by)
         VALUES ($1, $2, $3, $4, $5, 1, 'pending', $6, $7, $8, $9)
         RETURNING id, material_id, material_code, material_name, unit_measure, quantity, scan_count, status, priority, note, store_location, requested_by, purchased_by, purchased_at, received_by, received_at, created_at, updated_at`,
        [material.id, String(material.code || '').toUpperCase(), material.name, material.unit_measure, addQty, normalizedPriority, noteText, location, req.user.id]
      );
      row = inserted.rows[0];
    }
    res.status(201).json({
      message: open ? 'Material actualizado en la lista de compras' : 'Material agregado a la lista de compras',
      request: buildPurchaseRequestRow({ ...row, supplier: material.supplier || null }),
      was_existing: Boolean(open)
    });
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.status(503).json({ error: 'Compras no inicializado. Falta aplicar migración.' });
    console.error('Procurement scan error:', err);
    res.status(500).json({ error: 'No se pudo agregar el material a compras' });
  }
});

// ─── Procurement board: list requests ────────────────────────────────────────
router.get('/api/procurement/requests', authenticateToken, async (req, res) => {
  if (!(await ensureComprasAccess(req, res))) return;
  const statusFilter = normalizeRequestStatus(req.query.status);
  try {
    const params = [];
    let whereSql = "WHERE r.status <> 'cancelled'";
    if (statusFilter) {
      params.push(statusFilter);
      whereSql = `WHERE r.status = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT ${REQUEST_SELECT}
       FROM material_purchase_requests r
       LEFT JOIN users requester ON requester.id = r.requested_by
       LEFT JOIN production_material_catalog m ON m.id = r.material_id
       ${whereSql}
       ORDER BY
         CASE r.status WHEN 'pending' THEN 1 WHEN 'purchased' THEN 2 WHEN 'received' THEN 3 ELSE 4 END,
         CASE r.priority WHEN 'urgent' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         r.created_at DESC`,
      params
    );
    res.json(result.rows.map(buildPurchaseRequestRow));
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.json([]);
    console.error('Procurement list error:', err);
    res.status(500).json({ error: 'No se pudo cargar la lista de compras' });
  }
});

// ─── Active materials (for manual add on the board) ──────────────────────────
router.get('/api/procurement/materials', authenticateToken, async (req, res) => {
  if (!(await ensureComprasAccess(req, res))) return;
  try {
    const result = await pool.query(
      `SELECT id, code, name, unit_measure, reorder_qty, supplier, qr_token
       FROM production_material_catalog
       WHERE is_active = TRUE
       ORDER BY UPPER(name) ASC, UPPER(code) ASC`
    );
    res.json(result.rows.map((row) => ({
      id: Number(row.id),
      code: String(row.code || '').toUpperCase(),
      name: row.name,
      unit_measure: row.unit_measure,
      reorder_qty: Number(row.reorder_qty || 0),
      supplier: row.supplier || null,
      qr_token: row.qr_token
    })));
  } catch (err) {
    if (isPgUndefinedTableError(err)) return res.json([]);
    console.error('Procurement materials error:', err);
    res.status(500).json({ error: 'No se pudieron cargar los materiales' });
  }
});

// ─── Update a request (status / quantity / priority / note) ──────────────────
router.patch('/api/procurement/requests/:id', authenticateToken, async (req, res) => {
  const userContext = await ensureComprasAccess(req, res);
  if (!userContext) return;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  const sets = [];
  const values = [];
  const assign = (col, val) => { values.push(val); sets.push(`${col} = $${values.length}`); };

  if (req.body?.status !== undefined) {
    const status = normalizeRequestStatus(req.body.status);
    if (!status) return res.status(400).json({ error: 'Estado inválido' });
    assign('status', status);
    if (status === 'purchased') {
      assign('purchased_by', req.user.id);
      sets.push('purchased_at = NOW()');
    } else if (status === 'received') {
      assign('received_by', req.user.id);
      sets.push('received_at = NOW()');
    }
  }
  if (req.body?.quantity !== undefined) {
    const qty = parsePositiveQuantity(req.body.quantity);
    if (qty === null) return res.status(400).json({ error: 'Cantidad inválida' });
    assign('quantity', qty);
  }
  if (req.body?.priority !== undefined) {
    const priority = normalizeRequestPriority(req.body.priority);
    if (!priority) return res.status(400).json({ error: 'Prioridad inválida' });
    assign('priority', priority);
  }
  if (req.body?.note !== undefined) {
    assign('note', req.body.note ? String(req.body.note).slice(0, 1000) : null);
  }
  if (req.body?.store_location !== undefined) {
    assign('store_location', req.body.store_location ? String(req.body.store_location).slice(0, 120) : null);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No se enviaron cambios' });

  sets.push('updated_at = NOW()');
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE material_purchase_requests SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, material_id, material_code, material_name, unit_measure, quantity, scan_count, status, priority, note, store_location, requested_by, purchased_by, purchased_at, received_by, received_at, created_at, updated_at`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    res.json({ message: 'Solicitud actualizada', request: buildPurchaseRequestRow(result.rows[0]) });
  } catch (err) {
    console.error('Procurement update error:', err);
    res.status(500).json({ error: 'No se pudo actualizar la solicitud' });
  }
});

// ─── Delete a request ────────────────────────────────────────────────────────
router.delete('/api/procurement/requests/:id', authenticateToken, async (req, res) => {
  if (!(await ensureComprasAccess(req, res))) return;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await pool.query('DELETE FROM material_purchase_requests WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    res.json({ message: 'Solicitud eliminada', id });
  } catch (err) {
    console.error('Procurement delete error:', err);
    res.status(500).json({ error: 'No se pudo eliminar la solicitud' });
  }
});

module.exports = router;
