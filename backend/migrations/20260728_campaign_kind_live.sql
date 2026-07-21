-- Lives de TikTok: reutilizan la maquinaria de campañas (tareas por área,
-- anuncio al equipo, banner en Inicio). kind distingue el tipo; los lives
-- usan una sola fecha (start_date = end_date) más una hora.
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'campana'
  CHECK (kind IN ('campana', 'live'));

ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS live_time TIME;
