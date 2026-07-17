-- Plan del día: cada tarea se categoriza para la reunión de la mañana.
--   tarea  = trabajo normal (color del usuario)
--   3s     = Lean 3S en su área (apariencia fija para todo el equipo)
--   kaizen = mejora del día (apariencia fija para todo el equipo)
ALTER TABLE day_plan_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'tarea'
  CHECK (task_type IN ('tarea', '3s', 'kaizen'));
