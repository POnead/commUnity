// Migration 6: repair columns and tables missing from older databases whose
// migration history already records the original versions as applied.
export default {
  version: 6,
  name: "legacy_schema_repair",
  statements: [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email_verified boolean NOT NULL DEFAULT false;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS result_reason text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS affected_id text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities ADD COLUMN IF NOT EXISTS client_ip text NOT NULL DEFAULT '';`,
    `ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_role_check;`,
    `ALTER TABLE activities ADD CONSTRAINT activities_role_check CHECK (role IN ('resident', 'official', 'administrator', 'system'));`,
    `CREATE TABLE IF NOT EXISTS activity_archive (
  id text PRIMARY KEY, actor text NOT NULL, role text NOT NULL,
  action text NOT NULL, detail text NOT NULL, at timestamptz NOT NULL, result text NOT NULL,
  result_reason text NOT NULL DEFAULT '', affected_id text NOT NULL DEFAULT '', client_ip text NOT NULL DEFAULT '',
  archived_at timestamptz NOT NULL DEFAULT now()
);`,
    `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS latitude double precision;`,
    `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS longitude double precision;`,
    `ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS response_deadline timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS responded_at timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_deadline timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS service_cycle_started_at timestamptz;`,
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
    `CREATE TABLE IF NOT EXISTS schedule_history (
  id bigserial PRIMARY KEY, schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  position integer NOT NULL, previous_status text, status text NOT NULL,
  at timestamptz NOT NULL, actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '', previous_date date, previous_start text NOT NULL DEFAULT '',
  previous_end text NOT NULL DEFAULT '', replacement_date date,
  replacement_start text NOT NULL DEFAULT '', replacement_end text NOT NULL DEFAULT '',
  UNIQUE (schedule_id, position)
);`,
    `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS series_id text;`,
    `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS recurrence_end date;`,
  ],
};
