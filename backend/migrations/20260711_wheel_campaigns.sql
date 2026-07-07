-- Named wheel campaigns: marketing can save several ruletas, edit them,
-- delete them and choose which one is live. At most ONE campaign is active
-- (enforced by a partial unique index). "One spin per customer" is scoped to
-- the campaign, so activating a different campaign re-enables customers.

CREATE TABLE IF NOT EXISTS wheel_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slices JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_wheel_campaign_active
  ON wheel_campaigns (is_active) WHERE is_active;

ALTER TABLE wheel_spins
  ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES wheel_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wheel_spins_campaign ON wheel_spins (campaign_id);

-- Carry over the single-config wheel as the first campaign.
INSERT INTO wheel_campaigns (name, slices, is_active)
SELECT 'Campaña inicial', slices, is_active
FROM wheel_config
WHERE id = 1
  AND NOT EXISTS (SELECT 1 FROM wheel_campaigns);
