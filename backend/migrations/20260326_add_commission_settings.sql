CREATE TABLE IF NOT EXISTS commission_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO commission_settings (id, settings)
VALUES (
  1,
  '{
    "ventas_lider_percent": 5,
    "ventas_top_percent": 12,
    "ventas_regular_percent": 8,
    "marketing_lider_percent": 5,
    "almacen_percent": 5
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;
