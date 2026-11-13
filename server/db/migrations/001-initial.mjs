// Migration 1: the original schema. SQL text is unchanged from the inline MIGRATIONS array.
export default {
  version: 1,
  name: "initial_schema",
  statements: [
    `CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE,
  name text NOT NULL, area text NOT NULL, phone text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
  status text NOT NULL CHECK (status IN ('Active', 'Inactive')),
  working_hours text NOT NULL DEFAULT 'Monday-Friday, 8:00 AM-5:00 PM',
  available_days jsonb NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb,
  permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_password_change boolean NOT NULL DEFAULT false,
  deactivation_reason text NOT NULL DEFAULT '',
  recovery_email text NOT NULL DEFAULT '',
  reset_requested boolean NOT NULL DEFAULT false,
  joined_at date NOT NULL DEFAULT CURRENT_DATE
);`,
    `CREATE TABLE IF NOT EXISTS user_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL
);`,
    `CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY, user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE,
  name text NOT NULL, category text NOT NULL, title text NOT NULL, area text NOT NULL,
  barangay text NOT NULL DEFAULT '',
  location_detail text NOT NULL DEFAULT '', latitude double precision, longitude double precision,
  description text NOT NULL, urgent boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'Medium',
  assigned_to text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('Submitted', 'Under Review', 'In Progress', 'Resolved')),
  submitted_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);`,
    `CREATE TABLE IF NOT EXISTS report_history (
  id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  position integer NOT NULL, status text NOT NULL, at timestamptz NOT NULL, note text NOT NULL,
  actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
  UNIQUE (report_id, position)
);`,
    `CREATE TABLE IF NOT EXISTS report_photos (
  id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  position integer NOT NULL, name text NOT NULL, photo_url text NOT NULL,
  UNIQUE (report_id, position)
);`,
    `CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY, area text NOT NULL, zone text NOT NULL, date date NOT NULL,
  waste_type text NOT NULL, start_time text NOT NULL, end_time text NOT NULL,
  frequency text NOT NULL, team text NOT NULL,
  series_id text, recurrence_end date,
  status text NOT NULL CHECK (status IN ('Scheduled', 'On the way', 'Collecting', 'Completed', 'Delayed', 'Cancelled', 'Rescheduled'))
);`,
    `CREATE TABLE IF NOT EXISTS schedule_history (
  id bigserial PRIMARY KEY, schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  position integer NOT NULL, previous_status text, status text NOT NULL,
  at timestamptz NOT NULL, actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '', previous_date date, previous_start text NOT NULL DEFAULT '',
  previous_end text NOT NULL DEFAULT '', replacement_date date,
  replacement_start text NOT NULL DEFAULT '', replacement_end text NOT NULL DEFAULT '',
  UNIQUE (schedule_id, position)
);`,
    `CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, target_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  report_id text REFERENCES reports(id) ON DELETE SET NULL, title text NOT NULL,
  body text NOT NULL, created_at timestamptz NOT NULL, read boolean NOT NULL DEFAULT false
);`,
    `CREATE TABLE IF NOT EXISTS activities (
  id text PRIMARY KEY, actor text NOT NULL, role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator', 'system')),
  action text NOT NULL, detail text NOT NULL, at timestamptz NOT NULL, result text NOT NULL,
  result_reason text NOT NULL DEFAULT '', affected_id text NOT NULL DEFAULT '', client_ip text NOT NULL DEFAULT ''
);`,
    `CREATE TABLE IF NOT EXISTS activity_archive (
  id text PRIMARY KEY, actor text NOT NULL, role text NOT NULL,
  action text NOT NULL, detail text NOT NULL, at timestamptz NOT NULL, result text NOT NULL,
  result_reason text NOT NULL DEFAULT '', affected_id text NOT NULL DEFAULT '', client_ip text NOT NULL DEFAULT '',
  archived_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS role_permissions (
  role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
  permission text NOT NULL, enabled boolean NOT NULL, PRIMARY KEY (role, permission)
);`,
    `CREATE TABLE IF NOT EXISTS announcements (
  id bigserial PRIMARY KEY, title text NOT NULL, detail text NOT NULL, date date NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'declined')),
  decline_reason text NOT NULL DEFAULT '',
  is_event boolean NOT NULL DEFAULT false, latitude double precision, longitude double precision,
  created_by text REFERENCES users(id) ON DELETE SET NULL
);`,
    `CREATE TABLE IF NOT EXISTS calendar_events (
  id bigserial PRIMARY KEY, title text NOT NULL, detail text NOT NULL DEFAULT '', date date NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'declined')),
  decline_reason text NOT NULL DEFAULT '',
  latitude double precision, longitude double precision,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS password_reset_requests (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'declined')), handled_by text REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz
);`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS recovery_email_tokens (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL, token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS recovery_email_requests (
  recovery_email text PRIMARY KEY, last_requested_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS report_follow_ups (
  id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS community_locations (
  id text PRIMARY KEY, area text NOT NULL UNIQUE, barangay text NOT NULL,
  street text NOT NULL DEFAULT '', purok text NOT NULL, landmark text NOT NULL DEFAULT ''
);`,
    `CREATE TABLE IF NOT EXISTS recycling_locations (
  id text PRIMARY KEY, name text NOT NULL, barangay text NOT NULL, street text NOT NULL,
  purok text NOT NULL DEFAULT '', landmark text NOT NULL DEFAULT '', materials text NOT NULL,
  phone text NOT NULL DEFAULT '', hours text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
);`,
    `CREATE TABLE IF NOT EXISTS schedule_reminders (
  schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, user_email)
);`,
    `CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS auth_attempts (
  attempt_key text PRIMARY KEY, attempts integer NOT NULL, window_started_at timestamptz NOT NULL
);`,
    `CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id);`,
    `CREATE INDEX IF NOT EXISTS recovery_email_tokens_user_idx ON recovery_email_tokens(user_id);`,
    `CREATE INDEX IF NOT EXISTS report_follow_ups_report_id_idx ON report_follow_ups(report_id);`,
    `CREATE INDEX IF NOT EXISTS reports_owner_submitted_idx ON reports(user_email, submitted_at DESC);`,
    `CREATE INDEX IF NOT EXISTS reports_status_updated_idx ON reports(status, updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS schedules_date_area_idx ON schedules(date, area);`,
    `CREATE INDEX IF NOT EXISTS notifications_owner_created_idx ON notifications(target_email, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON web_sessions(expires_at);`,
    `CREATE INDEX IF NOT EXISTS activities_at_idx ON activities(at DESC);`,
    `CREATE INDEX IF NOT EXISTS activity_archive_at_idx ON activity_archive(at DESC);`,
  ],
};
