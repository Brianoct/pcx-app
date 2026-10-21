-- Backfill de segmento para los clientes existentes, a partir del nombre.
-- Es una sugerencia: queda con segmento_auto = TRUE y segmento_fuente =
-- 'nombre' para que Ventas la confirme o corrija en Clientes. Nunca pisa un
-- segmento ya cargado.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS segmento_fuente TEXT;

UPDATE customers
SET segmento = 'taller_mecanico', segmento_auto = TRUE, segmento_fuente = 'nombre', updated_at = NOW()
WHERE segmento IS NULL
  AND name ~* '(taller|mec[aá]nic|automotr|motors|motores|llanter|lubricent|carrocer)';

UPDATE customers
SET segmento = 'empresa_oficina', segmento_auto = TRUE, segmento_fuente = 'nombre', updated_at = NOW()
WHERE segmento IS NULL
  AND name ~* '(\mS\.?\s?R\.?\s?L\.?|\mS\.?\s?A\.?(\M|$)|\mLtda\.?|\mSRL\M|\mS\.A\.S\M|\mimportadora\M|\mempresa\M|\mconstructora\M)';

UPDATE customers
SET segmento = 'ferreteria_revendedor', segmento_auto = TRUE, segmento_fuente = 'nombre', updated_at = NOW()
WHERE segmento IS NULL
  AND name ~* '(ferreter|comercial\M|distribuidor|revend)';

-- Lo que ya se derivó de cotizaciones (PR anterior) queda marcado como tal.
UPDATE customers SET segmento_fuente = 'cotizaciones'
WHERE segmento IS NOT NULL AND segmento_auto = TRUE AND segmento_fuente IS NULL;
