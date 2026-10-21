-- Dónde se usará el tablero (por cotización) y cómo nos conoció el cliente.
-- Las filas existentes quedan en NULL y se muestran como «Sin dato».
ALTER TABLE customers ADD COLUMN IF NOT EXISTS segmento TEXT;
-- TRUE = derivado de las cotizaciones o sugerido por el backfill; FALSE = lo
-- confirmó una persona en Clientes.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS segmento_auto BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS origen TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS origen_detalle TEXT;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS uso TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS uso_detalle TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS origen TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS origen_detalle TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS campaign_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_quotes_uso ON quotes (uso);
CREATE INDEX IF NOT EXISTS idx_quotes_origen ON quotes (origen);
CREATE INDEX IF NOT EXISTS idx_customers_segmento ON customers (segmento);
CREATE INDEX IF NOT EXISTS idx_customers_origen ON customers (origen);
