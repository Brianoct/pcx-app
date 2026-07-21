-- Piloto de Inversión en Marketing (no es un presupuesto): cada campaña/live
-- registra su inversión (ítems de costo) y declara el retorno esperado.
-- El retorno real se mide contra las ventas de la ventana vs. la línea base.
CREATE TABLE IF NOT EXISTS campaign_costs (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_costs_campaign ON campaign_costs (campaign_id);

ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS expected_return NUMERIC(12,2);
