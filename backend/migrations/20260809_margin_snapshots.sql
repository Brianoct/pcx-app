-- Historial diario de márgenes por producto/combo, alimentado por el brief
-- nocturno (y por "Generar ahora"). De aquí sale la tendencia de Rentabilidad.
CREATE TABLE IF NOT EXISTS product_margin_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  sku TEXT NOT NULL,
  cost NUMERIC(12,2),
  sf_price NUMERIC(12,2),
  margin_pct NUMERIC(6,1),
  UNIQUE (snapshot_date, sku)
);
CREATE INDEX IF NOT EXISTS idx_margin_snapshots_date ON product_margin_snapshots (snapshot_date);
