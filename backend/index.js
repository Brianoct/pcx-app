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

const normalizeText = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
const normalizeRole = (value = '') => normalizeText(value);
const COMPLETED_STATUSES = ['Confirmado', 'Pagado', 'Embalado', 'Enviado'];
const PANEL_KEYS = [
  'cotizar',
  'historial_individual',
  'historial_global',
  'rendimiento_individual',
  'rendimiento_global',
  'pedidos_individual',
  'pedidos_global',
  'inventario_individual',
  'inventario_global',
  'marketing_combos',
  'marketing_cupones',
  'admin'
];

const getDefaultPanelAccessForRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  const base = {
    cotizar: false,
    historial_individual: false,
    historial_global: false,
    rendimiento_individual: false,
    rendimiento_global: false,
    pedidos_individual: false,
    pedidos_global: false,
    inventario_individual: false,
    inventario_global: false,
    marketing_combos: false,
    marketing_cupones: false,
    admin: false
  };

  if (role === 'admin') {
    return Object.fromEntries(Object.keys(base).map((key) => [key, true]));
  }

  if (role === 'ventas') {
    return {
      ...base,
      cotizar: true,
      historial_individual: true,
      rendimiento_individual: true
    };
  }

  if (role === 'ventas lider') {
    return {
      ...base,
      cotizar: true,
      historial_global: true,
      rendimiento_global: true
    };
  }

  if (role === 'almacen') {
    return {
      ...base,
      pedidos_individual: true,
      inventario_individual: true
    };
  }

  if (role === 'almacen lider') {
    return {
      ...base,
      pedidos_global: true,
      inventario_global: true
    };
  }

  if (role === 'marketing') {
    return {
      ...base,
      marketing_combos: true,
      marketing_cupones: true
    };
  }

  if (role === 'marketing lider') {
    return {
      ...base,
      marketing_combos: true,
      marketing_cupones: true
    };
  }

  if (role === 'microfabrica lider' || role === 'microfabrica') {
    return {
      ...base
    };
  }

  return base;
};

const DEFAULT_ROLE_ACCESS = {
  Ventas: getDefaultPanelAccessForRole('Ventas'),
  'Ventas Lider': getDefaultPanelAccessForRole('Ventas Lider'),
  Almacen: getDefaultPanelAccessForRole('Almacen'),
  'Almacen Lider': getDefaultPanelAccessForRole('Almacen Lider'),
  'Microfabrica Lider': getDefaultPanelAccessForRole('Microfabrica Lider'),
  Microfabrica: getDefaultPanelAccessForRole('Microfabrica'),
  Marketing: getDefaultPanelAccessForRole('Marketing'),
  'Marketing Lider': getDefaultPanelAccessForRole('Marketing Lider'),
  Admin: getDefaultPanelAccessForRole('Admin')
};

const sanitizePanelAccess = (panelAccess, roleValue = '') => {
  const defaults = getDefaultPanelAccessForRole(roleValue);
  if (!panelAccess || typeof panelAccess !== 'object' || Array.isArray(panelAccess)) {
    return defaults;
  }

  return Object.fromEntries(
    PANEL_KEYS.map((key) => [key, Boolean(panelAccess[key] ?? defaults[key])])
  );
};

const canAccessPanel = (panelAccess, roleValue, key) => {
  const effective = sanitizePanelAccess(panelAccess, roleValue);
  return Boolean(effective[key]);
};

const ROLE_DEFAULT_ROLES = [
  'Ventas',
  'Ventas Lider',
  'Almacen',
  'Almacen Lider',
  'Microfabrica Lider',
  'Microfabrica',
  'Marketing',
  'Marketing Lider',
  'Admin'
];

const ROLE_KEYS = {
  admin: 'admin',
  ventasLider: 'ventas lider',
  ventas: 'ventas',
  almacenLider: 'almacen lider',
  almacen: 'almacen',
  marketingLider: 'marketing lider',
  marketing: 'marketing',
  microfabricaLider: 'microfabrica lider',
  microfabrica: 'microfabrica'
};

const COMMISSION_SETTINGS_DEFAULT = {
  ventas_lider_percent: 5,
  ventas_top_percent: 12,
  ventas_regular_percent: 8,
  almacen_percent: 5,
  marketing_lider_percent: 5
};

const clampPercent = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

