import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';

const fields = `id, provider_id AS "providerId", slot_id AS "slotId",
  service_id AS "serviceId", customer_user_id AS "customerUserId",
  starts_at AS "startsAt", ends_at AS "endsAt", status,
  hold_expires_at AS "holdExpiresAt", created_at AS "createdAt"`;
const listFields = fields.replace('status,', `CASE WHEN status = 'held' AND hold_expires_at <= clock_timestamp()
  THEN 'expired' ELSE status END AS status,`);

export function createBookingRepository(pool) {
  return {
    async create(providerId, customerUserId, values) {
      const { rows } = await pool.query(
        `INSERT INTO bookings (id, provider_id, slot_id, service_id, customer_user_id, starts_at, ends_at, hold_expires_at)
         SELECT $1, $2, $3, $4, $5, $6::timestamptz,
                $6::timestamptz + make_interval(mins => duration_minutes),
                clock_timestamp() + interval '10 minutes'
         FROM provider_services WHERE id = $4 AND provider_id = $2 AND active = TRUE
         RETURNING ${fields}`,
        [randomUUID(), providerId, values.slotId, values.serviceId, customerUserId, values.startsAt],
      );
      if (!rows[0]) throw new HttpError(404, 'Active service not found for provider');
      return rows[0];
    },
    async listMine(customerUserId) {
      const { rows } = await pool.query(
        `SELECT ${listFields}
         FROM bookings WHERE customer_user_id = $1 ORDER BY starts_at DESC LIMIT 100`,
        [customerUserId],
      );
      return rows;
    },
    async findProviderOwner(providerId) {
      const { rows } = await pool.query('SELECT user_id FROM providers WHERE id = $1', [providerId]);
      return rows[0]?.user_id ?? null;
    },
    async listProvider(providerId) {
      const { rows } = await pool.query(
        `SELECT ${listFields} FROM bookings WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [providerId],
      );
      return rows;
    },
    async decide(providerId, bookingId, decision) {
      const { rows } = await pool.query(
        `UPDATE bookings SET status = $3
         WHERE id = $1 AND provider_id = $2 AND status = 'held'
           AND hold_expires_at > clock_timestamp()
         RETURNING ${fields}`,
        [bookingId, providerId, decision],
      );
      if (rows[0]) return rows[0];
      const existing = await pool.query('SELECT 1 FROM bookings WHERE id = $1 AND provider_id = $2', [bookingId, providerId]);
      if (!existing.rowCount) throw new HttpError(404, 'Booking not found');
      throw new HttpError(409, 'Booking hold has expired or has already been decided');
    },
  };
}
