-- Eventos propios del calendario de Marketing (además de campañas y lives):
-- sesiones de fotos, entregas de artes, ferias, etc.
CREATE TABLE IF NOT EXISTS marketing_events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_events_date ON marketing_events (event_date);
