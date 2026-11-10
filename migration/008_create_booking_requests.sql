CREATE TABLE booking_customer_requests (
  booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION require_submitted_booking_request()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'held' AND NEW.status IN ('confirmed', 'rejected')
     AND NOT EXISTS (SELECT 1 FROM booking_customer_requests WHERE booking_id = NEW.id) THEN
    RAISE EXCEPTION 'Customer has not submitted this booking request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_request_guard
  BEFORE UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION require_submitted_booking_request();

CREATE FUNCTION notify_submitted_booking_request()
RETURNS trigger AS $$
DECLARE
  recipient UUID;
BEGIN
  SELECT p.user_id INTO recipient
  FROM bookings AS b JOIN providers AS p ON p.id = b.provider_id
  WHERE b.id = NEW.booking_id;
  INSERT INTO notification_outbox (booking_id, recipient_user_id, event_type)
  VALUES (NEW.booking_id, recipient, 'booking_requested');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_customer_requests_notification
  AFTER INSERT ON booking_customer_requests
  FOR EACH ROW EXECUTE FUNCTION notify_submitted_booking_request();
