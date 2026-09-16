-- Mejoras en grupo: un bloque "Mejora" del Plan del día puede tener varias
-- personas etiquetadas. El bloque se ve en la columna de cada participante y,
-- al completarse, cada uno recibe su registro de mejora (misma mejora, misma
-- clave de grupo).

CREATE TABLE IF NOT EXISTS day_plan_task_participants (
  task_id BIGINT NOT NULL REFERENCES day_plan_tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_day_plan_task_participants_user ON day_plan_task_participants (user_id);

-- group_key agrupa los registros de una misma mejora (uno por persona). Copia
-- del id del bloque, sin FK: si el bloque se borra, el grupo sigue unido.
ALTER TABLE mejoras ADD COLUMN IF NOT EXISTS group_key BIGINT;
UPDATE mejoras SET group_key = COALESCE(day_plan_task_id, id) WHERE group_key IS NULL;
ALTER TABLE mejoras ALTER COLUMN group_key SET NOT NULL;

ALTER TABLE mejoras DROP CONSTRAINT IF EXISTS mejoras_day_plan_task_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mejoras_group_user ON mejoras (group_key, user_id);
CREATE INDEX IF NOT EXISTS idx_mejoras_task ON mejoras (day_plan_task_id);
