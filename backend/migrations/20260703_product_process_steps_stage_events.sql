-- Product structure phase 2: explicit per-product manufacturing routes and a
-- stage-transition log.
--
-- product_process_steps replaces the code-side route inference (start process +
-- hard-coded welded SKU set): the kanban route for a SKU is simply its steps in
-- step_order. std_minutes and equipment_id are placeholders for the costing
-- phase (labor + equipment cost per unit) — nullable for now.
--
-- production_stage_events records every card move (who, when, from, to, qty).
-- Durations per stage fall out of consecutive events; this is the data source
-- for "how long did plegado really take" and future throughput/WIP metrics.

CREATE TABLE IF NOT EXISTS product_process_steps (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  process TEXT NOT NULL CHECK (process IN (
    'impresion_3d', 'corte_laser', 'punzonado', 'plegado',
    'soldado', 'lavado', 'pintado', 'embalado'
  )),
  std_minutes NUMERIC(8,2),
  equipment_id BIGINT REFERENCES production_equipment_catalog(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (sku, step_order),
  UNIQUE (sku, process),
  CONSTRAINT product_process_steps_order_chk CHECK (step_order > 0),
  CONSTRAINT product_process_steps_minutes_chk CHECK (std_minutes IS NULL OR std_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_process_steps_sku
  ON product_process_steps (sku, step_order);

-- Seed routes for products that don't have steps yet, replicating the previous
-- code-side inference so behavior is unchanged on migration:
--   * resale products (route 'comprar') get no steps (not produced)
--   * start = configured start_process, else punzonado for tableros (category
--     contains 'tablero' or SKU starts with T), else corte_laser
--   * impresion_3d products: impresion_3d -> embalado (plastic: printed+packed)
--   * metal products: start -> plegado [-> soldado for C15N] -> lavado ->
--     pintado -> embalado
WITH product_start AS (
  SELECT
    p.sku,
    CASE
      WHEN r.start_process IN ('corte_laser', 'impresion_3d', 'punzonado') THEN r.start_process
      WHEN LOWER(COALESCE(p.menu_category, '')) LIKE '%tablero%' OR UPPER(p.sku) LIKE 'T%' THEN 'punzonado'
      ELSE 'corte_laser'
    END AS start_process,
    COALESCE(r.start_process, '') AS configured
  FROM products p
  LEFT JOIN production_process_routes r ON UPPER(r.sku) = UPPER(p.sku)
  WHERE p.is_active = TRUE
    AND NOT EXISTS (SELECT 1 FROM product_process_steps s WHERE s.sku = p.sku)
),
route_steps AS (
  SELECT sku, 1 AS step_order, 'impresion_3d' AS process FROM product_start
    WHERE configured <> 'comprar' AND start_process = 'impresion_3d'
  UNION ALL
  SELECT sku, 2, 'embalado' FROM product_start
    WHERE configured <> 'comprar' AND start_process = 'impresion_3d'
  UNION ALL
  SELECT sku, 1, start_process FROM product_start
    WHERE configured <> 'comprar' AND start_process IN ('corte_laser', 'punzonado')
  UNION ALL
  SELECT sku, 2, 'plegado' FROM product_start
    WHERE configured <> 'comprar' AND start_process IN ('corte_laser', 'punzonado')
  UNION ALL
  SELECT sku, 3, 'soldado' FROM product_start
    WHERE configured <> 'comprar' AND start_process IN ('corte_laser', 'punzonado')
      AND UPPER(sku) = 'C15N'
  UNION ALL
  SELECT sku, 4, 'lavado' FROM product_start
    WHERE configured <> 'comprar' AND start_process IN ('corte_laser', 'punzonado')
  UNION ALL
  SELECT sku, 5, 'pintado' FROM product_start
    WHERE configured <> 'comprar' AND start_process IN ('corte_laser', 'punzonado')
  UNION ALL
  SELECT sku, 6, 'embalado' FROM product_start
    WHERE configured <> 'comprar' AND start_process IN ('corte_laser', 'punzonado')
)
INSERT INTO product_process_steps (sku, step_order, process)
SELECT sku,
       ROW_NUMBER() OVER (PARTITION BY sku ORDER BY step_order),
       process
FROM route_steps
ORDER BY sku, step_order;

CREATE TABLE IF NOT EXISTS production_stage_events (
  id BIGSERIAL PRIMARY KEY,
  card_id INTEGER REFERENCES production_kanban_cards(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  store_location TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  moved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_stage_events_card
  ON production_stage_events (card_id, moved_at);
CREATE INDEX IF NOT EXISTS idx_production_stage_events_sku_stage
  ON production_stage_events (sku, to_stage, moved_at DESC);
