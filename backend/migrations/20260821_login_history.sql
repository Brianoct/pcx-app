-- Auditoría de accesos: cada intento de login (exitoso o fallido) queda
-- registrado con IP, dispositivo y un identificador estable por navegador
-- (device_id, generado por el frontend). Permite detectar cuentas compartidas.
CREATE TABLE IF NOT EXISTS login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  success BOOLEAN NOT NULL,
  ip VARCHAR(64),
  device_id VARCHAR(64),
  device_label VARCHAR(160),
  user_agent TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_created ON login_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_device ON login_history (device_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history (created_at DESC);
