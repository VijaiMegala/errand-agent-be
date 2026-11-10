CREATE TABLE IF NOT EXISTS provider_services (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) >= 2),
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_services_name_unique
  ON provider_services (provider_id, lower(name));

CREATE OR REPLACE FUNCTION prevent_overlapping_provider_slots()
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

DROP TRIGGER IF EXISTS provider_slots_no_overlap ON provider_slots;
CREATE TRIGGER provider_slots_no_overlap
  BEFORE INSERT OR UPDATE OF provider_id, starts_at, ends_at ON provider_slots
  FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_provider_slots();

CREATE OR REPLACE FUNCTION require_customer_reviewer()
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

DROP TRIGGER IF EXISTS provider_reviews_customer_check ON provider_reviews;
CREATE TRIGGER provider_reviews_customer_check
  BEFORE INSERT OR UPDATE OF reviewer_user_id ON provider_reviews
  FOR EACH ROW EXECUTE FUNCTION require_customer_reviewer();
