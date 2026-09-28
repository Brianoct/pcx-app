-- Auditoría de cotizaciones (solo la ve Admin en Historial):
--  created_by_user_id = quién estaba logueado al crearla (puede ser distinto
--  del vendedor asignado en user_id), y quién la tocó por última vez.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_at TIMESTAMPTZ;
