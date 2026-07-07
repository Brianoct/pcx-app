-- Gift slices can offer TWO product options (e.g. tablero Acero vs Armonía).
-- The winning spin carries both; the salesperson picks one in Cotizar
-- according to what the customer wants.

ALTER TABLE wheel_spins
  ADD COLUMN IF NOT EXISTS prize_gift_sku_2 TEXT;
