-- Combo photos, stored in the database like product photos (Render's disk is
-- ephemeral). Mirrors product_assets: image bytes plus an unguessable
-- access_token so the serving URL works in a plain <img> tag and rotates on
-- every re-upload (cache busting). combos.image_url points at
-- /api/combo-assets/<id>/<token>.

ALTER TABLE combos ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS combo_assets (
  combo_id INTEGER PRIMARY KEY REFERENCES combos(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  access_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
