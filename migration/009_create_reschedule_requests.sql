CREATE TABLE booking_reschedule_requests (
  id UUID PRIMARY KEY,
  approval_id UUID NOT NULL UNIQUE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES provider_slots(id),
  service_id UUID NOT NULL REFERENCES provider_services(id),
  old_slot_id UUID NOT NULL REFERENCES provider_slots(id),
  old_starts_at TIMESTAMPTZ NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  quoted_price INTEGER NOT NULL CHECK (quoted_price >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  decided_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX booking_reschedule_one_pending_idx
  ON booking_reschedule_requests (booking_id) WHERE status = 'pending';
CREATE INDEX booking_reschedule_provider_idx
  ON booking_reschedule_requests (provider_id, created_at DESC);

CREATE FUNCTION require_provider_reschedule_request()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status = 'confirmed'
     AND (NEW.slot_id, NEW.service_id, NEW.starts_at, NEW.ends_at)
       IS DISTINCT FROM (OLD.slot_id, OLD.service_id, OLD.starts_at, OLD.ends_at)
     AND NOT EXISTS (
       SELECT 1 FROM booking_reschedule_requests AS request
       WHERE request.booking_id = NEW.id AND request.status = 'pending'
         AND request.slot_id = NEW.slot_id AND request.service_id = NEW.service_id
         AND request.starts_at = NEW.starts_at AND request.ends_at = NEW.ends_at
         AND request.expires_at > clock_timestamp()
     ) THEN
    RAISE EXCEPTION 'Provider must accept the reschedule request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_provider_reschedule_guard
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION require_provider_reschedule_request();

CREATE FUNCTION notify_reschedule_request()
RETURNS trigger AS $$
DECLARE
  recipient UUID;
  event_name VARCHAR(40);
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT user_id INTO recipient FROM providers WHERE id = NEW.provider_id;
    event_name := 'reschedule_requested';
  ELSIF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    recipient := NEW.customer_user_id;
    event_name := 'reschedule_confirmed';
  ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    recipient := NEW.customer_user_id;
    event_name := 'reschedule_rejected';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO notification_outbox (booking_id, recipient_user_id, event_type)
  VALUES (NEW.booking_id, recipient, event_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_reschedule_request_notifications
  AFTER INSERT OR UPDATE OF status ON booking_reschedule_requests
  FOR EACH ROW EXECUTE FUNCTION notify_reschedule_request();
