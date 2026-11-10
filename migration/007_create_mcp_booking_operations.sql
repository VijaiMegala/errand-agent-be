CREATE TABLE IF NOT EXISTS mcp_booking_operations (
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('book', 'cancel', 'reschedule')),
  idempotency_key VARCHAR(256) NOT NULL,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  requested_slot TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  outcome VARCHAR(32) NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS mcp_booking_operations_booking_idx
  ON mcp_booking_operations (booking_id, created_at DESC);
