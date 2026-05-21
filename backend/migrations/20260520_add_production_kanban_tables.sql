-- Production Kanban support for low-stock replenishment workflow.
-- Cards are generated from stock deficits and moved through process stages.

CREATE TABLE IF NOT EXISTS production_process_routes (
  sku TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
  start_process TEXT NOT NULL CHECK (start_process IN ('comprar', 'corte_laser', 'punzonado')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_kanban_cards (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  store_location TEXT NOT NULL,
  current_stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  required_qty INTEGER NOT NULL DEFAULT 0,
  start_process TEXT NOT NULL CHECK (start_process IN ('comprar', 'corte_laser', 'punzonado')),
  stage TEXT NOT NULL CHECK (stage IN ('comprar', 'corte_laser', 'punzonado', 'plegado', 'lavado', 'pintado', 'embalado')),
  source TEXT NOT NULL DEFAULT 'min_stock',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_moved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku, store_location, source)
);

CREATE INDEX IF NOT EXISTS idx_production_kanban_cards_active_stage
  ON production_kanban_cards (is_active, stage, updated_at DESC);
