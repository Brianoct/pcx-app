const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const normalizeRole = (value = '') =>
  value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const COMPLETED_STATUSES = ['Confirmado', 'Pagado', 'Embalado', 'Enviado'];

const buildDateFilter = (month, year, tableAlias = 'q', startIndex = 1) => {
  const params = [];
  const clauses = [];

  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;

  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    return { error: 'Mes inválido. Debe estar entre 1 y 12' };
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    return { error: 'Año inválido' };
  }

  if (monthNum !== null) {
    params.push(monthNum);
    clauses.push(`EXTRACT(MONTH FROM ${tableAlias}.created_at) = $${startIndex + params.length - 1}`);
  }
  if (yearNum !== null) {
    params.push(yearNum);
    clauses.push(`EXTRACT(YEAR FROM ${tableAlias}.created_at) = $${startIndex + params.length - 1}`);
  }

  const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  return { params, sql };
};

// Middleware: Verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Middleware: Require specific role (case-insensitive + accent-insensitive)
const requireRole = (roles) => (req, res, next) => {
  const userRole = normalizeRole(req.user.role || '');
  const allowed = roles.map((r) => normalizeRole(r));
  if (!allowed.includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// ─── REGISTER new user (admin only) ────────────────────────────────────────
app.post('/api/register', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone) VALUES ($1, $2, $3, $4, $5)',
      [email, hashedPass, role, city || null, phone || null]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── LOGIN ──────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, city: user.city, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        city: user.city,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── SAVE new quote ─────────────────────────────────────────────────────────
app.post('/api/quotes', authenticateToken, async (req, res) => {
  const { 
    customer_name, 
    customer_phone, 
    department, 
    provincia, 
    shipping_notes, 
    store_location, 
    vendor, 
    venta_type, 
    discount_percent, 
    rows, 
    subtotal, 
    total,
    status = 'Cotizado'
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineItemsWithDisplay = rows.map(row => ({
      ...row,
      displayName: row.displayName || row.sku || 'Producto desconocido'
    }));

    const quoteResult = await client.query(
      `INSERT INTO quotes (
        user_id, customer_name, customer_phone, department, provincia, shipping_notes,
        store_location, vendor, venta_type, discount_percent, line_items, subtotal, 
        total, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING id`,
      [
        req.user.id,
        customer_name,
        customer_phone,
        department,
        provincia,
        shipping_notes,
        store_location,
        vendor,
        venta_type,
        discount_percent,
        JSON.stringify(lineItemsWithDisplay),
        subtotal,
        total,
        status
      ]
    );

    const quoteId = quoteResult.rows[0].id;

    // Only deduct stock if initial status is NOT 'Cotizado'
    if (status !== 'Cotizado') {
      await deductStockForQuote(client, quoteId, store_location, lineItemsWithDisplay);
    }

    await client.query('COMMIT');
    res.status(201).json({ id: quoteId, message: 'Cotización guardada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al guardar cotización' });
  } finally {
    client.release();
  }
});

// ─── GET quotes (personal or team) ──────────────────────────────────────────
app.get('/api/quotes', authenticateToken, async (req, res) => {
  const { team } = req.query;
  const isTeamView = team === 'true';

  const allowedTeamRoles = ['ventas lider', 'admin', 'almacen lider', 'almacen'];
  const userRoleNormalized = normalizeRole(req.user.role || '');

  if (isTeamView && !allowedTeamRoles.includes(userRoleNormalized)) {
    return res.status(403).json({ error: 'Solo Ventas Líder, Admin o Almacén Líder pueden ver cotizaciones del equipo' });
  }

  try {
    const result = await pool.query(
      isTeamView 
        ? `SELECT id, user_id, customer_name, customer_phone, department, provincia, shipping_notes,
                  store_location, vendor, venta_type, discount_percent, line_items, subtotal, 
                  total, status, created_at 
           FROM quotes 
           ORDER BY created_at DESC`
        : `SELECT id, user_id, customer_name, customer_phone, department, provincia, shipping_notes,
                  store_location, vendor, venta_type, discount_percent, line_items, subtotal, 
                  total, status, created_at 
           FROM quotes 
           WHERE user_id = $1 
           ORDER BY created_at DESC`,
      isTeamView ? [] : [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ─── GET single quote for checklist with displayName ────────────────────────
app.get('/api/quotes/:id/checklist', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const canAccessAllQuotes = ['ventas lider', 'admin', 'almacen lider', 'almacen'].includes(userRoleNormalized);

  try {
    const result = await pool.query(
      `SELECT id, user_id, customer_name, customer_phone, department, provincia, store_location, 
              vendor, status, line_items, created_at
       FROM quotes WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const quote = result.rows[0];
    if (!canAccessAllQuotes && quote.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este pedido' });
    }

    const items = quote.line_items.map(row => ({
      displayName: row.displayName || row.sku || 'Producto desconocido',
      qty: row.qty || 1
    }));

    res.json({
      id: quote.id,
      customer_name: quote.customer_name,
      customer_phone: quote.customer_phone,
      department: quote.department,
      provincia: quote.provincia,
      store_location: quote.store_location,
      vendor: quote.vendor,
      status: quote.status,
      created_at: quote.created_at,
      items
    });
  } catch (err) {
    console.error('Error fetching checklist:', err);
    res.status(500).json({ error: 'Error al obtener checklist' });
  }
});

// ─── UPDATE quote status (deduct stock only from Cotizado → other) ──────────
app.patch('/api/quotes/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Cotizado', 'Confirmado', 'Pagado', 'Embalado', 'Enviado'];
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const canManageAnyQuote = ['ventas lider', 'admin', 'almacen lider', 'almacen'].includes(userRoleNormalized);

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${validStatuses.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      'SELECT user_id, status, store_location, line_items FROM quotes WHERE id = $1',
      [req.params.id]
    );

    if (currentRes.rowCount === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    if (!canManageAnyQuote && currentRes.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para actualizar este pedido' });
    }

    const currentStatus = currentRes.rows[0].status;
    const storeLocation = currentRes.rows[0].store_location;
    const lineItems = currentRes.rows[0].line_items;

    // Deduct stock only if moving FROM Cotizado to something else
    if (currentStatus === 'Cotizado' && status !== 'Cotizado') {
      await deductStockForQuote(client, req.params.id, storeLocation, lineItems);
    }

    const updateRes = await client.query(
      'UPDATE quotes SET status = $1 WHERE id = $2 RETURNING status',
      [status, req.params.id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Estado actualizado', status: updateRes.rows[0].status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al actualizar estado' });
  } finally {
    client.release();
  }
});

// ─── Helper: Deduct stock for a quote ───────────────────────────────────────
async function deductStockForQuote(client, quoteId, storeLocation, lineItems) {
  const warehouseField = {
    'Cochabamba': 'stock_cochabamba',
    'Santa Cruz': 'stock_santacruz',
    'Lima': 'stock_lima'
  }[storeLocation];

  if (!warehouseField) throw new Error('Almacén no válido');

  for (const row of lineItems) {
    if (row.isCombo) {
      for (const comboItem of row.comboItems || []) {
        const sku = comboItem.sku;
        const qty = comboItem.quantity * (row.qty || 1);

        const stockCheck = await client.query(
          `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
          [sku]
        );

        if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
        const currentStock = stockCheck.rows[0][warehouseField];

        if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

        await client.query(
          `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
          [qty, sku]
        );
      }
    } else {
      const sku = row.sku;
      const qty = row.qty;

      const stockCheck = await client.query(
        `SELECT ${warehouseField} FROM products WHERE sku = $1 FOR UPDATE`,
        [sku]
      );

      if (stockCheck.rowCount === 0) throw new Error(`Producto ${sku} no encontrado`);
      const currentStock = stockCheck.rows[0][warehouseField];

      if (currentStock < qty) throw new Error(`Stock insuficiente para ${sku}`);

      await client.query(
        `UPDATE products SET ${warehouseField} = ${warehouseField} - $1, last_updated = NOW() WHERE sku = $2`,
        [qty, sku]
      );
    }
  }
}

// ─── GET stock for a SKU in a specific store ───────────────────────────────
app.get('/api/stock', authenticateToken, async (req, res) => {
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
app.patch('/api/products/:sku/stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen']), async (req, res) => {
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

// ─── MARKETING: Combos ──────────────────────────────────────────────────────

// GET all combos with items
app.get('/api/combos', authenticateToken, async (req, res) => {
  try {
    const combosResult = await pool.query(`
      SELECT 
        c.id, c.name, c.sf_price, c.cf_price, c.created_at,
        u.email as created_by_email
      FROM combos c
      LEFT JOIN users u ON c.created_by = u.id
      ORDER BY c.created_at DESC
    `);

    const combos = combosResult.rows;

    for (let combo of combos) {
      const itemsResult = await pool.query(`
        SELECT sku, quantity
        FROM combo_items
        WHERE combo_id = $1
      `, [combo.id]);
      combo.items = itemsResult.rows;
    }

    res.json(combos);
  } catch (err) {
    console.error('Error fetching combos:', err);
    res.status(500).json({ error: 'Failed to load combos' });
  }
});

// POST create new combo
app.post('/api/combos', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { name, sf, cf, products } = req.body;

  if (!name || !sf || !cf || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Missing required fields or empty products' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const comboRes = await client.query(
      'INSERT INTO combos (name, sf_price, cf_price, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, sf, cf, req.user.id]
    );
    const comboId = comboRes.rows[0].id;

    for (const item of products) {
      const { sku, quantity = 1 } = item;
      await client.query(
        'INSERT INTO combo_items (combo_id, sku, quantity) VALUES ($1, $2, $3)',
        [comboId, sku, quantity]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: comboId, message: 'Combo created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating combo:', err);
    res.status(500).json({ error: 'Failed to create combo' });
  } finally {
    client.release();
  }
});

// DELETE combo
app.delete('/api/combos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const comboRes = await pool.query('SELECT created_by FROM combos WHERE id = $1', [id]);
    if (comboRes.rowCount === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    const creatorId = comboRes.rows[0].created_by;
    const isAdmin = req.user.role.toLowerCase() === 'admin';
    if (creatorId !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to delete this combo' });
    }

    await pool.query('DELETE FROM combos WHERE id = $1', [id]);
    res.json({ message: 'Combo deleted' });
  } catch (err) {
    console.error('Error deleting combo:', err);
    res.status(500).json({ error: 'Failed to delete combo' });
  }
});

// ─── CUPONES ────────────────────────────────────────────────────────────────

// GET all coupons
app.get('/api/cupones', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, code, discount_percent, valid_until, created_at FROM cupones ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cupones:', err);
    res.status(500).json({ error: 'Failed to load cupones' });
  }
});

// POST create new coupon
app.post('/api/cupones', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { code, discount_percent, valid_until } = req.body;

  if (!code || !discount_percent || !valid_until) {
    return res.status(400).json({ error: 'Faltan campos requeridos: code, discount_percent, valid_until' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO cupones (code, discount_percent, valid_until, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [code.toUpperCase(), discount_percent, valid_until, req.user.id]
    );
    res.status(201).json({ id: result.rows[0].id, message: 'Cupón creado' });
  } catch (err) {
    console.error('Error creating cupón:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código ya existe' });
    }
    res.status(500).json({ error: 'Error al crear cupón' });
  }
});

// DELETE coupon
app.delete('/api/cupones/:id', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM cupones WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    res.json({ message: 'Cupón eliminado' });
  } catch (err) {
    console.error('Error deleting cupón:', err);
    res.status(500).json({ error: 'Error al eliminar cupón' });
  }
});

// ─── USER MANAGEMENT (admin only) ────────────────────────────────────────────
app.get('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, city, phone, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'Missing required fields' });

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone) VALUES ($1, $2, $3, $4, $5)',
      [email, hashedPass, role, city || null, phone || null]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.patch('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { role, city, phone } = req.body;
  if (!role) return res.status(400).json({ error: 'Role is required' });

  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const cityProvided = Object.prototype.hasOwnProperty.call(req.body, 'city');
  const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const cityValue = city === '' ? null : city;
  const phoneValue = phone === '' ? null : phone;

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           city = CASE WHEN $2::boolean THEN $3 ELSE city END,
           phone = CASE WHEN $4::boolean THEN $5 ELSE phone END
       WHERE id = $6
       RETURNING id`,
      [role, cityProvided, cityValue, phoneProvided, phoneValue, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ─── Performance ────────────────────────────────────────────────────────────
app.get('/api/performance', authenticateToken, async (req, res) => {
  const { team, month, year } = req.query;
  const isTeamView = team === 'true';
  const userRoleNormalized = normalizeRole(req.user.role || '');

  if (isTeamView && !['ventas lider', 'admin'].includes(userRoleNormalized)) {
    return res.status(403).json({ error: 'Solo Ventas Líder o Admin pueden ver rendimiento del equipo' });
  }
  const dateFilter = buildDateFilter(month, year, 'q', 2);
  if (dateFilter.error) return res.status(400).json({ error: dateFilter.error });

  try {
    if (isTeamView) {
      const queryText = `
        SELECT 
          u.id as user_id,
          u.email as usuario,
          u.role as rol,
          COUNT(q.id) FILTER (WHERE q.status = ANY($1::text[])) as cotizaciones_confirmadas,
          COALESCE(SUM(q.total) FILTER (WHERE q.status = ANY($1::text[])), 0) as ventas_totales
        FROM users u
        LEFT JOIN quotes q ON u.id = q.user_id${dateFilter.sql}
        WHERE u.role ILIKE '%ventas%' OR u.role ILIKE '%sales%' OR u.role ILIKE '%vendedor%'
        GROUP BY u.id, u.email, u.role
        ORDER BY ventas_totales DESC
      `;
      const result = await pool.query(queryText, [COMPLETED_STATUSES, ...dateFilter.params]);
      res.json(result.rows || []);
    } else {
      const personalDateFilter = buildDateFilter(month, year, 'q', 3);
      if (personalDateFilter.error) return res.status(400).json({ error: personalDateFilter.error });
      const personalParams = [req.user.id, COMPLETED_STATUSES, ...personalDateFilter.params];
      const result = await pool.query(
        `SELECT 
          COUNT(id) FILTER (WHERE status = ANY($2::text[])) as cotizaciones_confirmadas,
          COALESCE(SUM(total) FILTER (WHERE status = ANY($2::text[])), 0) as ventas_totales
        FROM quotes q
        WHERE user_id = $1${personalDateFilter.sql}`,
        personalParams
      );
      res.json(result.rows[0] || { cotizaciones_confirmadas: 0, ventas_totales: 0 });
    }
  } catch (err) {
    console.error('Performance endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener rendimiento: ' + err.message });
  }
});

// ─── Current user commission (nav box) ──────────────────────────────────────
app.get('/api/commission/current', authenticateToken, async (req, res) => {
  const { month, year } = req.query;
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === 'admin';
  const isVentasLider = userRoleNormalized.includes('ventas lider');
  const isMarketingLider = userRoleNormalized.includes('marketing lider');
  const isSalesSeller = ['ventas', 'sales', 'vendedor'].includes(userRoleNormalized);

  const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
  if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });
  const teamDateFilter = buildDateFilter(month, year, 'q', 3);
  if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });
  const ownDateFilter = buildDateFilter(month, year, 'q', 3);
  if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });

  try {
    // Admins do not receive commission.
    if (isAdmin) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role || 'Admin', rate: 0, source: 'No aplica para Admin' }
      });
    }

    // Total completed sales in period (used by leader/marketing rules).
    const allSalesRes = await pool.query(
      `SELECT COALESCE(SUM(q.total), 0) AS total_sales
       FROM quotes q
       WHERE q.status = ANY($1::text[])${allSalesDateFilter.sql}`,
      [COMPLETED_STATUSES, ...allSalesDateFilter.params]
    );
    const allSales = Number(allSalesRes.rows[0]?.total_sales || 0);

    if (isMarketingLider) {
      return res.json({
        commission: allSales * 0.05,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0.05, source: '5% de todas las ventas' }
      });
    }

    if (isVentasLider) {
      // Ventas Lider: 5% on own sales + all users with exactly Ventas role.
      const teamSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND (LOWER(u.role) = 'ventas' OR u.id = $2)${teamDateFilter.sql}`,
        [COMPLETED_STATUSES, req.user.id, ...teamDateFilter.params]
      );
      const teamSales = Number(teamSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: teamSales * 0.05,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0.05, source: '5% ventas equipo + propias' }
      });
    }

    // Sales users: top seller gets 12%, all others 8%.
    if (isSalesSeller) {
      const ownSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.user_id = $1
           AND q.status = ANY($2::text[])${ownDateFilter.sql}`,
        [req.user.id, COMPLETED_STATUSES, ...ownDateFilter.params]
      );
      const ownSales = Number(ownSalesRes.rows[0]?.total_sales || 0);

      const rankingRes = await pool.query(
        `SELECT
           u.id AS user_id,
           u.email AS email,
           COALESCE(SUM(q.total), 0) AS total_sales
         FROM users u
         LEFT JOIN quotes q
           ON q.user_id = u.id
           AND q.status = ANY($1::text[])${allSalesDateFilter.sql}
         WHERE LOWER(u.role) IN ('ventas', 'sales', 'vendedor')
         GROUP BY u.id, u.email
         ORDER BY total_sales DESC, u.id ASC
         LIMIT 1`,
        [COMPLETED_STATUSES, ...allSalesDateFilter.params]
      );

      const topSeller = rankingRes.rows[0] || null;
      const topSellerId = topSeller ? Number(topSeller.user_id) : null;
      const isTopSeller = topSellerId === Number(req.user.id) && Number(topSeller.total_sales || 0) > 0;
      const rate = isTopSeller ? 0.12 : 0.08;

      return res.json({
        commission: ownSales * rate,
        isTopSeller,
        topSellerEmail: topSeller?.email || null,
        breakdown: { role: req.user.role, rate, source: '12% top seller / 8% resto' }
      });
    }

    // Non-sales roles without explicit commission rule.
    return res.json({
      commission: 0,
      isTopSeller: false,
      topSellerEmail: null,
      breakdown: { role: req.user.role || 'Sin rol', rate: 0, source: 'Rol sin comisión configurada' }
    });
  } catch (err) {
    console.error('Commission endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al calcular comisión: ' + err.message });
  }
});

