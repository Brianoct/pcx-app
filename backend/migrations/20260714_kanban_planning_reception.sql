-- Kanban rework: planning column, frozen quantities, and warehouse reception.
--
-- 1) qty_frozen: once a card leaves "Planificación" its quantity is a fixed
--    production order — the inventory sync must not rewrite it (the bug where
--    card quantities drifted mid-fabrication) nor auto-deactivate the card.
-- 2) New first stage 'planificacion' (cards pile up before work starts; qty
--    stays fluid there) and new last stage 'recepcion' (goods travel to the
--    sede; stock is only added for pieces confirmed intact on arrival).

-- The stage check must learn the two new stages BEFORE any row is moved.
ALTER TABLE production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_allowed;
ALTER TABLE production_kanban_cards
  ADD CONSTRAINT production_kanban_cards_stage_allowed
  CHECK (stage IN (
    'planificacion', 'corte_laser', 'impresion_3d', 'punzonado', 'plegado',
    'soldado', 'lavado', 'pintado', 'embalado', 'recepcion'
  ));

ALTER TABLE production_kanban_cards
  ADD COLUMN IF NOT EXISTS qty_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- Cards already mid-fabrication keep their current quantity from now on.
UPDATE production_kanban_cards
SET qty_frozen = TRUE
WHERE is_active = TRUE
  AND stage IS NOT NULL
  AND stage NOT IN ('corte_laser', 'impresion_3d', 'punzonado');

-- Cards still sitting in their start column were waiting to begin: they move
-- to the new planning column (quantity keeps adjusting with stock there).
UPDATE production_kanban_cards
SET stage = 'planificacion'
WHERE is_active = TRUE
  AND (stage IS NULL OR stage IN ('corte_laser', 'impresion_3d', 'punzonado'));
