-- Flujo pieza a pieza en el kanban de producción.
--
-- Hasta ahora un lote vivía entero en UNA etapa (production_kanban_cards.stage)
-- y avanzaba completo. Esta tabla guarda cuántas piezas de cada tarjeta están
-- en cada estación, para poder empujar piezas de a una: baja la cantidad en la
-- estación actual y sube en la siguiente.
--
-- production_kanban_cards.stage pasa a ser el "borde trasero" (la etapa más
-- temprana con piezas), así Planificación y Recepción siguen funcionando sin
-- cambios: una tarjeta llega a 'recepcion' cuando TODAS sus piezas llegaron.
CREATE TABLE IF NOT EXISTS production_kanban_stage_qty (
  card_id INTEGER NOT NULL REFERENCES production_kanban_cards(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (card_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_kanban_stage_qty_stage ON production_kanban_stage_qty (stage);

-- Tarjetas ya en fabricación: todas sus piezas están en su etapa actual.
INSERT INTO production_kanban_stage_qty (card_id, stage, qty)
SELECT id, stage, required_qty
FROM production_kanban_cards
WHERE is_active = TRUE
  AND qty_frozen = TRUE
  AND stage IS NOT NULL
  AND stage <> 'planificacion'
ON CONFLICT (card_id, stage) DO NOTHING;
