-- Production kanban: add 'soldado' (welding) and re-introduce 'pintado' (painting)
-- as stages; 'embalado' stays. New board order (frontend/backend):
--   impresion_3d, corte_laser, punzonado, plegado, soldado, lavado, pintado, embalado
--
-- Only the metal route uses soldado/pintado; 3D parts still go impresion_3d ->
-- embalado. Existing rows already sit on a subset of the new stage set, so no
-- data remap is needed before widening the CHECK.

ALTER TABLE production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_check;
ALTER TABLE production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_allowed;
ALTER TABLE production_kanban_cards
  ADD CONSTRAINT production_kanban_cards_stage_allowed
  CHECK (stage IN (
    'corte_laser', 'impresion_3d', 'punzonado',
    'plegado', 'soldado', 'lavado', 'pintado', 'embalado'
  ));