const sanitizeCommissionSettings = (raw = {}) => {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    ventas_lider_percent: clampPercent(src.ventas_lider_percent, COMMISSION_SETTINGS_DEFAULT.ventas_lider_percent),
    ventas_top_percent: clampPercent(src.ventas_top_percent, COMMISSION_SETTINGS_DEFAULT.ventas_top_percent),
    ventas_regular_percent: clampPercent(src.ventas_regular_percent, COMMISSION_SETTINGS_DEFAULT.ventas_regular_percent),
    almacen_percent: clampPercent(src.almacen_percent, COMMISSION_SETTINGS_DEFAULT.almacen_percent),
    marketing_lider_percent: clampPercent(src.marketing_lider_percent, COMMISSION_SETTINGS_DEFAULT.marketing_lider_percent)
  };
};

const loadCommissionSettings = async () => {
  const result = await pool.query(
    `SELECT settings
     FROM commission_settings
     ORDER BY id DESC
     LIMIT 1`
  );
  if (result.rowCount === 0) {
    return sanitizeCommissionSettings(COMMISSION_SETTINGS_DEFAULT);
  }
  return sanitizeCommissionSettings(result.rows[0]?.settings || {});
};

const INVENTORY_CITY_SCOPE = {
  cochabamba: {
    canonical: 'Cochabamba',
    stockField: 'stock_cochabamba',
    minField: 'min_stock_cochabamba',
    aliases: ['cochabamba', 'cbba']
  },
  'santa cruz': {
    canonical: 'Santa Cruz',
    stockField: 'stock_santacruz',
    minField: 'min_stock_santacruz',
    aliases: ['santa cruz', 'santacruz', 'scz']
  },
  lima: {
    canonical: 'Lima',
    stockField: 'stock_lima',
    minField: 'min_stock_lima',
    aliases: ['lima']
  }
};

const resolveInventoryScopeByCity = (cityValue = '') => {
  const normalized = normalizeText(cityValue);
  if (!normalized) return null;
  return Object.values(INVENTORY_CITY_SCOPE).find((entry) => entry.aliases.includes(normalized)) || null;
};

const getInventoryAccessScope = (userContext, access) => {
  const hasGlobalInventory = Boolean(access?.inventario_global);
  const hasIndividualInventory = Boolean(access?.inventario_individual);
  if (!hasGlobalInventory && !hasIndividualInventory) {
    return { error: 'No tienes permiso de inventario' };
  }
  if (hasGlobalInventory) {
    return { isGlobal: true, scope: null };
  }
  const scope = resolveInventoryScopeByCity(userContext?.city || '');
  if (!scope) {
    return { error: 'Tu usuario no tiene ciudad válida configurada para inventario individual' };
  }
  return { isGlobal: false, scope };
};

const getPedidosAccessScope = (userContext, access) => {
  const hasGlobalPedidos = Boolean(access?.pedidos_global || access?.historial_global);
  const hasIndividualPedidos = Boolean(access?.pedidos_individual);
  const hasHistorialIndividual = Boolean(access?.historial_individual);
  if (!hasGlobalPedidos && !hasIndividualPedidos && !hasHistorialIndividual) {
    return { error: 'No tienes permiso de pedidos' };
  }
  if (hasGlobalPedidos) {
    return { isGlobal: true, city: null };
  }
  const scope = resolveInventoryScopeByCity(userContext?.city || '');
  if (!scope) {
    return { error: 'Tu usuario no tiene ciudad válida configurada para pedidos individuales' };
  }
  return { isGlobal: false, city: scope.canonical };
};

const mergeAccessWithDefaults = (baseRole, panelAccess) => {
  const defaults = getDefaultPanelAccessForRole(baseRole);
  const merged = { ...defaults };
  if (!panelAccess || typeof panelAccess !== 'object' || Array.isArray(panelAccess)) {
    return merged;
  }
  for (const key of PANEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(panelAccess, key)) {
      merged[key] = Boolean(panelAccess[key]);
    }
  }
  return merged;
};

const buildUserPayload = (userRow) => {
  const panel_access = sanitizePanelAccess(userRow.panel_access, userRow.role);
  return {
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    city: userRow.city,
    phone: userRow.phone,
    panel_access
  };
};

