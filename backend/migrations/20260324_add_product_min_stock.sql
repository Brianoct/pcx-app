-- Add per-warehouse minimum stock thresholds to products.
-- Default 0 keeps backward compatibility until values are configured.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_stock_cochabamba INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_santacruz INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_lima INTEGER NOT NULL DEFAULT 0;

-- Defensive cleanup for old rows if NULLs existed before constraints/defaults.
UPDATE products
SET
  min_stock_cochabamba = COALESCE(min_stock_cochabamba, 0),
  min_stock_santacruz = COALESCE(min_stock_santacruz, 0),
  min_stock_lima = COALESCE(min_stock_lima, 0)
WHERE
  min_stock_cochabamba IS NULL
  OR min_stock_santacruz IS NULL
  OR min_stock_lima IS NULL;
