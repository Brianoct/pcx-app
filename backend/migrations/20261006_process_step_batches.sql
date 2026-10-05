-- Pasos de ruta por TANDA: una impresión 3D saca 6 bandejas de una plancha en
-- 140 min y el operador la atiende 10 min; una plancha de láser saca 12
-- piezas. Hasta ahora std_minutes se leía como minutos por pieza y el costo
-- de una bandeja cargaba la impresión completa.
--   std_minutes      = minutos de máquina por tanda (con pieces_per_run = 1,
--                      sigue siendo minutos por pieza: nada cambia para lo
--                      ya cargado)
--   pieces_per_run   = piezas que salen de cada tanda
--   attended_minutes = minutos de operador por tanda (NULL = toda la tanda)
-- Por pieza: máquina = std/pieces · operador = (attended ?? std)/pieces.
ALTER TABLE product_process_steps
  ADD COLUMN IF NOT EXISTS pieces_per_run INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attended_minutes NUMERIC(8,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_process_steps_pieces_chk') THEN
    ALTER TABLE product_process_steps
      ADD CONSTRAINT product_process_steps_pieces_chk CHECK (pieces_per_run > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_process_steps_attended_chk') THEN
    ALTER TABLE product_process_steps
      ADD CONSTRAINT product_process_steps_attended_chk CHECK (attended_minutes IS NULL OR attended_minutes >= 0);
  END IF;
END $$;
