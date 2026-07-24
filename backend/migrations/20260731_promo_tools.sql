-- Caja de herramientas de marketing ("toolchest"): promociones activables por
-- ventana de fechas que Cotizar consulta y estampa en la proforma. Cada tool es
-- una fila; su comportamiento vive en config (JSONB) para poder agregar y podar
-- herramientas sin nuevas migraciones.
CREATE TABLE IF NOT EXISTS promo_tools (
  id SERIAL PRIMARY KEY,
  tool VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  campaign_id INTEGER REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  starts_on DATE,
  ends_on DATE,
  config JSONB NOT NULL DEFAULT '{}',
  winner_code_id INTEGER,
  drawn_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Un código por cliente por herramienta (sorteo). Los tickets se recalculan al
-- pagar: solo cotizaciones cobradas cuentan para el sorteo.
CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  tool_id INTEGER NOT NULL REFERENCES promo_tools(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL UNIQUE,
  customer_phone VARCHAR(32) NOT NULL,
  customer_name VARCHAR(120),
  tickets INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tool_id, customer_phone)
);

-- Cotizaciones que respaldan cada código: cuántos tickets aporta cada una y si
-- ya está cobrada. La suma de tickets pagados es el total del código.
CREATE TABLE IF NOT EXISTS promo_code_quotes (
  id SERIAL PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  quote_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tickets INTEGER NOT NULL DEFAULT 0,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (code_id, quote_id)
);

ALTER TABLE promo_tools
  ADD CONSTRAINT promo_tools_winner_code_fkey
  FOREIGN KEY (winner_code_id) REFERENCES promo_codes(id) ON DELETE SET NULL;

-- Snapshot de promos impresas en la proforma: lo prometido al cliente no cambia
-- aunque la herramienta se desactive después.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS promos JSONB;

CREATE INDEX IF NOT EXISTS idx_promo_codes_tool ON promo_codes(tool_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_quotes_quote ON promo_code_quotes(quote_id);
