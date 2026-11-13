// Migration 2: additive columns and backfills. SQL text is unchanged from the inline MIGRATIONS array.
export default {
  version: 2,
  name: "additive_columns_and_backfills",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_detail text NOT NULL DEFAULT '';`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS barangay text NOT NULL DEFAULT '';`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS latitude double precision;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS longitude double precision;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Medium';`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_to text REFERENCES users(id) ON DELETE SET NULL;`,
    `UPDATE reports SET priority='High' WHERE urgent=true AND priority='Medium';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS working_hours text NOT NULL DEFAULT 'Monday-Friday, 8:00 AM-5:00 PM';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS available_days jsonb NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_password_change boolean NOT NULL DEFAULT false;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivation_reason text NOT NULL DEFAULT '';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email text NOT NULL DEFAULT '';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email_verified boolean NOT NULL DEFAULT false;`,
    `ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_requested boolean NOT NULL DEFAULT false;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '';`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS decline_reason text NOT NULL DEFAULT '';`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_event boolean NOT NULL DEFAULT false;`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS latitude double precision;`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS longitude double precision;`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(id) ON DELETE SET NULL;`,
    `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS latitude double precision;`,
    `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS longitude double precision;`,
    `ALTER TABLE report_history ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT '';`,
    `ALTER TABLE report_history ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT '';`,
    `ALTER TABLE report_photos ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '';`,
    `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS series_id text;`,
    `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS recurrence_end date;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS response_deadline timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS responded_at timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_deadline timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;`,
    `UPDATE reports SET resolved_at = (
  SELECT history.at FROM report_history history
    WHERE history.report_id=reports.id AND history.status='Resolved'
      AND history.actor_role <> 'resident'
    ORDER BY history.position DESC LIMIT 1)
WHERE status='Resolved' AND resolved_at IS NULL;`,
    `UPDATE reports SET responded_at = (
  SELECT history.at FROM report_history history
    WHERE history.report_id=reports.id AND history.status <> 'Submitted'
      AND history.position > COALESCE((
        SELECT cycle.position FROM report_history cycle
          WHERE cycle.report_id=reports.id AND cycle.status='Submitted'
          ORDER BY cycle.position DESC LIMIT 1), 0)
    ORDER BY history.position ASC LIMIT 1)
WHERE status <> 'Submitted' AND responded_at IS NULL;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS service_cycle_started_at timestamptz;`,
    `UPDATE reports SET service_cycle_started_at = COALESCE(
  (SELECT history.at FROM report_history history
    WHERE history.report_id=reports.id AND history.status = 'Submitted'
      ORDER BY history.position DESC LIMIT 1),
  submitted_at)
WHERE service_cycle_started_at IS NULL;`,
    `ALTER TABLE reports ALTER COLUMN service_cycle_started_at SET DEFAULT now();`,
    `ALTER TABLE reports ALTER COLUMN service_cycle_started_at SET NOT NULL;`,
    `UPDATE reports SET response_deadline = service_cycle_started_at +
  CASE priority WHEN 'High' THEN interval '1 day' WHEN 'Medium' THEN interval '3 days' ELSE interval '7 days' END
WHERE response_deadline IS NULL;`,
    `UPDATE reports SET resolution_deadline = service_cycle_started_at +
  CASE priority WHEN 'High' THEN interval '7 days' WHEN 'Medium' THEN interval '14 days' ELSE interval '30 days' END
WHERE resolution_deadline IS NULL;`,
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS result_reason text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS affected_id text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS client_ip text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_role_check;`,
    `ALTER TABLE activities ADD CONSTRAINT activities_role_check CHECK (role IN ('resident', 'official', 'administrator', 'system'));`,
    `ALTER TABLE report_photos DROP COLUMN IF EXISTS data_url;`,
    `UPDATE report_history history SET actor_name=reports.name, actor_role='resident'
  FROM reports WHERE history.report_id=reports.id AND history.position=0 AND history.actor_name='';`,
    `INSERT INTO community_locations (id, area, barangay, purok) VALUES
  ('balete-purok-1', 'Purok 1', 'Palsara', 'Purok 1'),
  ('balete-purok-2', 'Purok 2', 'Palsara', 'Purok 2'),
  ('balete-purok-3', 'Purok 3', 'Palsara', 'Purok 3'),
  ('balete-purok-4', 'Purok 4', 'Palsara', 'Purok 4'),
  ('balete-purok-5', 'Purok 5', 'Palsara', 'Purok 5'),
  ('balete-main-road', 'Main Road', 'Palsara', 'Main Road')
ON CONFLICT (id) DO UPDATE SET barangay=excluded.barangay, area=excluded.area, purok=excluded.purok;`,
    `UPDATE community_locations SET barangay='Palsara' WHERE barangay='Balete';`,
  ],
};
