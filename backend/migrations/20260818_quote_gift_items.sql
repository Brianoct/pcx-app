-- Regalo multi-producto: la promo «Regalo por compra» entrega un paquete
-- (p. ej. 6 ganchos J + 1 bandeja), no un solo producto. gift_items guarda la
-- lista [{sku, qty, name}] del regalo de la cotización; cada ítem descuenta y
-- repone su propio stock. Los campos gift_sku/gift_qty/gift_name se conservan
-- para las cotizaciones históricas (ruleta) y como resumen legible
-- (gift_name) cuando el regalo es un paquete.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS gift_items JSONB;
