export default {
  version: 8,
  name: "emergency_hotlines",
  statements: [
    `CREATE TABLE IF NOT EXISTS emergency_hotlines (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  contact_number text NOT NULL,
  alternative_contact_number text NOT NULL DEFAULT '',
  office_address text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  operating_hours text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  published boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS hotline_corrections (
  id bigserial PRIMARY KEY,
  hotline_id bigint REFERENCES emergency_hotlines(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('correction', 'suggestion')),
  submitted_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);`,
  ],
};
