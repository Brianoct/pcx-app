-- Employee profile revamp: richer self-service fields + avatar and month-end
-- payment QR. All optional and editable by the employee via /api/me. The two
-- *_url columns hold a served relative path (e.g. /employee-assets/<file>),
-- mirroring how customer-menu images are stored.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_qr_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_info TEXT;      -- banco / alias / titular de cuenta
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id TEXT;        -- carné de identidad (CI)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
