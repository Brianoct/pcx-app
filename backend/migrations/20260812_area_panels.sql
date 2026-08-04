-- Paneles por área (fase 1: Ventas). El Inicio genérico se reemplaza por un
-- tablero del área cuando el admin lo activa; los flags viven aquí para que
-- Marketing / Producción / Almacén se sumen sin nueva migración.

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO feature_flags (key, enabled) VALUES
  ('panel_ventas', FALSE),
  ('panel_marketing', FALSE),
  ('panel_produccion', FALSE),
  ('panel_almacen', FALSE)
ON CONFLICT (key) DO NOTHING;

-- Metas del equipo de ventas (requerimiento del área): mínima cumple el
-- estándar, esperada es el objetivo, sobresaliente da bono/reconocimiento.
CREATE TABLE IF NOT EXISTS sales_goals (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_target_bs NUMERIC NOT NULL DEFAULT 50000,
  monthly_units_min INTEGER NOT NULL DEFAULT 25,
  monthly_units_expected INTEGER NOT NULL DEFAULT 30,
  monthly_units_high INTEGER NOT NULL DEFAULT 35,
  monthly_new_customers INTEGER NOT NULL DEFAULT 40,
  daily_followups INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sales_goals (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
