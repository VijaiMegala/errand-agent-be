CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES provider_slots(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES provider_services(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (customer_user_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS bookings_provider_time_idx ON bookings (provider_id, starts_at, ends_at) WHERE status = 'confirmed';

CREATE OR REPLACE FUNCTION guard_booking()
RETURNS trigger AS $$
DECLARE
  selected_slot provider_slots%ROWTYPE;
  service_duration INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id::text)::bigint);
  SELECT * INTO selected_slot FROM provider_slots WHERE id = NEW.slot_id AND provider_id = NEW.provider_id;
  IF NOT FOUND OR selected_slot.status <> 'available' OR
     NEW.starts_at < selected_slot.starts_at OR NEW.ends_at > selected_slot.ends_at OR
     NEW.starts_at <= NOW() THEN
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
  IF NEW.status = 'confirmed' AND EXISTS (
    SELECT 1 FROM bookings WHERE provider_id = NEW.provider_id AND id <> NEW.id
      AND status = 'confirmed' AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Requested time overlaps an existing booking' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_guard BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION guard_booking();
