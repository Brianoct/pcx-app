-- Simplify the production kanban so it only tracks manufacturing.
-- Changes:
--   * Remove "comprar" from production (purchasing moves to a dedicated board later).
--   * Add "impresion_3d" as a process/start.
--   * Drop "pintado".
--   * Finishing order is now lavado -> plegado.
--
-- "comprar" is kept as a valid start_process in production_process_routes so a
-- product can still be classified as resale (and therefore excluded from the
-- production board), ready for the future purchasing board.

ALTER TABLE IF EXISTS production_process_routes
  DROP CONSTRAINT IF EXISTS production_process_routes_start_process_check;
ALTER TABLE IF EXISTS production_process_routes
  DROP CONSTRAINT IF EXISTS production_process_routes_start_process_allowed;
ALTER TABLE IF EXISTS production_process_routes
  ADD CONSTRAINT production_process_routes_start_process_allowed
  CHECK (start_process IN ('comprar', 'corte_laser', 'impresion_3d', 'punzonado'));

-- Normalize existing card rows onto the new stage/start set before tightening
-- the CHECK constraints (constraints apply to every row, active or not).
UPDATE production_kanban_cards SET stage = 'embalado' WHERE stage = 'pintado';
UPDATE production_kanban_cards
  SET is_active = FALSE, updated_at = NOW()
  WHERE stage = 'comprar' OR start_process = 'comprar';
UPDATE production_kanban_cards
  SET stage = 'corte_laser'
  WHERE stage NOT IN ('corte_laser', 'impresion_3d', 'punzonado', 'lavado', 'plegado', 'embalado');
UPDATE production_kanban_cards
  SET start_process = 'corte_laser'
  WHERE start_process NOT IN ('corte_laser', 'impresion_3d', 'punzonado');

ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_start_process_check;
ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_start_process_allowed;
ALTER TABLE IF EXISTS production_kanban_cards
  ADD CONSTRAINT production_kanban_cards_start_process_allowed
  CHECK (start_process IN ('corte_laser', 'impresion_3d', 'punzonado'));

ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_check;
ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_allowed;
ALTER TABLE IF EXISTS production_kanban_cards
  ADD CONSTRAINT production_kanban_cards_stage_allowed
  CHECK (stage IN ('corte_laser', 'impresion_3d', 'punzonado', 'lavado', 'plegado', 'embalado'));
