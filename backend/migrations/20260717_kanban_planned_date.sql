-- Production planning moves to its own page: each planning card gets a
-- tentative production date. Until that date arrives (America/La_Paz) the
-- card stays off the production board, accumulating need with the stock sync.
-- When the date arrives the board activates it automatically (freeze + move
-- to the first route stage).

ALTER TABLE production_kanban_cards
  ADD COLUMN IF NOT EXISTS planned_date DATE;
