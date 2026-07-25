-- Alias agregados por Admin al reclasificar destinos históricos. Viven en una
-- columna separada porque el sync del arranque sobreescribe search_terms.
ALTER TABLE geo_destinations ADD COLUMN IF NOT EXISTS extra_terms TEXT NOT NULL DEFAULT '';
