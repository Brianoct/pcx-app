-- La Forja: programa de entrenamiento de élite (6 semanas), separado del
-- negocio del día a día. Candidatos con número (estilo dorsal), desafíos por
-- semana con calificación 0-100 y bitácora de notas por candidato.

CREATE TABLE IF NOT EXISTS training_candidates (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 99),
  phone TEXT,
  city TEXT,
  objective TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'activo'
    CHECK (status IN ('activo', 'graduado', 'baja')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El número identifica al candidato durante la instrucción: único entre los
-- activos; los graduados/bajas liberan el número para futuras promociones.
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_number_active
  ON training_candidates (number)
  WHERE status = 'activo';

CREATE TABLE IF NOT EXISTS training_challenges (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  week INTEGER NOT NULL DEFAULT 1 CHECK (week BETWEEN 1 AND 6),
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_scores (
  candidate_id BIGINT NOT NULL REFERENCES training_candidates(id) ON DELETE CASCADE,
  challenge_id BIGINT NOT NULL REFERENCES training_challenges(id) ON DELETE CASCADE,
  score NUMERIC(5,1) NOT NULL CHECK (score BETWEEN 0 AND 100),
  comment TEXT NOT NULL DEFAULT '',
  graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  graded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (candidate_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS training_notes (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES training_candidates(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_notes_candidate
  ON training_notes (candidate_id, created_at DESC);
