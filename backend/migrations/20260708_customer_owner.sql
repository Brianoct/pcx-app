-- Customer ownership (cartera): each customer belongs to the sales rep who
-- first attended them. Subsequent quotes are credited to the owner, and
-- incoming WhatsApp conversations from a known customer are assigned straight
-- to their rep — without consuming a round-robin turn, so new-customer
-- distribution stays even.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_assigned_user
  ON customers (assigned_user_id);

-- Backfill: owner = rep of the FIRST quote ever made to that phone.
UPDATE customers c
SET assigned_user_id = fq.user_id
FROM (
  SELECT DISTINCT ON (regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g'))
    regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g') AS phone_normalized,
    q.user_id
  FROM quotes q
  WHERE regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g') <> ''
    AND q.user_id IS NOT NULL
  ORDER BY regexp_replace(COALESCE(q.customer_phone, ''), '\D', '', 'g'), q.created_at ASC
) fq
WHERE c.phone_normalized = fq.phone_normalized
  AND c.assigned_user_id IS NULL;