const loadUserContext = async (userId) => {
  const result = await pool.query(
    'SELECT id, email, role, city, phone, panel_access FROM users WHERE id = $1',
    [userId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

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
  if (!token) return res.status(401).json({ error: 'No se proporcionó token' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Middleware: Require specific role (case-insensitive + accent-insensitive)
const requireRole = (roles) => (req, res, next) => {
  const userRole = normalizeRole(req.user.role || '');
  const allowed = roles.map((r) => normalizeRole(r));
  if (!allowed.includes(userRole)) {
    return res.status(403).json({ error: 'Permisos insuficientes' });
  }
  next();
};

// ─── REGISTER new user (admin only) ────────────────────────────────────────
app.post('/api/register', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
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
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'Registro fallido' });
  }
});

// ─── LOGIN ──────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan correo o contraseña' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const tokenUser = buildUserPayload(user);
    const token = jwt.sign(
      {
        id: tokenUser.id,
        email: tokenUser.email,
        role: tokenUser.role,
        city: tokenUser.city,
        phone: tokenUser.phone,
        panel_access: tokenUser.panel_access
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: tokenUser
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Inicio de sesión fallido' });
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
    alternative_name,
    alternative_phone,
    store_location, 
    vendor, 
    venta_type, 
    discount_percent, 
    rows, 
    subtotal, 
    total,
    status = 'Cotizado'
  } = req.body;

  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (!canAccessPanel(userContext.panel_access, userContext.role, 'cotizar')) {
    return res.status(403).json({ error: 'No tienes permiso para cotizar' });
  }

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
        alternative_name, alternative_phone, store_location, vendor, venta_type, discount_percent, line_items, subtotal, 
        total, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id`,
      [
        req.user.id,
        customer_name,
        customer_phone,
        department,
        provincia,
        shipping_notes,
        alternative_name || null,
        alternative_phone || null,
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
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const hasAnyPedidosAccess = Boolean(access.pedidos_individual || access.pedidos_global);
  const pedidosScope = hasAnyPedidosAccess ? getPedidosAccessScope(userContext, access) : null;
  if (hasAnyPedidosAccess && pedidosScope?.error) return res.status(403).json({ error: pedidosScope.error });

  if (isTeamView) {
    const canSeeGlobalHistory = access.historial_global || access.pedidos_global;
    if (!canSeeGlobalHistory) {
      return res.status(403).json({ error: 'No tienes permiso para historial/pedidos global' });
    }
  } else {
    const canSeeOwnHistory = access.historial_individual || access.pedidos_individual;
    if (!canSeeOwnHistory) {
      return res.status(403).json({ error: 'No tienes permiso para historial/pedidos individual' });
    }
  }

  try {
    let query = '';
    let params = [];

    if (isTeamView) {
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               ORDER BY q.created_at DESC`;
      params = [];
    } else if (access.pedidos_individual && !access.historial_individual && !pedidosScope.isGlobal) {
      // Pedidos individual: scope by assigned city/store.
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               WHERE q.store_location = $1
               ORDER BY q.created_at DESC`;
      params = [pedidosScope.city];
    } else {
      // Historial individual: own quotes only.
      query = `SELECT q.id, q.user_id, q.customer_name, q.customer_phone, q.department, q.provincia, q.shipping_notes,
                      q.alternative_name, q.alternative_phone,
                      q.store_location, q.vendor, q.venta_type, q.discount_percent, q.line_items, q.subtotal,
                      q.total, q.status, q.created_at, u.phone AS vendor_phone, u.phone AS seller_phone
               FROM quotes q
               LEFT JOIN users u ON u.id = q.user_id
               WHERE q.user_id = $1
               ORDER BY q.created_at DESC`;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ─── GET seller contact by quote id (team roles) ───────────────────────────
app.get('/api/quotes/:id/seller-contact', authenticateToken, async (req, res) => {
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const canAccessAllQuotes = ['ventas lider', 'admin', 'almacen lider', 'almacen'].includes(userRoleNormalized);

  try {
    const result = await pool.query(
      `SELECT q.user_id, u.email AS seller_email, u.phone AS seller_phone
       FROM quotes q
       LEFT JOIN users u ON u.id = q.user_id
       WHERE q.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const row = result.rows[0];
    if (!canAccessAllQuotes && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para ver este contacto' });
    }

    res.json({
      seller_email: row.seller_email,
      seller_phone: row.seller_phone
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener contacto del vendedor' });
  }
});

// ─── GET single quote for checklist with displayName ────────────────────────
app.get('/api/quotes/:id/checklist', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canAccessAllQuotes = access.pedidos_global || access.historial_global;
  const pedidosScope = getPedidosAccessScope(userContext, access);
  if (pedidosScope.error) return res.status(403).json({ error: pedidosScope.error });

  try {
    const result = await pool.query(
      `SELECT id, user_id, customer_name, customer_phone, department, provincia, store_location, 
              vendor, status, line_items, created_at, alternative_name, alternative_phone
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
    if (!canAccessAllQuotes && access.pedidos_individual && !access.historial_individual && !pedidosScope.isGlobal && quote.store_location !== pedidosScope.city) {
      return res.status(403).json({ error: 'No autorizado para ver pedidos de otra ciudad' });
    }

    const items = quote.line_items.map(row => ({
      displayName: row.displayName || row.sku || 'Producto desconocido',
      qty: row.qty || 1
    }));

    res.json({
      id: quote.id,
      customer_name: quote.customer_name,
      customer_phone: quote.customer_phone,
      alternative_name: quote.alternative_name,
      alternative_phone: quote.alternative_phone,
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
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const canManageAnyQuote = access.pedidos_global || access.historial_global;
  const pedidosScope = getPedidosAccessScope(userContext, access);
  if (pedidosScope.error) return res.status(403).json({ error: pedidosScope.error });

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

    const isPedidosIndividualScoped = access.pedidos_individual && !canManageAnyQuote && !pedidosScope.isGlobal;
    if (isPedidosIndividualScoped) {
      if (currentRes.rows[0].store_location !== pedidosScope.city) {
        return res.status(403).json({ error: 'No autorizado para actualizar pedidos de otra ciudad' });
      }
    } else if (!canManageAnyQuote && currentRes.rows[0].user_id !== req.user.id) {
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
app.patch('/api/products/:sku/stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
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
app.patch('/api/products/:sku/min-stock', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  const { sku } = req.params;
  const minFields = ['min_stock_cochabamba', 'min_stock_santacruz', 'min_stock_lima'];

  try {
    if (!inventoryScope.isGlobal) {
      const allowedMinField = inventoryScope.scope.minField;
      const providedFields = minFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
      if (providedFields.length === 0) {
        return res.status(400).json({ error: `Debes enviar ${allowedMinField}` });
      }
      if (providedFields.some((field) => field !== allowedMinField)) {
        return res.status(403).json({ error: 'No puedes actualizar mínimos de otro almacén' });
      }

      const minValue = req.body[allowedMinField];
      if (minValue === undefined || minValue === null || Number.isNaN(Number(minValue)) || Number(minValue) < 0) {
        return res.status(400).json({ error: 'El mínimo debe ser un número >= 0' });
      }

      const result = await pool.query(
        `UPDATE products
         SET ${allowedMinField} = $1,
             last_updated = NOW()
         WHERE sku = $2
         RETURNING sku, ${allowedMinField}`,
        [Number(minValue), sku.toUpperCase()]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      return res.json({
        message: 'Mínimo actualizado',
        ...result.rows[0]
      });
    }

    const {
      min_stock_cochabamba,
      min_stock_santacruz,
      min_stock_lima
    } = req.body;

    const values = [min_stock_cochabamba, min_stock_santacruz, min_stock_lima];
    if (values.some((v) => v === undefined || v === null || Number.isNaN(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ error: 'Los mínimos por almacén son requeridos y deben ser números >= 0' });
    }

    const result = await pool.query(
      `UPDATE products
       SET min_stock_cochabamba = $1,
           min_stock_santacruz = $2,
           min_stock_lima = $3,
           last_updated = NOW()
       WHERE sku = $4
       RETURNING sku, min_stock_cochabamba, min_stock_santacruz, min_stock_lima`,
      [min_stock_cochabamba, min_stock_santacruz, min_stock_lima, sku.toUpperCase()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({
      message: 'Mínimos actualizados',
      ...result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar mínimos' });
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
    res.status(500).json({ error: 'No se pudieron cargar combos' });
  }
});

// POST create new combo
app.post('/api/combos', authenticateToken, requireRole(['Marketing Lider', 'Admin']), async (req, res) => {
  const { name, sf, cf, products } = req.body;

  if (!name || !sf || !cf || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Faltan campos requeridos o productos vacíos' });
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
    res.status(500).json({ error: 'No se pudo crear combo' });
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
      return res.status(404).json({ error: 'Combo no encontrado' });
    }

    const creatorId = comboRes.rows[0].created_by;
    const isAdmin = req.user.role.toLowerCase() === 'admin';
    if (creatorId !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'No autorizado para eliminar este combo' });
    }

    await pool.query('DELETE FROM combos WHERE id = $1', [id]);
    res.json({ message: 'Combo deleted' });
  } catch (err) {
    console.error('Error deleting combo:', err);
    res.status(500).json({ error: 'No se pudo eliminar combo' });
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
    res.status(500).json({ error: 'No se pudieron cargar cupones' });
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
      'SELECT id, email, role, city, phone, panel_access, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows.map((u) => ({ ...u, panel_access: sanitizePanelAccess(u.panel_access, u.role) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron obtener usuarios' });
  }
});

app.get('/api/role-access-defaults', authenticateToken, requireRole(['admin']), async (_req, res) => {
  res.json(DEFAULT_ROLE_ACCESS);
});

app.put('/api/role-access-defaults', authenticateToken, requireRole(['admin']), async (req, res) => {
  const roleEntries = Object.entries(req.body || {});
  if (roleEntries.length === 0) {
    return res.status(400).json({ error: 'No se enviaron roles para actualizar' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [roleLabel, accessValue] of roleEntries) {
      const sanitized = sanitizePanelAccess(accessValue, roleLabel);
      await client.query(
        'UPDATE users SET panel_access = $1::jsonb WHERE role = $2',
        [JSON.stringify(sanitized), roleLabel]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Configuración de roles actualizada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar configuración de roles' });
  } finally {
    client.release();
  }
});

app.post('/api/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { email, password, role, city, phone, panel_access } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'Faltan campos requeridos' });

  // Validate phone (optional, but if provided must be 8 digits)
  if (phone && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const effectivePanelAccess = sanitizePanelAccess(panel_access, role);

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, city, phone, panel_access) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
      [email, hashedPass, role, city || null, phone || null, JSON.stringify(effectivePanelAccess)]
    );
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: 'No se pudo crear usuario' });
  }
});

app.patch('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { role, city, phone, panel_access } = req.body;
  if (!role) return res.status(400).json({ error: 'El rol es obligatorio' });

  if (phone !== undefined && phone !== null && phone !== '' && !/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: 'Teléfono debe tener exactamente 8 dígitos numéricos' });
  }

  const cityProvided = Object.prototype.hasOwnProperty.call(req.body, 'city');
  const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const panelAccessProvided = Object.prototype.hasOwnProperty.call(req.body, 'panel_access');
  const cityValue = city === '' ? null : city;
  const phoneValue = phone === '' ? null : phone;
  const panelAccessValue = panelAccessProvided ? JSON.stringify(sanitizePanelAccess(panel_access, role)) : null;

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           city = CASE WHEN $2::boolean THEN $3 ELSE city END,
           phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
           panel_access = CASE WHEN $6::boolean THEN $7::jsonb ELSE panel_access END
       WHERE id = $8
       RETURNING id`,
      [role, cityProvided, cityValue, phoneProvided, phoneValue, panelAccessProvided, panelAccessValue, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'User updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar usuario' });
  }
});

