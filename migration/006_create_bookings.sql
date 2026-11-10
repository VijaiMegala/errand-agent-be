CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES provider_slots(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES provider_services(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status VARCHAR(20) NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'confirmed', 'rejected', 'cancelled', 'expired')),
  hold_expires_at TIMESTAMPTZ,
  CONSTRAINT bookings_hold_expiry_check CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (customer_user_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS bookings_provider_time_idx ON bookings (provider_id, starts_at, ends_at)
  WHERE status IN ('held', 'confirmed');

CREATE OR REPLACE FUNCTION guard_booking()
RETURNS trigger AS $$
DECLARE
  selected_slot provider_slots%ROWTYPE;
  service_duration INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id::text)::bigint);
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.provider_id, NEW.slot_id, NEW.service_id, NEW.customer_user_id,
        NEW.starts_at, NEW.ends_at, NEW.created_at) IS DISTINCT FROM
       (OLD.provider_id, OLD.slot_id, OLD.service_id, OLD.customer_user_id,
        OLD.starts_at, OLD.ends_at, OLD.created_at) THEN
      RAISE EXCEPTION 'Booking details cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'held' OR NEW.status NOT IN ('confirmed', 'rejected', 'cancelled', 'expired') THEN
      RAISE EXCEPTION 'Invalid booking status change' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('confirmed', 'rejected') AND OLD.hold_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Booking hold expired' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'held' THEN
    IF TG_OP = 'UPDATE' OR NEW.hold_expires_at IS NULL OR
       NEW.hold_expires_at <= clock_timestamp() OR
       NEW.hold_expires_at > clock_timestamp() + interval '10 minutes' THEN
      RAISE EXCEPTION 'Invalid booking hold expiry' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.hold_expires_at IS DISTINCT FROM OLD.hold_expires_at THEN
    RAISE EXCEPTION 'Booking hold expiry cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('held', 'confirmed') THEN
    SELECT * INTO selected_slot FROM provider_slots WHERE id = NEW.slot_id AND provider_id = NEW.provider_id;
    IF NOT FOUND OR selected_slot.status <> 'available' OR
       NEW.starts_at < selected_slot.starts_at OR NEW.ends_at > selected_slot.ends_at OR
       NEW.starts_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Booking must fit an available future provider slot' USING ERRCODE = '23514';
    END IF;
    SELECT duration_minutes INTO service_duration FROM provider_services
      WHERE id = NEW.service_id AND provider_id = NEW.provider_id AND active = TRUE;
    IF NOT FOUND OR NEW.ends_at - NEW.starts_at <> make_interval(mins => service_duration) THEN
      RAISE EXCEPTION 'Booking must match an active service duration' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.customer_user_id AND role = 'customer') THEN
      RAISE EXCEPTION 'Only customers can book' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM bookings WHERE provider_id = NEW.provider_id AND id <> NEW.id
        AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > clock_timestamp()))
        AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at
    ) THEN
      RAISE EXCEPTION 'Requested time overlaps an existing booking or hold' USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_guard BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION guard_booking();
