-- Ruleta de premios (marketing): a customer receives a one-shot spin link by
-- WhatsApp. The outcome is decided SERVER-side and the single spin is enforced
-- with an atomic status transition, so the link cannot be replayed.
--
-- wheel_config holds one row: the current slices (label/weight/top flag) that
-- marketing edits. Its version bumps on every save; "one spin per customer"
-- is scoped to a version, so saving a new wheel starts a fresh campaign.

CREATE TABLE IF NOT EXISTS wheel_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  slices JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO wheel_config (id, slices)
VALUES (
  1,
  '[
    {"label": "5% de descuento", "weight": 20, "top": false},
    {"label": "Regalo sorpresa", "weight": 15, "top": false},
    {"label": "Envío gratis", "weight": 15, "top": false},
    {"label": "10% de descuento", "weight": 8, "top": false},
    {"label": "Sigue participando", "weight": 40, "top": false},
    {"label": "PREMIO MAYOR: 20% de descuento", "weight": 2, "top": true}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS wheel_spins (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  -- Snapshot of the slices at link creation: the customer plays the wheel
  -- they were sent, even if marketing edits the config afterwards.
  slices JSONB NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'spun')),
  prize_label TEXT,
  prize_index INTEGER,
  is_top_prize BOOLEAN NOT NULL DEFAULT FALSE,
  redeemed_at TIMESTAMP WITHOUT TIME ZONE,
  redeemed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  spun_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_wheel_spins_phone ON wheel_spins (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_wheel_spins_status ON wheel_spins (status);
