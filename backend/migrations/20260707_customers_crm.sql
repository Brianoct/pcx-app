-- CRM-lite: customer records so sales never re-enters customer data, plus
-- follow-ups (seguimiento), a simple pipeline stage, and free-form notes.
--
-- Customers are keyed by normalized phone (digits only) — the identifier that
-- already exists on every quote — so history links without touching the quotes
-- schema. Backfilled from existing quotes (latest data per phone wins).

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  email TEXT,
  department TEXT,
  provincia TEXT,
  address TEXT,
  pipeline_stage TEXT NOT NULL DEFAULT 'contactado'
    CHECK (pipeline_stage IN ('contactado', 'cotizado', 'negociando', 'cliente', 'inactivo')),
  follow_up_at DATE,
  follow_up_note TEXT,
  assigned_vendor TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_normalized
  ON customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

CREATE TABLE IF NOT EXISTS customer_notes (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer
  ON customer_notes (customer_id, created_at DESC);

-- Fast history lookup: quotes joined to customers by normalized phone.
CREATE INDEX IF NOT EXISTS idx_quotes_phone_normalized
  ON quotes (regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'));

-- Backfill one customer per phone from existing quotes (most recent quote wins
-- for name/department/vendor). Idempotent: conflicts are skipped.
INSERT INTO customers (name, phone, phone_normalized, department, provincia, assigned_vendor, pipeline_stage, created_at)
SELECT DISTINCT ON (regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g'))
  COALESCE(NULLIF(TRIM(q.customer_name), ''), 'Cliente'),
  q.customer_phone,
  regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g'),
  q.department,
  q.provincia,
  q.vendor,
  'cotizado',
  q.created_at
FROM quotes q
WHERE regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g') <> ''
ORDER BY regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g'), q.created_at DESC
ON CONFLICT DO NOTHING;

-- Anyone with a completed sale is a "cliente", not just a lead.
UPDATE customers c
SET pipeline_stage = 'cliente'
WHERE c.pipeline_stage = 'cotizado'
  AND EXISTS (
    SELECT 1 FROM quotes q
    WHERE regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g') = c.phone_normalized
      AND q.status IN ('Pagado', 'Embalado', 'Enviado')
  );
