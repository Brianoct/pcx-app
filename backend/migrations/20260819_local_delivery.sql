-- Envío local por ciudad: Almacén fija el punto del almacén y anillos de
-- distancia con precio. Cotizar y WhatsApp calculan el costo desde el GPS
-- que manda el cliente.
CREATE TABLE IF NOT EXISTS local_delivery_settings (
  city TEXT PRIMARY KEY,
  origin_lat NUMERIC(9,6),
  origin_lng NUMERIC(9,6),
  rings JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO local_delivery_settings (city, rings, active)
VALUES ('Cochabamba', '[]'::jsonb, TRUE), ('Santa Cruz', '[]'::jsonb, TRUE)
ON CONFLICT (city) DO NOTHING;

-- El envío cotizado viaja con la cotización: cargo, etiqueta y el GPS del
-- cliente (para que Almacén abra el mapa al despachar).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS delivery_fee_bs NUMERIC(10,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS delivery_label TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS delivery_gps TEXT;
