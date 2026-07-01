-- Structured, enrichable product attributes.
--
-- Holds the extra product detail that doesn't warrant its own column:
-- color, size, dimensions, material, weight, load_capacity, variant_group,
-- long_description, plus two arrays — works_with (tools/items an accessory
-- holds) and compatible_boards (board SKUs an accessory fits). Populated via the
-- CSV round-trip in scripts/export-products-csv.js + scripts/import-products-csv.js.
--
-- Kept as JSONB (not many columns) so the attribute set can grow without a new
-- migration each time. Existing rows default to an empty object.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

-- GIN index so compatibility / works_with lookups (e.g. "which accessories fit
-- board X") stay fast as attributes grow.
CREATE INDEX IF NOT EXISTS idx_products_attributes
  ON products USING GIN (attributes);
