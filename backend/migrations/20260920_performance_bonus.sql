-- Bono por desempeño ("si uno cae, caemos todos").
--
-- Cada mes, una puerta de EQUIPO (metas medidas por el sistema, nadie las
-- declara) y una o dos metas PERSONALES. Si todo está en verde, la comisión
-- de la persona sube unos puntos ese mes (tick-up). Solo Admin cambia una
-- meta y cada cambio queda en la bitácora.

CREATE TABLE IF NOT EXISTS performance_goals (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  -- produccion | todos (aplica a cada persona) — otras áreas se agregan después
  area TEXT NOT NULL,
  -- team = puerta compartida del área · personal = meta de cada persona
  scope TEXT NOT NULL CHECK (scope IN ('team', 'personal')),
  -- gte = verde si valor >= umbral · lte = verde si valor <= umbral
  direction TEXT NOT NULL CHECK (direction IN ('gte', 'lte')),
  threshold NUMERIC(10,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Puntos de comisión que se suman en el mes cuando la persona califica.
  tick_up_pct NUMERIC(5,2) NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);
INSERT INTO performance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Bitácora: quién cambió qué meta, de cuánto a cuánto.
CREATE TABLE IF NOT EXISTS performance_goal_log (
  id BIGSERIAL PRIMARY KEY,
  goal_key TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO performance_goals (key, label, area, scope, direction, threshold, unit, description, position) VALUES
  ('prod_on_time', 'Lotes entregados a tiempo', 'produccion', 'team', 'gte', 90, '%',
   'Lotes que llegaron a Embalado en o antes de su fecha de entrega, sobre los lotes con entrega definida del mes.', 1),
  ('prod_rejects', 'Piezas rechazadas', 'produccion', 'team', 'lte', 3, '%',
   'Piezas rechazadas en control de calidad sobre el total inspeccionado en el mes.', 2),
  ('mejora_diaria', 'Mejora registrada por día', 'todos', 'personal', 'gte', 80, '%',
   'Días hábiles del mes (hasta hoy) en los que la persona registró al menos una mejora hecha.', 3),
  ('cowork', 'Bloques en grupo', 'todos', 'personal', 'gte', 4, 'bloques',
   'Bloques del Plan del día del mes en los que la persona trabajó con otros (como dueña o etiquetada).', 4),
  ('station_speed', 'Minutos por pieza en su estación', 'produccion', 'personal', 'lte', 100, '% de la base',
   'Mediana de minutos por pieza este mes en la estación a cargo, como % de su línea base (mediana de los 90 días anteriores). La base solo baja: una mejora se paga una vez y luego es la rutina.', 5)
ON CONFLICT (key) DO NOTHING;
