-- Vuelta a lotes completos en el kanban: el empuje pieza a pieza multiplicaba
-- tarjetas y confundía. La posición oficial del lote vuelve a ser la columna
-- stage de la tarjeta (que bajo el flujo pieza a pieza guardaba el borde
-- trasero: la etapa más temprana con piezas — la posición conservadora, nada
-- se salta una estación ni el control de calidad).
-- Se recoge la distribución pieza-a-etapa: attachStageDistributions vuelve a
-- sembrar {etapa: cantidad completa} para cada tarjeta activa.
DELETE FROM production_kanban_stage_qty;
