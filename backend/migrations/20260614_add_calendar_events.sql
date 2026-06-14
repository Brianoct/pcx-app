-- Centralized team calendar. Replaces the old "Calendario de permisos" page:
-- a single place where every user records vacation, partial days, sick days,
-- project tasks, marketing promotions and any activity needing coordination.
--
-- Time-off type events (vacation/partial_day/sick) keep an approval workflow and
-- feed the annual quota summary; every other type defaults to "confirmed".
CREATE TABLE IF NOT EXISTS calendar_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'vacation', 'partial_day', 'sick', 'project_task', 'marketing',
    'meeting', 'deadline', 'training', 'travel', 'holiday', 'coordination', 'other'
  )),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME WITHOUT TIME ZONE,
  end_time TIME WITHOUT TIME ZONE,
  total_days INTEGER,
  visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('personal', 'team')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'pending', 'approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_event_type ON calendar_events(event_type);
CREATE INDEX IF NOT EXISTS idx_calendar_events_visibility ON calendar_events(visibility);

-- Carry forward existing time-off requests so no history is lost. Only runs when
-- the calendar is still empty (the migration itself is applied at most once, but
-- this guard keeps it safe if re-run manually).
INSERT INTO calendar_events (
  user_id, created_by, title, event_type, start_date, end_date,
  all_day, total_days, visibility, status, notes, created_at, updated_at
)
SELECT
  t.user_id,
  t.user_id,
  CASE t.leave_type
    WHEN 'vacation' THEN 'Vacaciones'
    WHEN 'sick_leave' THEN 'Día de enfermedad'
    WHEN 'early_leave' THEN 'Día parcial / Salida'
    ELSE 'Permiso'
  END,
  CASE t.leave_type
    WHEN 'vacation' THEN 'vacation'
    WHEN 'sick_leave' THEN 'sick'
    WHEN 'early_leave' THEN 'partial_day'
    ELSE 'coordination'
  END,
  t.start_date,
  t.end_date,
  TRUE,
  t.total_days,
  'team',
  t.status,
  t.notes,
  t.created_at,
  t.updated_at
FROM time_off_requests t
WHERE NOT EXISTS (SELECT 1 FROM calendar_events);
