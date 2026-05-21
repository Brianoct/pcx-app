-- Enable "comprar" as an explicit production start/stage for resale products.

ALTER TABLE IF EXISTS production_process_routes
  DROP CONSTRAINT IF EXISTS production_process_routes_start_process_check;
ALTER TABLE IF EXISTS production_process_routes
  DROP CONSTRAINT IF EXISTS production_process_routes_start_process_allowed;
ALTER TABLE IF EXISTS production_process_routes
  ADD CONSTRAINT production_process_routes_start_process_allowed
  CHECK (start_process IN ('comprar', 'corte_laser', 'punzonado'));

ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_start_process_check;
ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_start_process_allowed;
ALTER TABLE IF EXISTS production_kanban_cards
  ADD CONSTRAINT production_kanban_cards_start_process_allowed
  CHECK (start_process IN ('comprar', 'corte_laser', 'punzonado'));

ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_check;
ALTER TABLE IF EXISTS production_kanban_cards
  DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_allowed;
ALTER TABLE IF EXISTS production_kanban_cards
  ADD CONSTRAINT production_kanban_cards_stage_allowed
  CHECK (stage IN ('comprar', 'corte_laser', 'punzonado', 'plegado', 'lavado', 'pintado', 'embalado'));
