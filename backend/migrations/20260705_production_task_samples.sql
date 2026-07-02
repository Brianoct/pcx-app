-- Phase 4: random measurement tasks on the production board.
--
-- When a card enters a stage that consumes BOM materials (product_material_map
-- .process), the backend rolls sampling_rate_pct per material and may create a
-- task: the operator records how much material the batch actually used
-- ("¿cuánta pintura usaste para pintar N piezas de T9495R?"). Completed
-- samples build the actual-cost baseline compared against the BOM standard.
--
-- qty_used is for the WHOLE batch; batch_qty (pieces at prompt time) turns it
-- into a per-piece actual for variance (qty_used / batch_qty vs qty_per_unit).

ALTER TABLE production_settings
  ADD COLUMN IF NOT EXISTS sampling_rate_pct INTEGER NOT NULL DEFAULT 25;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_settings_sampling_chk'
  ) THEN
    ALTER TABLE production_settings
      ADD CONSTRAINT production_settings_sampling_chk
      CHECK (sampling_rate_pct >= 0 AND sampling_rate_pct <= 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS production_task_samples (
  id BIGSERIAL PRIMARY KEY,
  card_id INTEGER REFERENCES production_kanban_cards(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  store_location TEXT NOT NULL,
  process TEXT NOT NULL CHECK (process IN (
    'impresion_3d', 'corte_laser', 'punzonado', 'plegado',
    'soldado', 'lavado', 'pintado', 'embalado'
  )),
  material_id BIGINT NOT NULL REFERENCES production_material_catalog(id) ON DELETE CASCADE,
  batch_qty INTEGER NOT NULL DEFAULT 0,
  qty_used NUMERIC(12,4),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  prompted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT production_task_samples_qty_chk CHECK (qty_used IS NULL OR qty_used >= 0),
  CONSTRAINT production_task_samples_batch_chk CHECK (batch_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_production_task_samples_card
  ON production_task_samples (card_id, status);
CREATE INDEX IF NOT EXISTS idx_production_task_samples_sku
  ON production_task_samples (sku, material_id, status);

-- One open question per card+process+material at a time; repeated stage
-- entries don't pile up duplicate prompts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_task_samples_open
  ON production_task_samples (card_id, process, material_id)
  WHERE status = 'pending';
