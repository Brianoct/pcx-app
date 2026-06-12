-- Stable short share codes for the public customer catalog.
-- Replaces long JWT share links; one reusable code per seller.
CREATE TABLE IF NOT EXISTS customer_menu_links (
  code TEXT PRIMARY KEY,
  seller_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);
