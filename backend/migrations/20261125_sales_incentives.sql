-- Incentivos de ventas por esfuerzo — SIMULACIÓN.
--
-- Cada regla mide un comportamiento que la app ya registra sola (nadie lo
-- declara). Si la persona pasa el umbral en el mes, su comisión subiría
-- `bump_pct` puntos. La suma de reglas tiene un tope.
--
-- Esto NO paga nada: solo alimenta la pantalla de Admin que muestra cuánto
-- habría ganado cada persona. Comisiones y Pagos no leen estas tablas.
CREATE TABLE IF NOT EXISTS sales_incentive_rules (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  threshold NUMERIC(6,2) NOT NULL,          -- % mínimo de casos cumplidos
  param NUMERIC(8,2),                       -- plazo de la regla (ver param_unit)
  param_unit TEXT NOT NULL DEFAULT '',      -- horas | minutos | días | ''
  bump_pct NUMERIC(5,2) NOT NULL DEFAULT 0, -- puntos de comisión que suma
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_incentive_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cap_pct NUMERIC(5,2) NOT NULL DEFAULT 1.5,  -- tope de puntos extra en un mes
  min_cases INTEGER NOT NULL DEFAULT 3,       -- con menos casos la regla no se juzga
  updated_by INTEGER,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);
INSERT INTO sales_incentive_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_incentive_rules (key, label, description, threshold, param, param_unit, bump_pct, position) VALUES
  ('seguimiento', 'Seguimiento a cotizaciones abiertas',
   'Cotizaciones del mes que no se cobraron enseguida y a las que se les volvió a escribir por WhatsApp dentro del plazo (o se cobraron dentro del plazo). Cuenta el mensaje, se venda o no.',
   90, 72, 'horas', 0.5, 1),
  ('respuesta', 'Respuesta rápida al cliente',
   'Veces que un cliente escribió en horario de atención (lun–sáb, 9 a 18) y recibió respuesta dentro del plazo.',
   80, 15, 'minutos', 0.4, 2),
  ('tareas', 'Tareas de seguimiento a tiempo',
   'Tareas de seguimiento del inbox que vencían en el mes y se marcaron hechas dentro de la tolerancia.',
   90, 24, 'horas', 0.3, 3),
  ('cobro', 'Cobro rápido',
   'Ventas cobradas en el mes cuyo pago llegó dentro del plazo desde que se creó la cotización.',
   70, 7, 'días', 0.2, 4),
  ('datos', 'Uso y origen registrados',
   'Cotizaciones del mes con "dónde se usará" y "cómo nos conoció" registrados.',
   95, NULL, '', 0.1, 5)
ON CONFLICT (key) DO NOTHING;
