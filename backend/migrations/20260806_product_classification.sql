-- Clasificación de productos: línea (Acero/Armonía), tipo (Tablero/Accesorio/
-- Combo) y material (Metal/Plástico/Mixto). Backfill sensato: los tableros se
-- reconocen por SKU/nombre, el resto queda como accesorio; todo el catálogo
-- actual es línea Acero y metal (Admin ajusta las excepciones).
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_line VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS material VARCHAR(20);

UPDATE products
SET product_type = CASE
  WHEN UPPER(sku) LIKE 'T%' OR LOWER(name) LIKE '%tablero%' THEN 'tablero'
  ELSE 'accesorio'
END
WHERE product_type IS NULL;

UPDATE products SET product_line = 'acero' WHERE product_line IS NULL;
UPDATE products SET material = 'metal' WHERE material IS NULL;

-- El menú público agrupa por menu_category; mantenerla coherente con el tipo.
UPDATE products
SET menu_category = CASE WHEN product_type = 'tablero' THEN 'Tableros' ELSE 'Accesorios' END
WHERE menu_category IS NULL OR BTRIM(menu_category) = '';
