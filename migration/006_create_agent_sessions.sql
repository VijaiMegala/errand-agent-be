CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL DEFAULT 'New chat'
    CONSTRAINT agent_sessions_title_nonblank CHECK (length(trim(title)) > 0),
  summary TEXT NOT NULL DEFAULT '',
  summarized_through_seq BIGINT NOT NULL DEFAULT 0 CHECK (summarized_through_seq >= 0),
  last_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  processing_token UUID,
  processing_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id),
  CHECK (summarized_through_seq <= last_seq),
  CHECK ((processing_token IS NULL) = (processing_started_at IS NULL))
);

CREATE INDEX IF NOT EXISTS agent_sessions_user_updated_idx
  ON agent_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL CHECK (seq > 0),
  role VARCHAR(12) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('book', 'cancel', 'reschedule')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'superseded')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (session_id, user_id)
    REFERENCES agent_sessions(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_approvals_session_pending_idx
  ON agent_approvals (session_id, created_at DESC) WHERE status = 'pending';

-- The assignment mock has one shared user. This table is the backend's
-- ownership boundary for bookings created through that mock.
CREATE TABLE IF NOT EXISTS agent_mock_bookings (
  booking_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL CHECK (length(provider_id) > 0),
  service TEXT NOT NULL CHECK (length(service) > 0),
  slot TEXT NOT NULL CHECK (length(slot) > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  quoted_price NUMERIC(12, 2) NOT NULL CHECK (quoted_price >= 0),
  status VARCHAR(32) NOT NULL CHECK (length(status) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_mock_bookings_user_starts_idx
  ON agent_mock_bookings (user_id, starts_at DESC);
