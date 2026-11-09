CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  role VARCHAR(32) NOT NULL CHECK (role IN ('customer', 'service_provider')),
  full_name VARCHAR(120) NOT NULL CHECK (length(trim(full_name)) >= 2),
  email VARCHAR(254) NOT NULL CHECK (email = lower(email)),
  phone VARCHAR(16),
  password_hash TEXT,
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
