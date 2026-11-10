import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';

const fields = `id, provider_id AS "providerId", slot_id AS "slotId",
  service_id AS "serviceId", customer_user_id AS "customerUserId",
  starts_at AS "startsAt", ends_at AS "endsAt", status, created_at AS "createdAt"`;

export function createBookingRepository(pool) {
  return {
    async create(providerId, customerUserId, values) {
      const { rows } = await pool.query(
        `INSERT INTO bookings (id, provider_id, slot_id, service_id, customer_user_id, starts_at, ends_at)
         SELECT $1, $2, $3, $4, $5, $6::timestamptz,
                $6::timestamptz + make_interval(mins => duration_minutes)
         FROM provider_services WHERE id = $4 AND provider_id = $2 AND active = TRUE
         RETURNING ${fields}`,
        [randomUUID(), providerId, values.slotId, values.serviceId, customerUserId, values.startsAt],
      );
      if (!rows[0]) throw new HttpError(404, 'Active service not found for provider');
      return rows[0];
    },
    async listMine(customerUserId) {
      const { rows } = await pool.query(
        `SELECT ${fields} FROM bookings WHERE customer_user_id = $1 ORDER BY starts_at DESC LIMIT 100`,
        [customerUserId],
      );
      return rows;
    },
  };
}
