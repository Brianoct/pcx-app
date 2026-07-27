-- El equipo cobra por comisión sobre ventas, no por hora: 5 roles × 3% del
-- ingreso total (liderazgo) + 8–10% del vendedor sobre sus propias ventas.
-- Estos dos porcentajes reemplazan a la mano de obra por minutos en el
-- costeo de Rentabilidad (el tarifario por hora queda para referencia).
ALTER TABLE production_settings ADD COLUMN IF NOT EXISTS commission_leader_pct NUMERIC(5,2) NOT NULL DEFAULT 15;
ALTER TABLE production_settings ADD COLUMN IF NOT EXISTS commission_seller_pct NUMERIC(5,2) NOT NULL DEFAULT 10;
