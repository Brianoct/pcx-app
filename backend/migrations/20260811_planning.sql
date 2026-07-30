-- Planificación estratégica: Programa (área) → Operación → Misión → Tarea.
-- Una operación es una iniciativa grande (ej: instalar una fábrica en Lima);
-- cada área (programa) aporta misiones con objetivo, y cada misión se
-- descompone en tareas con fecha. Las tareas se pueden enviar al Plan del día.

CREATE TABLE IF NOT EXISTS planning_operations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'pausada', 'completada')),
  start_date DATE,
  end_date DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- El "programa" es el área: marketing, ventas, almacen, produccion o
-- admin (Desarrollo). Mismas claves que AREA_LABELS del frontend.
CREATE TABLE IF NOT EXISTS planning_missions (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES planning_operations(id) ON DELETE CASCADE,
  area TEXT NOT NULL CHECK (area IN ('marketing', 'ventas', 'almacen', 'produccion', 'admin')),
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'completada')),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planning_missions_operation ON planning_missions (operation_id);

CREATE TABLE IF NOT EXISTS planning_tasks (
  id BIGSERIAL PRIMARY KEY,
  mission_id BIGINT NOT NULL REFERENCES planning_missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date DATE,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  done_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planning_tasks_mission ON planning_tasks (mission_id);

-- Vínculo con el Plan del día: al enviar una tarea de planificación, se crea
-- una entrada en day_plan_tasks apuntando aquí. Marcarla hecha en cualquiera
-- de los dos lados sincroniza el otro.
ALTER TABLE day_plan_tasks
  ADD COLUMN IF NOT EXISTS planning_task_id BIGINT REFERENCES planning_tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_day_plan_tasks_planning ON day_plan_tasks (planning_task_id) WHERE planning_task_id IS NOT NULL;
