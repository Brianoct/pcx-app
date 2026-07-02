-- Phase 3 of the product-structure redesign: BOM quantities + labor rate.
--
-- product_material_map (until now a flat product<->material association from
-- the catalog admin) becomes the bill of materials: qty_per_unit says how much
-- of the material one finished piece consumes, and process (optional) says at
-- which route step it is consumed — that's where the future sampling tasks
-- will ask "¿cuánta pintura usaste?".
--
-- production_settings is a singleton for plant-wide costing knobs; for now
-- just the labor rate used to turn product_process_steps.std_minutes into Bs.

ALTER TABLE product_material_map
  ADD COLUMN IF NOT EXISTS qty_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS process TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_material_map_qty_chk'
  ) THEN
    ALTER TABLE product_material_map
      ADD CONSTRAINT product_material_map_qty_chk CHECK (qty_per_unit >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_material_map_process_chk'
  ) THEN
    ALTER TABLE product_material_map
      ADD CONSTRAINT product_material_map_process_chk CHECK (process IS NULL OR process IN (
        'impresion_3d', 'corte_laser', 'punzonado', 'plegado',
        'soldado', 'lavado', 'pintado', 'embalado'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS production_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  labor_rate_bs_hour NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT production_settings_labor_rate_chk CHECK (labor_rate_bs_hour >= 0)
);

INSERT INTO production_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
