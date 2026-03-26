ALTER TABLE quotes
ADD COLUMN IF NOT EXISTS alternative_name TEXT,
ADD COLUMN IF NOT EXISTS alternative_phone TEXT;