// ─── ROLE ACCESS DEFAULTS (admin only) ──────────────────────────────────────
app.get('/api/roles/access-defaults', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT role, panel_access
       FROM role_panel_defaults
       ORDER BY role ASC`
    );
    const map = new Map(result.rows.map((row) => [normalizeRole(row.role), row.panel_access || {}]));
    const rows = ROLE_DEFAULT_ROLES.map((role) => {
      const dbAccess = map.get(normalizeRole(role));
      return {
        role,
        panel_access: sanitizePanelAccess(dbAccess, role)
      };
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de roles' });
  }
});

app.patch('/api/roles/access-defaults/:role', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rawRole = req.params.role;
  const matchedRole = ROLE_DEFAULT_ROLES.find((r) => normalizeRole(r) === normalizeRole(rawRole));
  if (!matchedRole) {
    return res.status(400).json({ error: 'Rol inválido para configuración por defecto' });
  }
  const panelAccess = sanitizePanelAccess(req.body?.panel_access, matchedRole);
  try {
    await pool.query(
      `INSERT INTO role_panel_defaults (role, panel_access)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (role)
       DO UPDATE SET panel_access = EXCLUDED.panel_access, updated_at = NOW()`,
      [matchedRole, JSON.stringify(panelAccess)]
    );
    res.json({ message: 'Configuración del rol guardada', role: matchedRole, panel_access: panelAccess });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración del rol' });
  }
});

app.post('/api/roles/access-defaults/:role/apply', authenticateToken, requireRole(['admin']), async (req, res) => {
  const rawRole = req.params.role;
  const matchedRole = ROLE_DEFAULT_ROLES.find((r) => normalizeRole(r) === normalizeRole(rawRole));
  if (!matchedRole) {
    return res.status(400).json({ error: 'Rol inválido para aplicar configuración' });
  }
  try {
    const defaultsResult = await pool.query(
      'SELECT panel_access FROM role_panel_defaults WHERE role = $1',
      [matchedRole]
    );
    const defaultAccess = defaultsResult.rowCount > 0
      ? defaultsResult.rows[0].panel_access
      : null;
    const effectiveAccess = sanitizePanelAccess(defaultAccess, matchedRole);

    const updateResult = await pool.query(
      `UPDATE users
       SET panel_access = $1::jsonb
       WHERE LOWER(role) = LOWER($2)`,
      [JSON.stringify(effectiveAccess), matchedRole]
    );

    res.json({
      message: 'Configuración aplicada a usuarios del rol',
      role: matchedRole,
      updated_users: updateResult.rowCount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo aplicar configuración a usuarios' });
  }
});

// ─── COMMISSION SETTINGS (admin only) ────────────────────────────────────────
app.get('/api/commission/settings', authenticateToken, requireRole(['admin']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT settings
       FROM commission_settings
       ORDER BY id DESC
       LIMIT 1`
    );
    const dbSettings = result.rowCount > 0 ? result.rows[0].settings : null;
    res.json(sanitizeCommissionSettings(dbSettings));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar configuración de comisiones' });
  }
});

