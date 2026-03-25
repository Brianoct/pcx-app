CREATE TABLE IF NOT EXISTS role_panel_defaults (
  role TEXT PRIMARY KEY,
  panel_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO role_panel_defaults (role, panel_access)
VALUES
  (
    'Ventas',
    '{
      "cotizar": true,
      "historial_individual": true,
      "rendimiento_individual": true
    }'::jsonb
  ),
  (
    'Ventas Lider',
    '{
      "cotizar": true,
      "historial_global": true,
      "rendimiento_global": true
    }'::jsonb
  ),
  (
    'Almacen',
    '{
      "pedidos_individual": true,
      "inventario_individual": true
    }'::jsonb
  ),
  (
    'Almacen Lider',
    '{
      "pedidos_global": true,
      "inventario_global": true
    }'::jsonb
  ),
  (
    'Marketing',
    '{
      "marketing_combos": true,
      "marketing_cupones": true
    }'::jsonb
  ),
  (
    'Marketing Lider',
    '{
      "marketing_combos": true,
      "marketing_cupones": true
    }'::jsonb
  ),
  (
    'Admin',
    '{
      "cotizar": true,
      "historial_individual": true,
      "historial_global": true,
      "rendimiento_individual": true,
      "rendimiento_global": true,
      "pedidos_individual": true,
      "pedidos_global": true,
      "inventario_individual": true,
      "inventario_global": true,
      "marketing_combos": true,
      "marketing_cupones": true,
      "admin": true
    }'::jsonb
  )
ON CONFLICT (role) DO NOTHING;
