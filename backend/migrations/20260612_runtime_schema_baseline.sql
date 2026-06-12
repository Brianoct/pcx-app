-- Baseline of all DDL previously executed at runtime by ensure* functions.
-- Idempotent: safe on databases where the runtime DDL already ran.

-- ── from ensureUsersSchema (backend/lib/schema.js) ───────────────────────
ALTER TABLE users
       ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users
       ADD COLUMN IF NOT EXISTS display_name TEXT;


-- ── from ensureQuotesMarketingSchema (backend/lib/schema.js) ─────────────
ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_code TEXT;

ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS coupon_discount_percent NUMERIC(10,4) DEFAULT 0;

ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_name TEXT;

ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_sku TEXT;

ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS gift_qty INTEGER NOT NULL DEFAULT 1;

ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS payment_method TEXT;

ALTER TABLE quotes
       ADD COLUMN IF NOT EXISTS payment_cash_bs NUMERIC(12,2);


-- ── from ensureQcTables (backend/lib/qc.js) ──────────────────────────
CREATE TABLE IF NOT EXISTS quality_control_settings (
       sku TEXT PRIMARY KEY,
       base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
       commission_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     );

ALTER TABLE quality_control_settings
     ADD COLUMN IF NOT EXISTS base_price NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE quality_control_settings
     ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

ALTER TABLE quality_control_settings
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS quality_control_records (
       id BIGSERIAL PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       sku TEXT NOT NULL,
       product_name TEXT NOT NULL,
       quantity INTEGER NOT NULL CHECK (quantity > 0),
       result TEXT NOT NULL CHECK (result IN ('passed', 'rejected')),
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     );

CREATE INDEX IF NOT EXISTS idx_quality_control_records_created_at
     ON quality_control_records (created_at);

CREATE INDEX IF NOT EXISTS idx_quality_control_records_user_id
     ON quality_control_records (user_id);

CREATE INDEX IF NOT EXISTS idx_quality_control_records_sku
     ON quality_control_records (sku);


-- ── from ensureExpensesTable (backend/lib/expenses.js) ─────────────────────
CREATE TABLE IF NOT EXISTS department_expenses (
       id BIGSERIAL PRIMARY KEY,
       department TEXT NOT NULL,
       category TEXT NOT NULL DEFAULT 'Operativo',
      concept TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
       vendor TEXT,
       amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
       currency TEXT NOT NULL DEFAULT 'BS',
       is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
       recurrence_period TEXT,
       expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
       notes TEXT,
       created_by INTEGER NOT NULL REFERENCES users(id),
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       CONSTRAINT department_expenses_recurrence_chk CHECK (
         (is_recurring = FALSE AND recurrence_period IS NULL)
         OR (is_recurring = TRUE AND recurrence_period IN ('weekly', 'monthly', 'quarterly', 'yearly'))
       )
     );

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'General';

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Operativo';

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS concept TEXT NOT NULL DEFAULT 'Gasto';

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS quantity INTEGER;

UPDATE department_expenses
     SET quantity = 1
     WHERE quantity IS NULL OR quantity <= 0;

ALTER TABLE department_expenses
     ALTER COLUMN quantity TYPE INTEGER
     USING GREATEST(1, ROUND(COALESCE(quantity, 1))::INTEGER);

ALTER TABLE department_expenses
     ALTER COLUMN quantity SET NOT NULL;

ALTER TABLE department_expenses
     ALTER COLUMN quantity SET DEFAULT 1;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS vendor TEXT;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'BS';

ALTER TABLE department_expenses
     ALTER COLUMN currency SET DEFAULT 'BS';

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS recurrence_period TEXT;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS expense_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