app.patch('/api/commission/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, settings
       FROM commission_settings
       ORDER BY id DESC
       LIMIT 1`
    );
    const current = sanitizeCommissionSettings(result.rowCount > 0 ? result.rows[0].settings : null);
    const next = sanitizeCommissionSettings({
      ...current,
      ...(req.body?.settings || {})
    });

    if (result.rowCount > 0) {
      await pool.query(
        `UPDATE commission_settings
         SET settings = $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(next), result.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO commission_settings (settings)
         VALUES ($1::jsonb)`,
        [JSON.stringify(next)]
      );
    }

    res.json({ message: 'Configuración de comisiones guardada', settings: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar configuración de comisiones' });
  }
});

app.delete('/api/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar usuario' });
  }
});

// ─── Performance ────────────────────────────────────────────────────────────
app.get('/api/performance', authenticateToken, async (req, res) => {
  const { team, month, year } = req.query;
  const isTeamView = team === 'true';
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);

  if (isTeamView && !access.rendimiento_global) {
    return res.status(403).json({ error: 'No tienes permiso para rendimiento global' });
  }
  if (!isTeamView && !access.rendimiento_individual) {
    return res.status(403).json({ error: 'No tienes permiso para rendimiento individual' });
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
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === ROLE_KEYS.admin;
  const isVentasLider = userRoleNormalized === ROLE_KEYS.ventasLider;
  const isMarketingLider = userRoleNormalized === ROLE_KEYS.marketingLider;
  const isSalesSeller = userRoleNormalized === ROLE_KEYS.ventas || userRoleNormalized === 'sales' || userRoleNormalized === 'vendedor';
  const isAlmacen = userRoleNormalized === ROLE_KEYS.almacen;
  const isAlmacenLider = userRoleNormalized === ROLE_KEYS.almacenLider;
  const isMarketing = userRoleNormalized === ROLE_KEYS.marketing;
  const isMicrofabricaLider = userRoleNormalized === ROLE_KEYS.microfabricaLider;
  const isMicrofabrica = userRoleNormalized === ROLE_KEYS.microfabrica;

  const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
  if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });
  const teamDateFilter = buildDateFilter(month, year, 'q', 3);
  if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });
  const ownDateFilter = buildDateFilter(month, year, 'q', 3);
  if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });
  const almacenDateFilter = buildDateFilter(month, year, 'q', 3);
  if (almacenDateFilter.error) return res.status(400).json({ error: almacenDateFilter.error });

  try {
    const commissionSettings = await loadCommissionSettings();
    const rateVentasLider = Number(commissionSettings.ventas_lider_percent || 0) / 100;
    const rateVentasTop = Number(commissionSettings.ventas_top_percent || 0) / 100;
    const rateVentasRegular = Number(commissionSettings.ventas_regular_percent || 0) / 100;
    const rateAlmacen = Number(commissionSettings.almacen_percent || 0) / 100;
    const rateMarketingLider = Number(commissionSettings.marketing_lider_percent || 0) / 100;

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
        commission: allSales * rateMarketingLider,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateMarketingLider,
          source: `${Number(commissionSettings.marketing_lider_percent || 0)}% de todas las ventas`
        }
      });
    }

    if (isVentasLider) {
      // Ventas Lider: configurable % on own sales + all users with exactly Ventas role.
      const teamSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND (LOWER(u.role) = $2 OR u.id = $3)${teamDateFilter.sql}`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventas, req.user.id, ...teamDateFilter.params]
      );
      const teamSales = Number(teamSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: teamSales * rateVentasLider,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateVentasLider,
          source: `${Number(commissionSettings.ventas_lider_percent || 0)}% ventas equipo + propias`
        }
      });
    }

    // Usuarios de ventas: quien lidera ventas recibe 12%, los demás 8%.
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
      const rate = isTopSeller ? rateVentasTop : rateVentasRegular;

      return res.json({
        commission: ownSales * rate,
        isTopSeller,
        topSellerEmail: topSeller?.email || null,
        breakdown: {
          role: req.user.role,
          rate,
          source: `${Number(commissionSettings.ventas_top_percent || 0)}% mejor en ventas / ${Number(commissionSettings.ventas_regular_percent || 0)}% regular`
        }
      });
    }

    if (isAlmacen) {
      const cityScope = resolveInventoryScopeByCity(userContext.city || '');
      const localStore = cityScope?.canonical || userContext.city || '';
      const localSalesRes = await pool.query(
        `SELECT COALESCE(SUM(q.total), 0) AS total_sales
         FROM quotes q
         WHERE q.status = $1
           AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
               LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
           ${almacenDateFilter.sql}`,
        ['Enviado', localStore, ...almacenDateFilter.params]
      );
      const localSales = Number(localSalesRes.rows[0]?.total_sales || 0);
      return res.json({
        commission: localSales * rateAlmacen,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: {
          role: req.user.role,
          rate: rateAlmacen,
          source: `${Number(commissionSettings.almacen_percent || 0)}% pedidos enviados de almacén local (${localStore || 'sin ciudad'})`
        }
      });
    }

    if (isAlmacenLider) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0, source: 'Compensación por pieza / control de calidad (configurable por contrato)' }
      });
    }

    if (isMarketing) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0, source: 'Compensación por contrato' }
      });
    }

    if (isMicrofabricaLider) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0, source: 'Compensación por piezas fabricadas por producto (mensual)' }
      });
    }

    if (isMicrofabrica) {
      return res.json({
        commission: 0,
        isTopSeller: false,
        topSellerEmail: null,
        breakdown: { role: req.user.role, rate: 0, source: 'Ingreso por piezas fabricadas (mensual)' }
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

// ─── Current user commission orders (debug/details) ─────────────────────────
app.get('/api/commission/current/orders', authenticateToken, async (req, res) => {
  const { month, year } = req.query;
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });

  const userRoleNormalized = normalizeRole(req.user.role || '');
  const isAdmin = userRoleNormalized === ROLE_KEYS.admin;
  const isVentasLider = userRoleNormalized === ROLE_KEYS.ventasLider;
  const isMarketingLider = userRoleNormalized === ROLE_KEYS.marketingLider;
  const isSalesSeller = userRoleNormalized === ROLE_KEYS.ventas || userRoleNormalized === 'sales' || userRoleNormalized === 'vendedor';
  const isAlmacen = userRoleNormalized === ROLE_KEYS.almacen;

  try {
    // Almacén: solo Enviado desde su ciudad/almacén local.
    if (isAlmacen) {
      const almacenDateFilter = buildDateFilter(month, year, 'q', 3);
      if (almacenDateFilter.error) return res.status(400).json({ error: almacenDateFilter.error });

      const cityScope = resolveInventoryScopeByCity(userContext.city || '');
      const localStore = cityScope?.canonical || userContext.city || '';
      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = $1
           AND LOWER(REGEXP_REPLACE(COALESCE(q.store_location, ''), '[^a-z0-9]+', '', 'g'))
               LIKE '%' || LOWER(REGEXP_REPLACE($2::text, '[^a-z0-9]+', '', 'g')) || '%'
           ${almacenDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        ['Enviado', localStore, ...almacenDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        city: userContext.city || null,
        criteria: {
          status: 'Enviado',
          local_store_match: localStore || null,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Ventas: ventas propias en estados completados.
    if (isSalesSeller) {
      const ownDateFilter = buildDateFilter(month, year, 'q', 3);
      if (ownDateFilter.error) return res.status(400).json({ error: ownDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.user_id = $1
           AND q.status = ANY($2::text[])${ownDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [req.user.id, COMPLETED_STATUSES, ...ownDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          user_id: req.user.id,
          statuses: COMPLETED_STATUSES,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Ventas Lider: ventas del equipo Ventas + propias en estados completados.
    if (isVentasLider) {
      const teamDateFilter = buildDateFilter(month, year, 'q', 4);
      if (teamDateFilter.error) return res.status(400).json({ error: teamDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])
           AND (LOWER(u.role) = $2 OR u.id = $3)${teamDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [COMPLETED_STATUSES, ROLE_KEYS.ventas, req.user.id, ...teamDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          statuses: COMPLETED_STATUSES,
          team_role: ROLE_KEYS.ventas,
          include_own_user_id: req.user.id,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    // Marketing Lider y Admin: todas las ventas completadas.
    if (isMarketingLider || isAdmin) {
      const allSalesDateFilter = buildDateFilter(month, year, 'q', 2);
      if (allSalesDateFilter.error) return res.status(400).json({ error: allSalesDateFilter.error });

      const result = await pool.query(
        `SELECT q.id, q.created_at, q.customer_name, q.total, q.status, q.store_location, q.user_id, u.email AS seller_email
         FROM quotes q
         LEFT JOIN users u ON u.id = q.user_id
         WHERE q.status = ANY($1::text[])${allSalesDateFilter.sql}
         ORDER BY q.created_at DESC, q.id DESC`,
        [COMPLETED_STATUSES, ...allSalesDateFilter.params]
      );
      const totalSales = result.rows.reduce((acc, row) => acc + Number(row.total || 0), 0);
      return res.json({
        role: req.user.role,
        criteria: {
          statuses: COMPLETED_STATUSES,
          month: month !== undefined ? Number.parseInt(month, 10) : null,
          year: year !== undefined ? Number.parseInt(year, 10) : null
        },
        total_sales: totalSales,
        orders_count: result.rows.length,
        orders: result.rows
      });
    }

    return res.json({
      role: req.user.role,
      criteria: { month, year },
      total_sales: 0,
      orders_count: 0,
      orders: [],
      note: 'Este rol no calcula comisión por pedidos en el endpoint actual'
    });
  } catch (err) {
    console.error('Commission orders endpoint error:', err.stack);
    res.status(500).json({ error: 'Error interno al obtener pedidos de comisión: ' + err.message });
  }
});

// ─── INVENTORY ──────────────────────────────────────────────────────────────
app.get('/api/products', authenticateToken, requireRole(['Almacen Lider', 'Almacen', 'Admin']), async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const inventoryScope = getInventoryAccessScope(userContext, access);
  if (inventoryScope.error) return res.status(403).json({ error: inventoryScope.error });

  try {
    if (!inventoryScope.isGlobal) {
      const stockField = inventoryScope.scope.stockField;
      const minField = inventoryScope.scope.minField;
      const result = await pool.query(`
        SELECT sku, name, ${stockField}, ${minField}, last_updated
        FROM products 
        ORDER BY sku
      `);
      return res.json(result.rows);
    }

    const result = await pool.query(`
      SELECT sku, name, stock_cochabamba, stock_santacruz, stock_lima,
             min_stock_cochabamba, min_stock_santacruz, min_stock_lima,
             last_updated
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

app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const userRow = await loadUserContext(req.user.id);
    if (!userRow) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(buildUserPayload(userRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar sesión' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});