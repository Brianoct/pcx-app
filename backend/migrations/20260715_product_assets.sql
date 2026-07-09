-- Catalog product photos stored in the database (not on Render's ephemeral
-- disk, which wipes uploads on every deploy). Mirrors user_assets: image bytes
-- plus an unguessable access_token so the serving URL works in a plain <img>
-- tag and rotates on every re-upload (cache busting). products.image_url points
-- at /api/product-assets/<sku>/<token>.

CREATE TABLE IF NOT EXISTS product_assets (
  sku VARCHAR(50) PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  access_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
