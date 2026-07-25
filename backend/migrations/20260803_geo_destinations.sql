-- Catálogo canónico de destinos de envío (departamento → provincia → municipio).
-- Los datos se siembran al arrancar el servidor desde data/boliviaGeo.js
-- (upsert idempotente), así el catálogo se corrige/amplía sin migraciones.
CREATE TABLE IF NOT EXISTS geo_destinations (
  id SERIAL PRIMARY KEY,
  departamento VARCHAR(40) NOT NULL,
  provincia VARCHAR(60) NOT NULL,
  municipio VARCHAR(80) NOT NULL,
  search_terms TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (departamento, provincia, municipio)
);

-- Destino canónico en cotizaciones. Las columnas legacy department/provincia se
-- conservan y se llenan con los valores canónicos cuando hay dest_geo_id, así
-- todos los consumidores existentes (mapa, rankings, PDF) mejoran sin cambios.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS ciudad VARCHAR(80);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS dest_geo_id INTEGER REFERENCES geo_destinations(id) ON DELETE SET NULL;
