-- Seed product descriptions for accessories from the PCX catalog (v2.0).
-- These help the AI sales assistant map a customer's tools to the right
-- accessory (e.g. hammer -> Soporte para Martillo) and distinguish variants.
-- Non-destructive: only fills rows whose description is currently empty, so it
-- never overwrites descriptions edited later in the admin panel. No-op for SKUs
-- that don't exist in this database.
UPDATE products SET description = 'Estante amplio para colocar herramientas grandes, suministros o accesorios. Optimiza el espacio vertical.'
  WHERE sku = 'R40N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Estante compacto para herramientas pequeñas o componentes. Ahorra espacio en áreas limitadas.'
  WHERE sku = 'R25N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Soporte para sostener desarmadores (destornilladores) grandes en posición vertical.'
  WHERE sku = 'D40N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Soporte para desarmadores (destornilladores) pequeños, ideal para sets de precisión.'
  WHERE sku = 'D22N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Soporte para llaves (de boca/corona) de tamaño grande. Clasifica llaves por tamaño.'
  WHERE sku = 'L40N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Soporte para llaves (de boca/corona) pequeñas. Organiza herramientas compactas.'
  WHERE sku = 'L22N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Contenedor para almacenar tornillos, tuercas, clavos u otros componentes pequeños.'
  WHERE sku = 'C15N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Gancho o soporte para colgar martillos de forma segura, al alcance de la mano.'
  WHERE sku = 'M08N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Base o soporte para amoladora angular, permitiendo su almacenamiento vertical.'
  WHERE sku = 'A15N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Estante combinado con soporte para rollos (papel, cable o cinta adhesiva). Integra almacenamiento y dispensación.'
  WHERE sku = 'RR15N' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Paquete de 12 ganchos de 5 cm para colgar herramientas ligeras en paneles perforados.'
  WHERE sku = 'G05C' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
UPDATE products SET description = 'Paquete de 12 ganchos de 10 cm para herramientas medianas o pesadas. Soporte robusto.'
  WHERE sku = 'G10C' AND COALESCE(NULLIF(BTRIM(description), ''), '') = '';
