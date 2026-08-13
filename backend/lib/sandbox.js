// Modo sandbox: una copia completa de la app dentro del mismo Postgres, en el
// schema "sandbox". Las peticiones marcadas con el header X-PCX-Sandbox (y un
// rol habilitado) se enrutan allí desde db.js, así todas las pantallas — y las
// futuras — funcionan igual pero sin tocar datos reales.
//
// El ciclo de vida vive aquí:
//   ensureSandboxReady()  — al boot: crea el schema si falta, corre las mismas
//                           migraciones que public y, si es la primera vez,
//                           lo puebla con el seed de práctica.
//   resetSandbox()        — botón "Reiniciar sandbox": borra todo el schema y
//                           lo reconstruye al punto de partida conocido.
const { realPool, sandboxPool } = require('../db');
const { runMigrations } = require('../scripts/migrate');
const { normalizeRole } = require('./rbac');

const SANDBOX_HEADER = 'x-pcx-sandbox';

// Hoy solo Admin; para abrirlo a más roles basta ampliar esta lista.
const SANDBOX_ALLOWED_ROLES = ['admin'];

const canUseSandbox = (role) => SANDBOX_ALLOWED_ROLES.includes(normalizeRole(role || ''));

// Tablas base que en public existen desde antes del sistema de migraciones
// (schema.sql es un dump anclado a "public", inutilizable aquí). Todo lo demás
// lo crean las migraciones normales, que corren también sobre el sandbox.
const BASELINE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  city VARCHAR(50),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  phone VARCHAR(8) DEFAULT NULL,
  panel_access JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS products (
  sku VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  stock_cochabamba INTEGER DEFAULT 0,
  stock_santacruz INTEGER DEFAULT 0,
  stock_lima INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  min_stock_cochabamba INTEGER NOT NULL DEFAULT 0,
  min_stock_santacruz INTEGER NOT NULL DEFAULT 0,
  min_stock_lima INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  department VARCHAR(50),
  store_location VARCHAR(50),
  vendor VARCHAR(50),
  venta_type VARCHAR(2),
  discount_percent INTEGER,
  line_items JSONB,
  subtotal NUMERIC,
  total NUMERIC,
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  provincia VARCHAR(255) DEFAULT NULL,
  shipping_notes TEXT,
  alternative_name TEXT,
  alternative_phone TEXT
);

CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes (created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes (status);
CREATE INDEX IF NOT EXISTS idx_quotes_store_location ON quotes (store_location);
CREATE INDEX IF NOT EXISTS idx_quotes_vendor ON quotes (vendor);

CREATE TABLE IF NOT EXISTS combos (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  sf_price NUMERIC(10,2) NOT NULL,
  cf_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS combo_items (
  combo_id INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  sku VARCHAR(50) NOT NULL,
  quantity INTEGER DEFAULT 1,
  PRIMARY KEY (combo_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_combo_items_combo_id ON combo_items (combo_id);

CREATE TABLE IF NOT EXISTS sandbox_meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);
`;

// Datos de referencia que el sandbox copia de public en cada reset, en orden
// seguro para las claves foráneas. Lo transaccional (cotizaciones, clientes,
// campañas, gastos…) NUNCA se copia: eso lo genera el seed ficticio.
const REFERENCE_TABLES = [
  'users',
  'user_assets',
  'role_panel_defaults',
  'commission_settings',
  'products',
  'product_assets',
  'combos',
  'combo_items',
  'combo_assets',
  'production_equipment_catalog',
  'production_material_catalog',
  'product_equipment_map',
  'product_material_map',
  'product_process_map',
  'product_cost_allocations',
  'product_process_steps',
  'production_process_routes',
  'production_settings',
  'quality_control_settings',
  'geo_destinations',
  'feature_flags',
  'promo_tools'
];

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Copia por intersección de columnas: no importa si public y sandbox difieren
// en el orden de columnas o si alguna columna nueva aún no existe en ambos.
const copyReferenceTable = async (client, table) => {
  const colsRes = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
     INTERSECT
     SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'sandbox' AND table_name = $1 AND is_generated = 'NEVER'`,
    [table]
  );
  if (colsRes.rowCount === 0) return 0;
  const cols = colsRes.rows.map((r) => quoteIdent(r.column_name)).join(', ');
  const target = quoteIdent(table);
  // Algunas migraciones insertan filas por defecto (commission_settings,
  // role_panel_defaults…); los valores reales de public deben reemplazarlas.
  await client.query(`DELETE FROM sandbox.${target}`);
  const result = await client.query(
    `INSERT INTO sandbox.${target} (${cols}) SELECT ${cols} FROM public.${target}`
  );
  return result.rowCount || 0;
};

// Tras copiar filas con ids explícitos, las secuencias del sandbox deben
// continuar después del máximo copiado o los INSERT nuevos chocarían.
const syncSandboxSequences = async (client) => {
  const seqRes = await client.query(
    `SELECT seq.relname AS sequence_name,
            tab.relname AS table_name,
            attr.attname AS column_name
       FROM pg_class seq
       JOIN pg_namespace ns ON ns.oid = seq.relnamespace AND ns.nspname = 'sandbox'
       JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
       JOIN pg_class tab ON tab.oid = dep.refobjid
       JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
      WHERE seq.relkind = 'S'`
  );
  for (const row of seqRes.rows) {
    await client.query(
      `SELECT setval(
         'sandbox.${quoteIdent(row.sequence_name)}',
         COALESCE((SELECT MAX(${quoteIdent(row.column_name)}) FROM sandbox.${quoteIdent(row.table_name)}), 0) + 1,
         false
       )`
    );
  }
};

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

// ── Seed de práctica ────────────────────────────────────────────────────────
// Un mini-negocio creíble: clientes ficticios en cada etapa del embudo,
// cotizaciones en cada estado repartidas entre este mes y el anterior (para
// que Estadísticas, rankings y comisiones muestren números), seguimientos que
// vencen hoy, pedidos esperando en almacén y una campaña activa.

const FAKE_CUSTOMERS = [
  { name: 'Rosa Mamani', phone: '70012345', department: 'La Paz', stage: 'contactado' },
  { name: 'Juan Quispe', phone: '70123456', department: 'El Alto', stage: 'contactado' },
  { name: 'Carla Fernández', phone: '70234567', department: 'Cochabamba', stage: 'contactado' },
  { name: 'Marco Choque', phone: '70345678', department: 'Santa Cruz', stage: 'cotizado' },
  { name: 'Lucía Vargas', phone: '70456789', department: 'Cochabamba', stage: 'cotizado' },
  { name: 'Pedro Condori', phone: '70567890', department: 'Oruro', stage: 'cotizado' },
  { name: 'Ana Gutiérrez', phone: '70678901', department: 'Santa Cruz', stage: 'cotizado' },
  { name: 'Jorge Flores', phone: '70789012', department: 'La Paz', stage: 'negociando', stalledDays: 12 },
  { name: 'Silvia Rojas', phone: '70890123', department: 'Cochabamba', stage: 'negociando' },
  { name: 'Daniel Torrez', phone: '70901234', department: 'Tarija', stage: 'negociando' },
  { name: 'María Céspedes', phone: '71012345', department: 'Santa Cruz', stage: 'cliente' },
  { name: 'Roberto Salazar', phone: '71123456', department: 'Cochabamba', stage: 'cliente' },
  { name: 'Elena Paredes', phone: '71234567', department: 'La Paz', stage: 'cliente' },
  { name: 'Freddy Aguilar', phone: '71345678', department: 'Potosí', stage: 'cliente' },
  { name: 'Verónica Ibáñez', phone: '71456789', department: 'Santa Cruz', stage: 'perdido', lostReason: 'Compró a la competencia por precio' }
];

// (customerIndex, daysAgo, status, ventaType, lines) — los índices >= longitud
// de FAKE_CUSTOMERS generan compradores sueltos sin ficha CRM.
const QUOTE_PLAN = [
  // Mes anterior: ventas cerradas para que Estadísticas compare meses.
  { customer: 10, daysAgo: 38, status: 'Enviado', venta: 'sf' },
  { customer: 11, daysAgo: 35, status: 'Enviado', venta: 'cf' },
  { customer: 12, daysAgo: 33, status: 'Enviado', venta: 'sf' },
  { customer: 13, daysAgo: 31, status: 'Enviado', venta: 'sf' },
  { customer: -1, daysAgo: 40, status: 'Enviado', venta: 'cf' },
  { customer: -2, daysAgo: 36, status: 'Enviado', venta: 'sf' },
  { customer: 14, daysAgo: 34, status: 'Cotizado', venta: 'sf' },
  // Mes actual: embudo completo, algo en cada estado.
  { customer: 3, daysAgo: 9, status: 'Cotizado', venta: 'sf' },
  { customer: 4, daysAgo: 7, status: 'Cotizado', venta: 'sf' },
  { customer: 5, daysAgo: 6, status: 'Cotizado', venta: 'cf' },
  { customer: 6, daysAgo: 2, status: 'Cotizado', venta: 'sf' },
  { customer: 7, daysAgo: 8, status: 'Confirmado', venta: 'sf' },
  { customer: 8, daysAgo: 5, status: 'Confirmado', venta: 'cf' },
  { customer: 9, daysAgo: 4, status: 'Confirmado', venta: 'sf' },
  { customer: -3, daysAgo: 6, status: 'Pagado', venta: 'sf' },
  { customer: -4, daysAgo: 4, status: 'Pagado', venta: 'sf' },
  { customer: 10, daysAgo: 3, status: 'Pagado', venta: 'cf' },
  { customer: -5, daysAgo: 3, status: 'Embalado', venta: 'sf' },
  { customer: 11, daysAgo: 2, status: 'Embalado', venta: 'sf' },
  { customer: 12, daysAgo: 5, status: 'Enviado', venta: 'sf' },
  { customer: 13, daysAgo: 1, status: 'Enviado', venta: 'cf' },
  { customer: -6, daysAgo: 1, status: 'Enviado', venta: 'sf' }
];

const LOOSE_BUYERS = [
  { name: 'Comercial San Miguel', phone: '72012345', department: 'Santa Cruz' },
  { name: 'Ferretería El Tornillo', phone: '72123456', department: 'Cochabamba' },
  { name: 'Gladys Herrera', phone: '72234567', department: 'La Paz' },
  { name: 'Hugo Rivas', phone: '72345678', department: 'Cochabamba' },
  { name: 'Patricia Núñez', phone: '72456789', department: 'Santa Cruz' },
  { name: 'Mario Peredo', phone: '72567890', department: 'Chuquisaca' }
];

const STORE_BY_DEPARTMENT = {
  'Santa Cruz': 'Santa Cruz',
  Cochabamba: 'Cochabamba'
};

// Ciudad capital por departamento para que el ranking Departamento → Ciudad
// del panel de marketing tenga detalle también con datos de práctica.
const CITY_BY_DEPARTMENT = {
  'La Paz': 'La Paz',
  'El Alto': 'El Alto',
  Cochabamba: 'Cochabamba',
  'Santa Cruz': 'Santa Cruz de la Sierra',
  Oruro: 'Oruro',
  Tarija: 'Tarija',
  Potosí: 'Potosí',
  Chuquisaca: 'Sucre'
};

const seedSandboxData = async (client) => {
  const usersRes = await client.query(
    `SELECT id, email, display_name, role FROM sandbox.users WHERE is_active ORDER BY id`
  );
  const users = usersRes.rows;
  if (users.length === 0) return { quotes: 0, customers: 0 };
  const vendors = users.filter((u) => normalizeRole(u.role).startsWith('ventas'));
  const sellerPool = vendors.length > 0 ? vendors : users;
  const displayNameOf = (u) => String(u.display_name || '').trim() || String(u.email || '').split('@')[0];

  // Preferir productos con precio cargado; si el catálogo aún no tiene
  // precios, usar cualquiera con un precio de práctica para que las
  // cotizaciones del seed nunca queden en cero.
  const productsRes = await client.query(
    `SELECT sku, name, sf_price, cf_price FROM sandbox.products
      WHERE COALESCE(is_active, TRUE)
      ORDER BY (COALESCE(sf_price, 0) > 0) DESC, sku
      LIMIT 12`
  );
  const products = productsRes.rows.map((p, idx) => {
    const sf = Number(p.sf_price) || 0;
    const cf = Number(p.cf_price) || 0;
    const fallback = 150 + (idx % 5) * 75;
    return {
      ...p,
      sf_price: sf > 0 ? sf : fallback,
      cf_price: cf > 0 ? cf : Math.round(fallback * 1.13)
    };
  });

  // Clientes ficticios en cada etapa del embudo. Los "negociando" estancados y
  // los seguimientos que vencen hoy/ayer son material de enseñanza a propósito.
  const customerIds = [];
  for (let i = 0; i < FAKE_CUSTOMERS.length; i += 1) {
    const c = FAKE_CUSTOMERS[i];
    const vendorUser = sellerPool[i % sellerPool.length];
    const followUps = {
      contactado: { offset: i % 2 === 0 ? 0 : 2, note: 'Llamar para presentar el catálogo' },
      cotizado: { offset: i % 3 === 0 ? 0 : -1, note: 'Preguntar si revisó la cotización' },
      negociando: { offset: 0, note: 'Cerrar precio final — pide descuento' }
    };
    const followUp = followUps[c.stage] || null;
    const res = await client.query(
      `INSERT INTO sandbox.customers
         (name, phone, phone_normalized, department, pipeline_stage, lost_reason,
          follow_up_at, follow_up_note, assigned_vendor, created_by,
          created_at, updated_at, stage_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + ($7::int) END, $8, $9, $10,
               NOW() - ($11 || ' days')::interval, NOW(), NOW() - ($12 || ' days')::interval)
       RETURNING id`,
      [
        c.name,
        c.phone,
        digitsOnly(c.phone),
        c.department,
        c.stage,
        c.lostReason || null,
        followUp ? followUp.offset : null,
        followUp ? followUp.note : null,
        displayNameOf(vendorUser),
        vendorUser.id,
        20 + i,
        c.stalledDays || 1
      ]
    );
    customerIds.push(res.rows[0].id);
  }

  // Cotizaciones en cada estado, repartidas entre vendedores y los dos meses.
  let quotesInserted = 0;
  if (products.length > 0) {
    for (let i = 0; i < QUOTE_PLAN.length; i += 1) {
      const plan = QUOTE_PLAN[i];
      const buyer = plan.customer >= 0 && plan.customer < FAKE_CUSTOMERS.length
        ? FAKE_CUSTOMERS[plan.customer]
        : LOOSE_BUYERS[(-plan.customer - 1) % LOOSE_BUYERS.length];
      const vendorUser = sellerPool[i % sellerPool.length];
      const lineCount = (i % 3 === 0) ? 2 : 1;
      const lineItems = [];
      for (let li = 0; li < lineCount; li += 1) {
        const product = products[(i + li * 5) % products.length];
        const qty = (i + li) % 3 === 0 ? 2 : 1;
        const unitPrice = Number(plan.venta === 'cf' ? product.cf_price : product.sf_price) || 0;
        lineItems.push({
          sku: product.sku,
          qty,
          unitPrice,
          lineTotal: unitPrice * qty,
          isCombo: false,
          comboItems: [],
          displayName: product.name
        });
      }
      const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
      await client.query(
        `INSERT INTO sandbox.quotes
           (user_id, customer_name, customer_phone, department, ciudad, store_location, vendor,
            venta_type, discount_percent, line_items, subtotal, total, status,
            payment_method, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9::jsonb, $10, $10, $11, $12,
                 NOW() - ($13 || ' days')::interval)`,
        [
          vendorUser.id,
          buyer.name,
          buyer.phone,
          buyer.department,
          CITY_BY_DEPARTMENT[buyer.department] || buyer.department,
          STORE_BY_DEPARTMENT[buyer.department] || 'Cochabamba',
          displayNameOf(vendorUser),
          plan.venta,
          JSON.stringify(lineItems),
          subtotal,
          plan.status,
          ['Pagado', 'Embalado', 'Enviado'].includes(plan.status) ? 'QR' : null,
          plan.daysAgo
        ]
      );
      quotesInserted += 1;
    }
  }

  // Notas CRM de ejemplo en un par de fichas.
  if (customerIds[7]) {
    await client.query(
      `INSERT INTO sandbox.customer_notes (customer_id, note, created_by)
       VALUES ($1, 'Pide 10% de descuento por volumen. Consultar con el líder.', $2)`,
      [customerIds[7], sellerPool[0].id]
    );
  }
  if (customerIds[4]) {
    await client.query(
      `INSERT INTO sandbox.customer_notes (customer_id, note, created_by)
       VALUES ($1, 'Prefiere que la entrega llegue a su tienda en la avenida principal.', $2)`,
      [customerIds[4], sellerPool[Math.min(1, sellerPool.length - 1)].id]
    );
  }

  // Conversaciones de WhatsApp simuladas para la bandeja.
  const waSeed = [
    {
      name: 'Rosa Mamani', phone: '59170012345', stage: 'quoted',
      messages: [
        { dir: 'inbound', text: 'Hola, vi sus tableros en Facebook. ¿Tienen catálogo?' },
        { dir: 'outbound', text: '¡Hola Rosa! Claro, te comparto nuestro catálogo. ¿Para qué ciudad sería la entrega?' },
        { dir: 'inbound', text: 'Para La Paz. Me interesa el más grande.' }
      ]
    },
    {
      name: 'Marco Choque', phone: '59170345678', stage: 'negotiation',
      messages: [
        { dir: 'inbound', text: '¿Me pueden mejorar el precio si llevo dos?' },
        { dir: 'outbound', text: 'Déjame consultarlo y te confirmo hoy mismo 👍' }
      ]
    }
  ];
  for (const conv of waSeed) {
    const contactRes = await client.query(
      `INSERT INTO sandbox.whatsapp_contacts (wa_phone, profile_name)
       VALUES ($1, $2) RETURNING id`,
      [conv.phone, conv.name]
    );
    const assigned = sellerPool[0];
    const convRes = await client.query(
      `INSERT INTO sandbox.whatsapp_conversations
         (contact_id, status, assigned_user_id, pipeline_stage, unread_count,
          last_message_preview, last_message_at)
       VALUES ($1, 'open', $2, $3, 1, $4, NOW() - interval '2 hours')
       RETURNING id`,
      [contactRes.rows[0].id, assigned.id, conv.stage, conv.messages[conv.messages.length - 1].text]
    );
    for (let m = 0; m < conv.messages.length; m += 1) {
      const msg = conv.messages[m];
      await client.query(
        `INSERT INTO sandbox.whatsapp_messages
           (conversation_id, direction, message_type, text_body, status, from_phone, to_phone, created_at)
         VALUES ($1, $2, 'text', $3, 'delivered', $4, $5,
                 NOW() - interval '3 hours' + ($6 || ' minutes')::interval)`,
        [
          convRes.rows[0].id,
          msg.dir,
          msg.text,
          msg.dir === 'inbound' ? conv.phone : 'sandbox',
          msg.dir === 'inbound' ? 'sandbox' : conv.phone,
          m * 7
        ]
      );
    }
    await client.query(
      `INSERT INTO sandbox.whatsapp_followup_tasks
         (conversation_id, assigned_user_id, note, due_at, status, created_by)
       VALUES ($1, $2, 'Responder con la propuesta final', NOW() + interval '3 hours', 'pending', $2)`,
      [convRes.rows[0].id, assigned.id]
    );
  }

  // Una campaña activa con tareas por área (una ya marcada como hecha).
  const marketingUser = users.find((u) => normalizeRole(u.role).startsWith('marketing')) || sellerPool[0];
  const campaignRes = await client.query(
    `INSERT INTO sandbox.marketing_campaigns (name, objective, start_date, end_date, status, created_by)
     VALUES ('Campaña de práctica — Feria del Hogar',
             'Aprender a coordinar una campaña entre áreas usando el sandbox',
             CURRENT_DATE - 5, CURRENT_DATE + 10, 'anunciada', $1)
     RETURNING id`,
    [marketingUser.id]
  );
  const campaignId = campaignRes.rows[0].id;
  const campaignTasks = [
    ['marketing', 'Publicar artes en redes sociales', 0, true],
    ['marketing', 'Programar pauta de la segunda semana', 1, false],
    ['ventas', 'Responder consultas de la campaña en el día', 0, false],
    ['ventas', 'Registrar cada interesado en el CRM', 1, false],
    ['almacen', 'Preparar stock para pedidos de la feria', 0, false]
  ];
  for (const [area, title, position, done] of campaignTasks) {
    await client.query(
      `INSERT INTO sandbox.marketing_campaign_tasks (campaign_id, area, title, position, done, done_by, done_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 THEN NOW() ELSE NULL END)`,
      [campaignId, area, title, position, done, done ? marketingUser.id : null]
    );
  }

  // Plan del día de hoy para los vendedores: el panel no arranca vacío.
  for (let i = 0; i < Math.min(sellerPool.length, 3); i += 1) {
    await client.query(
      `INSERT INTO sandbox.day_plan_tasks (user_id, task_date, start_minute, end_minute, title, is_done)
       VALUES ($1, CURRENT_DATE, 510, 540, 'Reunión de la mañana', TRUE),
              ($1, CURRENT_DATE, 600, 690, 'Seguimiento a clientes del embudo', FALSE)`,
      [sellerPool[i].id]
    );
  }

  return { quotes: quotesInserted, customers: customerIds.length };
};

// ── Ciclo de vida ───────────────────────────────────────────────────────────

const buildSandboxStructure = async () => {
  await sandboxPool.query(BASELINE_SQL);
  await runMigrations(sandboxPool);
};

const sandboxSchemaExists = async () => {
  const res = await realPool.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sandbox'`
  );
  return res.rowCount > 0;
};

