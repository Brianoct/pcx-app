-- Mejoras: lo rutinario se automatiza; el día a día del equipo es mejorar.
--
-- 1) En el Plan del día, "Kaizen" pasa a llamarse "Mejora" (mismo bloque,
--    nueva palabra). Los bloques antiguos se renombran para no perder nada.
ALTER TABLE day_plan_tasks DROP CONSTRAINT IF EXISTS day_plan_tasks_task_type_check;
UPDATE day_plan_tasks SET task_type = 'mejora' WHERE task_type = 'kaizen';
ALTER TABLE day_plan_tasks
  ADD CONSTRAINT day_plan_tasks_task_type_check CHECK (task_type IN ('tarea', '3s', 'mejora'));

-- 2) Registro de mejoras: cada bloque "Mejora" del Plan del día que se marca
--    hecho queda registrado aquí, con la persona y el área del negocio. Es la
--    fuente de la pestaña Mejoras y del resumen por persona en Inicio.
--    Si el bloque del plan se borra después, el registro se conserva.
CREATE TABLE IF NOT EXISTS mejoras (
  id BIGSERIAL PRIMARY KEY,
  day_plan_task_id BIGINT UNIQUE REFERENCES day_plan_tasks(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ventas | almacen | produccion | marketing | admin | general
  area TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  -- Qué cambió / qué se ganó con la mejora (lo completa la persona después).
  detail TEXT,
  task_date DATE NOT NULL,
  completed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mejoras_user_date ON mejoras (user_id, task_date);
CREATE INDEX IF NOT EXISTS idx_mejoras_date ON mejoras (task_date);
CREATE INDEX IF NOT EXISTS idx_mejoras_area ON mejoras (area);

-- 3) Las mejoras que ya estaban marcadas hechas entran al registro con el
--    área deducida del rol de la persona (mismo mapeo que lib/areas.js).
INSERT INTO mejoras (day_plan_task_id, user_id, area, title, task_date, completed_at)
SELECT t.id,
       t.user_id,
       CASE
         WHEN LOWER(COALESCE(u.role, '')) LIKE 'ventas%' OR LOWER(COALESCE(u.role, '')) IN ('sales', 'vendedor') THEN 'ventas'
         WHEN LOWER(COALESCE(u.role, '')) LIKE 'almacen%' THEN 'almacen'
         WHEN LOWER(COALESCE(u.role, '')) LIKE 'produccion%' THEN 'produccion'
         WHEN LOWER(COALESCE(u.role, '')) LIKE 'marketing%' THEN 'marketing'
         WHEN LOWER(COALESCE(u.role, '')) = 'admin' THEN 'admin'
         ELSE 'general'
       END,
       t.title,
       t.task_date,
       t.updated_at
FROM day_plan_tasks t
JOIN users u ON u.id = t.user_id
WHERE t.task_type = 'mejora' AND t.is_done = TRUE
ON CONFLICT (day_plan_task_id) DO NOTHING;
