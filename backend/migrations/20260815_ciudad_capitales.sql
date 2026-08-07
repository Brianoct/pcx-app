-- Ciudades faltantes en clientes/cotizaciones antiguas: cuando el campo libre
-- de antes guardó la PROVINCIA (Murillo, Tomás Frías, Cercado, Andrés
-- Ibáñez…), la ciudad quedó vacía y el CRM/etiquetas mostraban la provincia.
-- Las provincias capitalinas mapean sin ambigüedad a su ciudad capital; las
-- «Cercado» (existen en 4 departamentos) exigen coincidir el departamento.

-- 1) Cotizaciones: ciudad desde la provincia capitalina (sin ambigüedad).
UPDATE quotes q
SET ciudad = cap.ciudad
FROM (VALUES
  ('murillo', 'La Paz'),
  ('tomás frías', 'Potosí'),
  ('tomas frias', 'Potosí'),
  ('andrés ibáñez', 'Santa Cruz de la Sierra'),
  ('andres ibañez', 'Santa Cruz de la Sierra'),
  ('andres ibanez', 'Santa Cruz de la Sierra'),
  ('oropeza', 'Sucre'),
  ('nicolás suárez', 'Cobija'),
  ('nicolas suarez', 'Cobija')
) AS cap(provincia, ciudad)
WHERE COALESCE(TRIM(q.ciudad), '') = ''
  AND LOWER(TRIM(COALESCE(q.provincia, ''))) = cap.provincia;

-- 2) Cotizaciones: «Cercado» según departamento.
UPDATE quotes q
SET ciudad = cap.ciudad
FROM (VALUES
  ('cochabamba', 'Cochabamba'),
  ('oruro', 'Oruro'),
  ('tarija', 'Tarija'),
  ('beni', 'Trinidad')
) AS cap(departamento, ciudad)
WHERE COALESCE(TRIM(q.ciudad), '') = ''
  AND LOWER(TRIM(COALESCE(q.provincia, ''))) = 'cercado'
  AND LOWER(TRIM(COALESCE(q.department, ''))) = cap.departamento;

-- 3) Clientes: re-tomar la ciudad desde su cotización más reciente (ahora que
--    las cotizaciones antiguas también tienen ciudad).
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

-- 4) Clientes sin cotización con ciudad: mismo mapa capitalino sobre SU
--    provincia guardada.
UPDATE customers c
SET ciudad = cap.ciudad
FROM (VALUES
  ('murillo', 'La Paz'),
  ('tomás frías', 'Potosí'),
  ('tomas frias', 'Potosí'),
  ('andrés ibáñez', 'Santa Cruz de la Sierra'),
  ('andres ibañez', 'Santa Cruz de la Sierra'),
  ('andres ibanez', 'Santa Cruz de la Sierra'),
  ('oropeza', 'Sucre'),
  ('nicolás suárez', 'Cobija'),
  ('nicolas suarez', 'Cobija')
) AS cap(provincia, ciudad)
WHERE COALESCE(TRIM(c.ciudad), '') = ''
  AND LOWER(TRIM(COALESCE(c.provincia, ''))) = cap.provincia;

UPDATE customers c
SET ciudad = cap.ciudad
FROM (VALUES
  ('cochabamba', 'Cochabamba'),
  ('oruro', 'Oruro'),
  ('tarija', 'Tarija'),
  ('beni', 'Trinidad')
) AS cap(departamento, ciudad)
WHERE COALESCE(TRIM(c.ciudad), '') = ''
  AND LOWER(TRIM(COALESCE(c.provincia, ''))) = 'cercado'
  AND LOWER(TRIM(COALESCE(c.department, ''))) = cap.departamento;