// ─── INVENTORY ──────────────────────────────────────────────────────────────
app.get('/api/products', authenticateToken, requireRole(['Almacen Lider', 'Almacen']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sku, name, stock_cochabamba, stock_santacruz, stock_lima, last_updated 
      FROM products 
      ORDER BY sku
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

// ─── ADMIN DASHBOARD STATISTICS ─────────────────────────────────────────────
app.get('/api/admin/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { month, year } = req.query;
  const monthNum = month !== undefined ? Number.parseInt(month, 10) : null;
  const yearNum = year !== undefined ? Number.parseInt(year, 10) : null;

  if (month !== undefined && (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)) {
    return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
  }
  if (year !== undefined && (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 3000)) {
    return res.status(400).json({ error: 'Año inválido' });
  }

  const params = [];
  const dateClauses = [];
  if (monthNum !== null) {
    params.push(monthNum);
    dateClauses.push(`EXTRACT(MONTH FROM q.created_at) = $${params.length}`);
  }
  if (yearNum !== null) {
    params.push(yearNum);
    dateClauses.push(`EXTRACT(YEAR FROM q.created_at) = $${params.length}`);
  }
  const dateFilter = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';

  try {
    // 1. Most popular products
    const popularRes = await pool.query(`
      SELECT 
        li->>'sku' as sku,
        li->>'displayName' as name,
        SUM(CAST(li->>'qty' AS INTEGER)) as total_quantity
      FROM quotes q,
      LATERAL jsonb_array_elements(q.line_items) li
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY sku, name
      ORDER BY total_quantity DESC
      LIMIT 10
    `, params);

    // 2. Top salespeople
    const salesRes = await pool.query(`
      SELECT 
        q.vendor,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY q.vendor
      ORDER BY total_sales DESC
      LIMIT 10
    `, params);

    // 3. Top locations (departamento/provincia)
    const locRes = await pool.query(`
      SELECT 
        COALESCE(q.provincia, q.department, 'Sin ubicación') as location,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY location
      ORDER BY total_sales DESC
    `, params);

    // 4. Top almacenes by traffic (order count)
    const whRes = await pool.query(`
      SELECT 
        q.store_location,
        COUNT(*) as order_count,
        SUM(q.total) as total_sales
      FROM quotes q
      WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
        ${dateFilter}
      GROUP BY q.store_location
      ORDER BY order_count DESC
    `, params);

    res.json({
      popularProducts: popularRes.rows,
      topSalespeople: salesRes.rows,
      topLocations: locRes.rows,
      topWarehouses: whRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});