-- Comisiones por fecha de cobro, con cierre de mes.
--
-- Antes la comisión se contaba por el mes en que se CREÓ la cotización: una
-- venta creada el 28 y cobrada el 3 caía en un mes ya pagado y nadie la veía.
-- Ahora cada cobro, envío, reverso o cambio de total escribe un asiento en
-- este libro, fechado en el mes abierto. Un mes cerrado no vuelve a moverse.
--
-- Los nombres `total` y `created_at` son a propósito los mismos de quotes:
-- las consultas de comisión solo cambian la tabla y siguen usando los mismos
-- filtros de fecha.
CREATE TABLE IF NOT EXISTS commission_entries (
  id BIGSERIAL PRIMARY KEY,
  quote_id BIGINT,                                   -- sin FK: el asiento sobrevive si se borra la cotización
  kind TEXT NOT NULL CHECK (kind IN ('venta', 'envio')),
  user_id BIGINT,
  store_location TEXT,
  total NUMERIC(14,2) NOT NULL,                      -- positivo = suma; negativo = reverso o ajuste
  reason TEXT NOT NULL DEFAULT 'pago',               -- pago | envio | reverso | ajuste | historico
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()  -- fecha que cuenta para la comisión
);
CREATE INDEX IF NOT EXISTS idx_commission_entries_period ON commission_entries (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_commission_entries_quote ON commission_entries (quote_id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_user ON commission_entries (user_id, created_at);

-- Meses cerrados: la foto de lo que se pagó a cada persona.
CREATE TABLE IF NOT EXISTS commission_closures (
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  snapshot JSONB NOT NULL,
  closed_by BIGINT,
  closed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_year, period_month)
);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITHOUT TIME ZONE;

-- Historia: lo ya cobrado queda en el mes en que se creó, igual que hasta hoy,
-- para que ningún mes pasado cambie. (Confirmado deja de contar: no es cobro.)
INSERT INTO commission_entries (quote_id, kind, user_id, store_location, total, reason, created_at)
SELECT q.id, 'venta', q.user_id, q.store_location, COALESCE(q.total, 0), 'historico', q.created_at
FROM quotes q
WHERE q.status IN ('Pagado', 'Embalado', 'Enviado')
  AND NOT EXISTS (SELECT 1 FROM commission_entries e WHERE e.quote_id = q.id AND e.kind = 'venta');

INSERT INTO commission_entries (quote_id, kind, user_id, store_location, total, reason, created_at)
SELECT q.id, 'envio', q.user_id, q.store_location, COALESCE(q.total, 0), 'historico', q.created_at
FROM quotes q
WHERE q.status = 'Enviado'
  AND NOT EXISTS (SELECT 1 FROM commission_entries e WHERE e.quote_id = q.id AND e.kind = 'envio');

UPDATE quotes SET paid_at = created_at
WHERE paid_at IS NULL AND status IN ('Pagado', 'Embalado', 'Enviado');
