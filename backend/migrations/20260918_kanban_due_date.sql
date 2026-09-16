-- Kanban: cada lote lleva fecha de inicio (planned_date, ya existía) y fecha
-- de entrega (due_date). El tablero colorea la tarjeta según lo que falta
-- para la entrega: blanco = a tiempo, amarillo = 2 días, naranja = 1 día o
-- vence hoy, rojo = atrasado.
ALTER TABLE production_kanban_cards
  ADD COLUMN IF NOT EXISTS due_date DATE;
