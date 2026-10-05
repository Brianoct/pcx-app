-- Equipos: la capacidad mensual pasa a ser HORAS disponibles por mes y el
-- costo del equipo se reparte por tiempo (Bs/hora × minutos del paso), no
-- un monto fijo por pieza. La columna conserva su nombre; cambia el
-- significado y la unidad queda fija en «horas».
COMMENT ON COLUMN production_equipment_catalog.monthly_capacity_units IS
  'Horas disponibles por mes. Bs/hora = (reposición/vida útil + extra mensual) / horas.';

UPDATE production_equipment_catalog
SET usage_unit = 'horas'
WHERE usage_unit IS DISTINCT FROM 'horas';
