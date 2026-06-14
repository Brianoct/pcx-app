-- Material procurement (two-bin / Lean replenishment).
--
-- Each material gets a stable qr_token used to build a scan URL. When a bin runs
-- empty a worker scans the QR, which adds the material to a procurement shopping
-- list. The head of procurement works that list (pending -> purchased -> received).

ALTER TABLE production_material_catalog
  ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier TEXT,
  ADD COLUMN IF NOT EXISTS qr_token TEXT;

-- Backfill a unique token per existing material (volatile default => per-row).
UPDATE production_material_catalog
  SET qr_token = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 20)
  WHERE qr_token IS NULL;

ALTER TABLE production_material_catalog
  ALTER COLUMN qr_token SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 20);
ALTER TABLE production_material_catalog
  ALTER COLUMN qr_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_material_qr_token
  ON production_material_catalog (qr_token);

CREATE TABLE IF NOT EXISTS material_purchase_requests (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES production_material_catalog(id) ON DELETE CASCADE,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit_measure TEXT,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  scan_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'purchased', 'received', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'urgent')),
  note TEXT,
  store_location TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  purchased_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  purchased_at TIMESTAMP WITHOUT TIME ZONE,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_material_purchase_requests_status
  ON material_purchase_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_purchase_requests_material
  ON material_purchase_requests (material_id);

-- At most one OPEN (pending/purchased) request per material, so repeated scans
-- of the same material accumulate onto the same shopping-list card (two-bin).
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_purchase_requests_open
  ON material_purchase_requests (material_id)
  WHERE status IN ('pending', 'purchased');
