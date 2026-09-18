-- Co-work: cada ítem del checklist de un bloque puede tener una persona
-- asignada (la dueña del bloque o alguien de su grupo). Su nombre aparece
-- junto al ítem y cada quien marca lo suyo.
ALTER TABLE day_plan_subtasks
  ADD COLUMN IF NOT EXISTS assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
