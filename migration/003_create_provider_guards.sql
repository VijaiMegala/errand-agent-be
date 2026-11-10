CREATE FUNCTION prevent_overlapping_provider_slots()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id::text)::bigint);
  IF EXISTS (
    SELECT 1 FROM provider_slots
    WHERE provider_id = NEW.provider_id
      AND id <> NEW.id
      AND starts_at < NEW.ends_at
      AND ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Provider slot overlaps an existing slot' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_slots_no_overlap
  BEFORE INSERT OR UPDATE OF provider_id, starts_at, ends_at ON provider_slots
  FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_provider_slots();

CREATE FUNCTION require_customer_reviewer()
RETURNS trigger AS $$
BEGIN
  IF NEW.reviewer_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.reviewer_user_id AND role = 'customer'
  ) THEN
    RAISE EXCEPTION 'Only customers can write provider reviews' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_reviews_customer_check
  BEFORE INSERT OR UPDATE OF reviewer_user_id ON provider_reviews
  FOR EACH ROW EXECUTE FUNCTION require_customer_reviewer();

CREATE FUNCTION require_matching_slot_service()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM provider_services
    WHERE id = NEW.service_id AND provider_id = NEW.provider_id AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'Slot must belong to an active service of this provider'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_slots_service_guard
  BEFORE INSERT OR UPDATE OF provider_id, service_id ON provider_slots
  FOR EACH ROW EXECUTE FUNCTION require_matching_slot_service();
