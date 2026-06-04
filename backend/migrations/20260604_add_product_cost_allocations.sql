-- Product cost allocation model for admin pricing controls.
-- Final product price is computed from cost components + utilidad.

CREATE TABLE IF NOT EXISTS product_cost_allocations (
  sku TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
  acero_carbono_09mm NUMERIC(12,2) NOT NULL DEFAULT 0,
  pintura_electrostatica NUMERIC(12,2) NOT NULL DEFAULT 0,
  laser_punzonado NUMERIC(12,2) NOT NULL DEFAULT 0,
  laser_punzonado_mode TEXT NOT NULL DEFAULT 'laser',
  equipo_plegado NUMERIC(12,2) NOT NULL DEFAULT 0,
  equipos_pintura NUMERIC(12,2) NOT NULL DEFAULT 0,
  equipos_soldadura NUMERIC(12,2) NOT NULL DEFAULT 0,
  equipos_corte NUMERIC(12,2) NOT NULL DEFAULT 0,
  carton_corrugado NUMERIC(12,2) NOT NULL DEFAULT 0,
  cinta_embalaje NUMERIC(12,2) NOT NULL DEFAULT 0,
  utilidad NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT product_cost_allocations_mode_chk
    CHECK (laser_punzonado_mode IN ('laser', 'punzonadora'))
);
