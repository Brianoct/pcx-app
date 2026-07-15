-- Campañas: Marketing organiza campañas (1-2 por mes) y comunica a cada área
-- sus responsabilidades. Cada área marca sus tareas; Marketing ve el avance.

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador', 'anunciada', 'finalizada')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaign_tasks (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  area TEXT NOT NULL
    CHECK (area IN ('ventas', 'almacen', 'produccion', 'marketing', 'admin')),
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_by INTEGER REFERENCES users(id),
  done_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaign_tasks_campaign
  ON marketing_campaign_tasks (campaign_id, area, position);
