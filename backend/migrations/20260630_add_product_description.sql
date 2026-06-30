-- Add an editable product description used by the catalog admin and included
-- in the AI sales assistant prompt (helps match tools -> accessories and
-- distinguish similar product variants). Idempotent: the column may already
-- exist on databases bootstrapped from schema.sql / products_seed.sql.
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
