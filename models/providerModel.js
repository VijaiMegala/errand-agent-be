import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';

export function createProviderRepository(pool) {
  return {
    async findOwner(providerId) {
      const { rows } = await pool.query('SELECT user_id FROM providers WHERE id = $1', [providerId]);
      return rows[0]?.user_id ?? null;
    },

    async createService(providerId, values) {
      const { rows } = await pool.query(
        `INSERT INTO provider_services (id, provider_id, name, description, price, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, provider_id AS "providerId", name, description, price,
                   duration_minutes AS "durationMinutes", active,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [randomUUID(), providerId, values.name, values.description, values.price, values.durationMinutes],
      );
      return rows[0];
    },

    async listServices(providerId) {
      const { rows } = await pool.query(
        `SELECT id, provider_id AS "providerId", name, description, price,
                duration_minutes AS "durationMinutes", active,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM provider_services WHERE provider_id = $1 AND active = TRUE
         ORDER BY name LIMIT 100`,
        [providerId],
      );
      return rows;
    },

    async createSlot(providerId, values) {
      const { rows } = await pool.query(
        `INSERT INTO provider_slots (id, provider_id, service_id, starts_at, ends_at)
         SELECT $1, $2, id, $4, $5 FROM provider_services
         WHERE id = $3 AND provider_id = $2 AND active = TRUE
         RETURNING id, provider_id AS "providerId", service_id AS "serviceId", starts_at AS "startsAt",
                   ends_at AS "endsAt", status, created_at AS "createdAt"`,
        [randomUUID(), providerId, values.serviceId, values.startsAt, values.endsAt],
      );
      if (!rows[0]) throw new HttpError(404, 'Active service not found for provider');
      return rows[0];
    },

    async listSlots(providerId) {
      const { rows } = await pool.query(
        `SELECT id, provider_id AS "providerId", service_id AS "serviceId", starts_at AS "startsAt",
                ends_at AS "endsAt", status, created_at AS "createdAt"
         FROM provider_slots WHERE provider_id = $1 AND starts_at >= NOW()
         ORDER BY starts_at LIMIT 100`,
        [providerId],
      );
      return rows;
    },

    async createReview(providerId, reviewerUserId, values) {
      const { rows } = await pool.query(
        `INSERT INTO provider_reviews (id, provider_id, reviewer_user_id, rating, review_text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, provider_id AS "providerId", rating,
                   review_text AS "reviewText", created_at AS "createdAt"`,
        [randomUUID(), providerId, reviewerUserId, values.rating, values.reviewText],
      );
      return rows[0];
    },

    async listReviews(providerId) {
      const { rows } = await pool.query(
        `SELECT id, provider_id AS "providerId", rating,
                review_text AS "reviewText", created_at AS "createdAt"
         FROM provider_reviews WHERE provider_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [providerId],
      );
      return rows;
    },
  };
}
