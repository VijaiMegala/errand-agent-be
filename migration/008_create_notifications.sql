CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('booking_requested', 'booking_confirmed', 'booking_rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enqueued_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox (id) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  outbox_id BIGINT NOT NULL UNIQUE REFERENCES notification_outbox(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (recipient_user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION enqueue_booking_notification()
RETURNS trigger AS $$
DECLARE
  recipient UUID;
  event_name VARCHAR(40);
BEGIN
  IF TG_OP = 'INSERT' OR (OLD.status = 'rejected' AND NEW.status = 'held') THEN
    SELECT user_id INTO recipient FROM providers WHERE id = NEW.provider_id;
    event_name := 'booking_requested';
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'held' THEN
    recipient := NEW.customer_user_id;
    event_name := 'booking_confirmed';
  ELSIF NEW.status = 'rejected' AND OLD.status = 'held' THEN
    recipient := NEW.customer_user_id;
    event_name := 'booking_rejected';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO notification_outbox (booking_id, recipient_user_id, event_type)
  VALUES (NEW.id, recipient, event_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_notification_outbox
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION enqueue_booking_notification();
