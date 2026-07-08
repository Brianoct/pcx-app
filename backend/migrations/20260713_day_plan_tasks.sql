-- Team day planner (replaces the old event calendar as the daily tool):
-- in the morning meeting each person lists what they'll do today and in what
-- time frame; everyone sees everyone's workday side by side.

CREATE TABLE IF NOT EXISTS day_plan_tasks (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_date DATE NOT NULL,
  -- Minutes from midnight (e.g. 480 = 08:00). Simple integers keep the math
  -- for block positioning trivial on the client.
  start_minute SMALLINT NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute SMALLINT NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  title TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS idx_day_plan_tasks_date ON day_plan_tasks (task_date);
CREATE INDEX IF NOT EXISTS idx_day_plan_tasks_user_date ON day_plan_tasks (user_id, task_date);
