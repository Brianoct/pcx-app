-- Descuento con decimales en cotizaciones.
--
-- quotes.discount_percent era INTEGER, así que un descuento pensado en Bs
-- (p. ej. dejar 1920.60 en 1900 = 1.0726%) hacía fallar TODO el guardado de
-- la edición con "invalid input syntax for type integer" y la cotización
-- "volvía" a su valor anterior. NUMERIC(7,4) admite porcentajes fraccionarios
-- exactos; los valores enteros existentes se conservan tal cual.
ALTER TABLE quotes
  ALTER COLUMN discount_percent TYPE NUMERIC(7,4)
  USING ROUND(COALESCE(discount_percent, 0)::numeric, 4);
