-- Tiempos y tarifas por proceso. Cada estación del Kanban tiene una persona
-- encargada y su costo por hora; el costeo suma minutos estándar × tarifa del
-- proceso (si un proceso no tiene tarifa, usa la tarifa general de
-- production_settings.labor_rate_bs_hour).
CREATE TABLE IF NOT EXISTS production_process_rates (
  process TEXT PRIMARY KEY CHECK (process IN (
    'impresion_3d', 'corte_laser', 'punzonado', 'plegado',
    'soldado', 'lavado', 'pintado', 'embalado'
  )),
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rate_bs_hour NUMERIC(10,2) CHECK (rate_bs_hour IS NULL OR rate_bs_hour >= 0),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO production_process_rates (process)
VALUES ('impresion_3d'), ('corte_laser'), ('punzonado'), ('plegado'),
       ('soldado'), ('lavado'), ('pintado'), ('embalado')
ON CONFLICT (process) DO NOTHING;
