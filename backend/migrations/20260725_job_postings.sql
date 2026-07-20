-- Trabaja con nosotros: convocatorias de trabajo que el admin publica y que
-- se muestran en la página pública de carreras (/#/carreras).
CREATE TABLE IF NOT EXISTS job_postings (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'Tiempo completo',
  description TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_active
  ON job_postings (is_active, created_at DESC);
