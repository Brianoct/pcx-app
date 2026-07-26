-- Los combos también pertenecen a una línea (Acero/Armonía): se elige al
-- crearlos y el Catálogo filtra con ella.
ALTER TABLE combos ADD COLUMN IF NOT EXISTS product_line VARCHAR(20);
UPDATE combos SET product_line = 'acero' WHERE product_line IS NULL;
