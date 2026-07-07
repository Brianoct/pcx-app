-- Wheel prizes now map onto real quote fields: a slice can be a percent
-- discount, a gift product (SKU), or plain text. The winning values are
-- denormalized onto the spin so Cotizar can auto-fill descuento/regalo, and
-- redemption records which quote consumed the prize.

ALTER TABLE wheel_spins
  ADD COLUMN IF NOT EXISTS prize_type TEXT,
  ADD COLUMN IF NOT EXISTS prize_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS prize_gift_sku TEXT,
  ADD COLUMN IF NOT EXISTS redeemed_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL;
