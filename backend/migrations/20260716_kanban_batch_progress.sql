-- Piece-progress counter on production cards: operators tick off pieces as
-- they work a lote in its current stage ("3/20"). Reset to 0 on every stage
-- move — each stage processes the whole batch again.

ALTER TABLE production_kanban_cards
  ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0;
