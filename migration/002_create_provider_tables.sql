CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  service_type VARCHAR(100) NOT NULL CHECK (length(trim(service_type)) >= 2),
  service_area VARCHAR(120) NOT NULL CHECK (length(trim(service_area)) >= 2),
  base_price INTEGER NOT NULL CHECK (base_price >= 0),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS providers_service_area_idx
  ON providers (lower(service_type), lower(service_area));

CREATE OR REPLACE FUNCTION require_service_provider_user()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'service_provider') THEN
    RAISE EXCEPTION 'Provider user must have service_provider role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS providers_user_role_check ON providers;

CREATE TRIGGER providers_user_role_check
  BEFORE INSERT OR UPDATE OF user_id ON providers
  FOR EACH ROW EXECUTE FUNCTION require_service_provider_user();

CREATE TABLE IF NOT EXISTS provider_slots (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'held', 'booked', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, starts_at)
);

CREATE INDEX IF NOT EXISTS provider_slots_lookup_idx
  ON provider_slots (provider_id, starts_at, status);

CREATE TABLE IF NOT EXISTS provider_reviews (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  reviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL CHECK (length(trim(review_text)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS provider_reviews_provider_idx
  ON provider_reviews (provider_id, created_at DESC);
