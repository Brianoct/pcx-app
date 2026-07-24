-- Analista nocturno: cada mañana se genera un "Resumen de la mañana" con lo que
-- necesita atención (stock bajo mínimo, pedidos por preparar, cotizaciones
-- estancadas, ventas vs. semana previa, etc.). Los números se calculan en el
-- servidor; la IA (si está configurada) solo redacta el resumen a partir de esos
-- números — nunca hace la matemática ni ve datos sensibles de clientes.
CREATE TABLE IF NOT EXISTS daily_briefs (
  id SERIAL PRIMARY KEY,
  brief_date DATE NOT NULL UNIQUE,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  headline TEXT,
  body_md TEXT,
  flags JSONB NOT NULL DEFAULT '[]',
  metrics JSONB NOT NULL DEFAULT '{}',
  provider VARCHAR(32) NOT NULL DEFAULT 'template',
  model VARCHAR(64)
);
