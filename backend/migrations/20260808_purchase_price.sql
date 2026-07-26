-- Precio pagado por unidad al marcar una compra como "Comprado". Además de
-- quedar en la solicitud, actualiza production_material_catalog.unit_cost_bs
-- (política de último precio), que alimenta el costeo de Rentabilidad.
ALTER TABLE material_purchase_requests ADD COLUMN IF NOT EXISTS unit_price_bs NUMERIC(12,4);
