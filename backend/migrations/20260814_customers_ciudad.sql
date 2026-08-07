-- La ficha del cliente guarda la CIUDAD real del catálogo geo, no solo la
-- provincia (la columna «Ciudad» del CRM mostraba provincias como «Murillo»
-- o «Andrés Ibáñez» — mismo problema ya corregido en la etiqueta de Pedidos).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS ciudad TEXT;

-- Backfill: la ciudad de la cotización más reciente de cada cliente.
UPDATE customers c
SET ciudad = q.ciudad
FROM (
  SELECT DISTINCT ON (regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'))
         regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g') AS phone_norm,
         ciudad
  FROM quotes
  WHERE COALESCE(TRIM(ciudad), '') <> ''
  ORDER BY regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), created_at DESC
) q
WHERE c.phone_normalized = q.phone_norm
  AND COALESCE(TRIM(c.ciudad), '') = '';