ALTER TABLE department_expenses
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_department_expenses_department_date
     ON department_expenses (department, expense_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_department_expenses_recurring
     ON department_expenses (is_recurring, recurrence_period);

CREATE INDEX IF NOT EXISTS idx_department_expenses_concept
     ON department_expenses (LOWER(concept));


-- ── from ensureProjectsTables (backend/lib/projects.js) ────────────────────
CREATE TABLE IF NOT EXISTS projects (
       id BIGSERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       description TEXT,
       area TEXT NOT NULL,
       work_type TEXT NOT NULL DEFAULT 'rutina_mejora',
       version_major INTEGER NOT NULL DEFAULT 1,
       version_minor INTEGER NOT NULL DEFAULT 0,
       version_patch INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       is_active BOOLEAN NOT NULL DEFAULT TRUE
     );

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS area TEXT;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS work_type TEXT NOT NULL DEFAULT 'rutina_mejora';

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_major INTEGER NOT NULL DEFAULT 1;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_minor INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS version_patch INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

ALTER TABLE projects
     ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_projects_area_active
     ON projects (LOWER(area), is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_tasks (
       id BIGSERIAL PRIMARY KEY,
       project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       description TEXT,
       assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       start_date DATE,
       due_date DATE,
       status TEXT NOT NULL DEFAULT 'pendiente',
       progress_percent INTEGER NOT NULL DEFAULT 0,
       task_type TEXT NOT NULL DEFAULT 'rutina',
       version_bump TEXT NOT NULL DEFAULT 'none',
       version_applied BOOLEAN NOT NULL DEFAULT FALSE,
       cost NUMERIC(12,2),
       created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
     );

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS start_date DATE;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendiente';

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'rutina';

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS version_bump TEXT NOT NULL DEFAULT 'none';

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS version_applied BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS cost NUMERIC(12,2);

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

ALTER TABLE project_tasks
     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_project_tasks_project
     ON project_tasks (project_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee
     ON project_tasks (assignee_user_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_project_tasks_dates
     ON project_tasks (start_date, due_date);


-- ── from ensureProductCatalogReady (backend/lib/products.js) ───────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS sf_price NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE products ADD COLUMN IF NOT EXISTS cf_price NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_gift_eligible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS menu_category TEXT;

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- (parameterized statement kept in code: INSERT INTO products (sku, name, sf_price, cf_price, is_active) ...)

-- ── from ensureProductionResourceCatalogReady (backend/lib/productionResources.js) ────
CREATE TABLE IF NOT EXISTS production_equipment_catalog (
          id BIGSERIAL PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          replacement_cost_bs NUMERIC(12,2) NOT NULL DEFAULT 0,
          useful_life_months INTEGER,
          monthly_extra_cost_bs NUMERIC(12,2) NOT NULL DEFAULT 0,
          monthly_capacity_units NUMERIC(12,2),
          usage_unit TEXT,
          notes TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT production_equipment_replacement_cost_chk CHECK (replacement_cost_bs >= 0),
          CONSTRAINT production_equipment_monthly_extra_cost_chk CHECK (monthly_extra_cost_bs >= 0),
          CONSTRAINT production_equipment_useful_life_chk CHECK (useful_life_months IS NULL OR useful_life_months > 0),
          CONSTRAINT production_equipment_monthly_capacity_chk CHECK (monthly_capacity_units IS NULL OR monthly_capacity_units > 0)
        );

CREATE TABLE IF NOT EXISTS production_material_catalog (
          id BIGSERIAL PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          unit_measure TEXT NOT NULL,
          unit_cost_bs NUMERIC(12,2) NOT NULL DEFAULT 0,
          waste_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
          notes TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT production_material_unit_cost_chk CHECK (unit_cost_bs >= 0),
          CONSTRAINT production_material_waste_chk CHECK (waste_pct >= 0 AND waste_pct <= 100)
        );


-- ── from ensureProductProductionMappingReady (backend/lib/productionResources.js) ─────
CREATE TABLE IF NOT EXISTS product_equipment_map (
          sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
          equipment_id BIGINT NOT NULL REFERENCES production_equipment_catalog(id) ON DELETE RESTRICT,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY (sku, equipment_id)
        );

CREATE TABLE IF NOT EXISTS product_material_map (
          sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
          material_id BIGINT NOT NULL REFERENCES production_material_catalog(id) ON DELETE RESTRICT,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY (sku, material_id)
        );

CREATE TABLE IF NOT EXISTS product_process_map (
          sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
          process_key TEXT NOT NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY (sku, process_key),
          CONSTRAINT product_process_map_process_chk CHECK (process_key IN ('laser', 'punzonado'))
        );


-- ── from ensureProductCostingTable (backend/lib/costing.js) ───────────────
CREATE TABLE IF NOT EXISTS product_cost_allocations (
          sku TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
          acero_carbono_09mm NUMERIC(12,2) NOT NULL DEFAULT 0,
          pintura_electrostatica NUMERIC(12,2) NOT NULL DEFAULT 0,
          laser_punzonado NUMERIC(12,2) NOT NULL DEFAULT 0,
          laser_punzonado_mode TEXT NOT NULL DEFAULT 'laser',
          equipo_plegado NUMERIC(12,2) NOT NULL DEFAULT 0,
          equipos_pintura NUMERIC(12,2) NOT NULL DEFAULT 0,
          equipos_soldadura NUMERIC(12,2) NOT NULL DEFAULT 0,
          equipos_corte NUMERIC(12,2) NOT NULL DEFAULT 0,
          carton_corrugado NUMERIC(12,2) NOT NULL DEFAULT 0,
          cinta_embalaje NUMERIC(12,2) NOT NULL DEFAULT 0,
          utilidad NUMERIC(12,2) NOT NULL DEFAULT 0,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT product_cost_allocations_mode_chk
            CHECK (laser_punzonado_mode IN ('laser', 'punzonadora'))
        );

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS acero_carbono_09mm NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS pintura_electrostatica NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS laser_punzonado NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS equipo_plegado NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS equipos_pintura NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS equipos_soldadura NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS equipos_corte NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS carton_corrugado NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS cinta_embalaje NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
           ADD COLUMN IF NOT EXISTS utilidad NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE product_cost_allocations
         ADD COLUMN IF NOT EXISTS laser_punzonado_mode TEXT NOT NULL DEFAULT 'laser';

ALTER TABLE product_cost_allocations
         ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE product_cost_allocations
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW();

ALTER TABLE product_cost_allocations
         DROP CONSTRAINT IF EXISTS product_cost_allocations_mode_chk;

ALTER TABLE product_cost_allocations
         ADD CONSTRAINT product_cost_allocations_mode_chk
         CHECK (laser_punzonado_mode IN ('laser', 'punzonadora'));


-- ── from ensureProductionKanbanTables (backend/lib/kanban.js) ────────────
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

ALTER TABLE production_process_routes
         DROP CONSTRAINT IF EXISTS production_process_routes_start_process_check;

ALTER TABLE production_process_routes
         DROP CONSTRAINT IF EXISTS production_process_routes_start_process_allowed;

ALTER TABLE production_process_routes
         ADD CONSTRAINT production_process_routes_start_process_allowed
         CHECK (start_process IN ('comprar', 'corte_laser', 'punzonado'));

ALTER TABLE production_kanban_cards
         DROP CONSTRAINT IF EXISTS production_kanban_cards_start_process_check;

ALTER TABLE production_kanban_cards
         DROP CONSTRAINT IF EXISTS production_kanban_cards_start_process_allowed;

ALTER TABLE production_kanban_cards
         ADD CONSTRAINT production_kanban_cards_start_process_allowed
         CHECK (start_process IN ('comprar', 'corte_laser', 'punzonado'));

ALTER TABLE production_kanban_cards
         DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_check;

ALTER TABLE production_kanban_cards
         DROP CONSTRAINT IF EXISTS production_kanban_cards_stage_allowed;

ALTER TABLE production_kanban_cards
         ADD CONSTRAINT production_kanban_cards_stage_allowed
         CHECK (stage IN ('comprar', 'corte_laser', 'punzonado', 'plegado', 'lavado', 'pintado', 'embalado'));


-- ── from ensureWhatsAppInboxTables (backend/lib/whatsapp.js) ───────────────
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
          id BIGSERIAL PRIMARY KEY,
          wa_phone TEXT NOT NULL UNIQUE,
          profile_name TEXT,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
          id BIGSERIAL PRIMARY KEY,
          contact_id BIGINT NOT NULL UNIQUE REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open',
          assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          unread_count INTEGER NOT NULL DEFAULT 0,
          last_message_preview TEXT,
          last_message_at TIMESTAMP WITHOUT TIME ZONE,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_conversations_status_chk CHECK (status IN ('open', 'closed'))
        );

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message_at
         ON whatsapp_conversations (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
          wa_message_id TEXT,
          direction TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          text_body TEXT,
          status TEXT,
          from_phone TEXT,
          to_phone TEXT,
          raw_payload JSONB,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_messages_direction_chk CHECK (direction IN ('inbound', 'outbound'))
        );

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_wa_message_id
         ON whatsapp_messages (wa_message_id)
         WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created
         ON whatsapp_messages (conversation_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS whatsapp_assignment_logs (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
          previous_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NOT NULL DEFAULT 'auto_round_robin',
          changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );

CREATE TABLE IF NOT EXISTS whatsapp_round_robin_state (
          singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
          last_assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_round_robin_singleton_chk CHECK (singleton_id = 1)
        );

INSERT INTO whatsapp_round_robin_state (singleton_id, last_assigned_user_id, updated_at)
         VALUES (1, NULL, NOW())
         ON CONFLICT (singleton_id) DO NOTHING;

ALTER TABLE whatsapp_conversations
         ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'new';

ALTER TABLE whatsapp_conversations
         DROP CONSTRAINT IF EXISTS whatsapp_conversations_pipeline_stage_chk;

ALTER TABLE whatsapp_conversations
         ADD CONSTRAINT whatsapp_conversations_pipeline_stage_chk
         CHECK (pipeline_stage IN ('new', 'qualified', 'quoted', 'negotiation', 'won', 'lost'));

CREATE TABLE IF NOT EXISTS whatsapp_followup_tasks (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
          assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          note TEXT,
          due_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          completed_at TIMESTAMP WITHOUT TIME ZONE,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_followup_tasks_status_chk CHECK (status IN ('pending', 'done', 'cancelled'))
        );

CREATE INDEX IF NOT EXISTS idx_whatsapp_followup_tasks_conversation
         ON whatsapp_followup_tasks (conversation_id, status, due_at ASC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_followup_tasks_due_pending
         ON whatsapp_followup_tasks (due_at ASC)
         WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS whatsapp_quick_replies (
          id BIGSERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          reply_type TEXT NOT NULL DEFAULT 'text',
          body_text TEXT,
          template_name TEXT,
          template_language_code TEXT NOT NULL DEFAULT 'es',
          template_components JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT whatsapp_quick_replies_type_chk CHECK (reply_type IN ('text', 'template'))
        );

CREATE INDEX IF NOT EXISTS idx_whatsapp_quick_replies_active
         ON whatsapp_quick_replies (is_active, reply_type, title ASC);

