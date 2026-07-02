-- Min/Max inventory (classic (s,S) replenishment).
-- min_stock_* triggers production; max_stock_* is the order-up-to level: when
-- stock drops below min, the kanban card asks for (max - stock) pieces and the
-- card stays active until stock reaches max. max = 0 means "not configured"
-- and the previous replenish-to-min behavior applies.

ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock_cochabamba INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock_santacruz INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock_lima INTEGER NOT NULL DEFAULT 0;
