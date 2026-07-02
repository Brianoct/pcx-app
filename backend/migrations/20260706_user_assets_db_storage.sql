-- Store employee avatars / payment QRs in the database instead of on disk.
--
-- The previous implementation wrote files under backend/lib/employee-assets;
-- Render's filesystem is ephemeral, so every deploy wiped the uploads while
-- users.avatar_url / payment_qr_url kept pointing at them (broken images).
--
-- user_assets holds the image bytes (uploads are client-downscaled to tens of
-- KB). access_token makes the serving URL an unguessable capability link that
-- works in plain <img> tags and changes on every re-upload (cache busting).

CREATE TABLE IF NOT EXISTS user_assets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'qr')),
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  access_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind)
);

-- The disk files are gone; clear the dangling references so the UI shows the
-- clean "sin imagen" state instead of broken icons. Users re-upload once.
UPDATE users SET avatar_url = NULL WHERE avatar_url LIKE '/employee-assets/%';
UPDATE users SET payment_qr_url = NULL WHERE payment_qr_url LIKE '/employee-assets/%';
