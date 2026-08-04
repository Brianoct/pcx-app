-- Checklist dentro de un bloque del Plan del día: un bloque de tiempo puede
-- contener varias tareas con checkbox; el bloque muestra el % de avance y se
-- marca hecho solo cuando toda la lista está completa.

CREATE TABLE IF NOT EXISTS day_plan_subtasks (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES day_plan_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_day_plan_subtasks_task ON day_plan_subtasks (task_id, position, id);
