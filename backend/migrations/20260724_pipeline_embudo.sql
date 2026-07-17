-- Embudo de ventas (estilo Pipedrive), fase 1.
--   - Nueva etapa 'perdido' con motivo de pérdida.
--   - stage_changed_at: cuándo entró el cliente a su etapa actual (alertas de
--     tratos estancados + tasa de cierre del mes).
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_pipeline_stage_check;
ALTER TABLE customers ADD CONSTRAINT customers_pipeline_stage_check
  CHECK (pipeline_stage IN ('contactado', 'cotizado', 'negociando', 'cliente', 'inactivo', 'perdido'));

ALTER TABLE customers ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Aproximación inicial: la última actualización del cliente. (La migración
-- corre una sola vez; el endpoint mantiene el valor de aquí en adelante.)
UPDATE customers SET stage_changed_at = COALESCE(updated_at, created_at, NOW());