const markReset = async (client) => {
  await client.query(
    `INSERT INTO sandbox.sandbox_meta (key, value, updated_at)
     VALUES ('last_reset_at', NOW()::text, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
  );
};

const resetSandbox = async () => {
  await realPool.query('DROP SCHEMA IF EXISTS sandbox CASCADE');
  await realPool.query('CREATE SCHEMA sandbox');
  await buildSandboxStructure();

  const client = await realPool.connect();
  const copied = {};
  try {
    for (const table of REFERENCE_TABLES) {
      try {
        copied[table] = await copyReferenceTable(client, table);
      } catch (err) {
        // Una tabla de referencia que falle no debe dejar el sandbox roto;
        // se registra y el resto del reset continúa.
        console.warn(`[sandbox] no se pudo copiar ${table}: ${err.message}`);
      }
    }
    await syncSandboxSequences(client);
    const seeded = await seedSandboxData(client);
    await syncSandboxSequences(client);
    await markReset(client);
    return { copied, seeded };
  } finally {
    client.release();
  }
};

// Al boot: si el schema no existe aún, primer reset completo; si existe, solo
// se ponen al día estructura y migraciones (idempotente y barato).
const ensureSandboxReady = async () => {
  try {
    const exists = await sandboxSchemaExists();
    if (!exists) {
      console.log('[sandbox] primer arranque: creando y sembrando el schema sandbox');
      await resetSandbox();
      return;
    }
    await buildSandboxStructure();
  } catch (err) {
    // El sandbox nunca debe impedir que la app real arranque.
    console.error(`[sandbox] no se pudo preparar el sandbox: ${err.message}`);
  }
};

const getSandboxStatus = async () => {
  let lastResetAt = null;
  try {
    const res = await sandboxPool.query(
      `SELECT value FROM sandbox_meta WHERE key = 'last_reset_at'`
    );
    lastResetAt = res.rows[0]?.value || null;
  } catch {
    lastResetAt = null;
  }
  return {
    allowed_roles: SANDBOX_ALLOWED_ROLES,
    last_reset_at: lastResetAt
  };
};

module.exports = {
  SANDBOX_ALLOWED_ROLES,
  SANDBOX_HEADER,
  canUseSandbox,
  ensureSandboxReady,
  getSandboxStatus,
  resetSandbox
};
