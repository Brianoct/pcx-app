-- Sitio público editable por Marketing.
--  site_pages: el contenido de cada página (por ahora 'home') como JSON:
--    draft = lo que Marketing está preparando · published = lo que ve el
--    visitante. Diseño (grilla, tipografía, colores) vive en el código;
--    aquí solo textos, imágenes, precios, orden y visibilidad de secciones.
--  site_assets: fotos del sitio en la base (el disco de Render es efímero),
--    servidas por URL con token como las fotos de productos.
CREATE TABLE IF NOT EXISTS site_pages (
  key TEXT PRIMARY KEY,
  draft JSONB,
  published JSONB,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS site_assets (
  key TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  access_token TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO site_pages (key) VALUES ('home') ON CONFLICT (key) DO NOTHING;
