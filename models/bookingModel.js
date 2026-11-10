import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';

const fields = `id, provider_id AS "providerId", slot_id AS "slotId",
  service_id AS "serviceId", customer_user_id AS "customerUserId",
  starts_at AS "startsAt", ends_at AS "endsAt", status,
  hold_expires_at AS "holdExpiresAt", created_at AS "createdAt"`;
const listFields = fields.replace('status,', `CASE WHEN status = 'held' AND hold_expires_at <= clock_timestamp()
  THEN 'expired' ELSE status END AS status,`);
const qualifiedFields = fields.replace(/\b(id|provider_id|slot_id|service_id|customer_user_id|starts_at|ends_at|status|hold_expires_at|created_at)\b/g, 'b.$1');

export function createBookingRepository(pool) {
  return {
    async create(providerId, customerUserId, values) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO bookings (id, provider_id, slot_id, service_id, customer_user_id, starts_at, ends_at, hold_expires_at, quoted_price)
           SELECT $1, $2, $3, $4, $5, $6::timestamptz,
                  $6::timestamptz + make_interval(mins => duration_minutes),
                  clock_timestamp() + interval '10 minutes', price
           FROM provider_services WHERE id = $4 AND provider_id = $2 AND active = TRUE
           RETURNING ${fields}`,
          [randomUUID(), providerId, values.slotId, values.serviceId, customerUserId, values.startsAt],
        );
        if (!rows[0]) throw new HttpError(404, 'Active service not found for provider');
        await client.query('INSERT INTO booking_customer_requests (booking_id) VALUES ($1)', [rows[0].id]);
        await client.query('COMMIT');
        return rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async reschedule(bookingId, customerUserId, values) {
      const { rows } = await pool.query(
        `UPDATE bookings AS b
         SET slot_id = $3, service_id = $4, starts_at = $5::timestamptz,
             ends_at = $5::timestamptz + make_interval(mins => s.duration_minutes),
             status = 'held', hold_expires_at = clock_timestamp() + interval '10 minutes',
             quoted_price = s.price
         FROM provider_services AS s
         WHERE b.id = $1 AND b.customer_user_id = $2 AND b.status = 'rejected'
           AND s.id = $4 AND s.provider_id = b.provider_id AND s.active = TRUE
         RETURNING ${qualifiedFields}`,
        [bookingId, customerUserId, values.slotId, values.serviceId, values.startsAt],
      );
      if (rows[0]) return rows[0];
      const existing = await pool.query(
        'SELECT status FROM bookings WHERE id = $1 AND customer_user_id = $2',
        [bookingId, customerUserId],
      );
      if (!existing.rowCount) throw new HttpError(404, 'Booking not found');
      if (existing.rows[0].status !== 'rejected') throw new HttpError(409, 'Only rejected bookings can be rescheduled');
      throw new HttpError(404, 'Active service not found for provider');
    },
    async listMine(customerUserId) {
      const { rows } = await pool.query(
        `SELECT ${listFields}
         FROM bookings WHERE customer_user_id = $1
           AND EXISTS (SELECT 1 FROM booking_customer_requests WHERE booking_id = bookings.id)
         ORDER BY starts_at DESC LIMIT 100`,
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
        `SELECT ${listFields} FROM bookings WHERE provider_id = $1
           AND EXISTS (SELECT 1 FROM booking_customer_requests WHERE booking_id = bookings.id)
         ORDER BY created_at DESC LIMIT 100`,
        [providerId],
      );
      return rows;
    },
    async listRescheduleRequests(providerId) {
      const { rows } = await pool.query(
        `SELECT request.id, request.booking_id AS "bookingId",
                request.customer_user_id AS "customerUserId",
                request.service_id AS "serviceId",
                request.old_starts_at AS "oldStartsAt",
                request.starts_at AS "startsAt", request.ends_at AS "endsAt",
                request.quoted_price AS "quotedPrice",
                CASE WHEN request.status = 'pending' AND request.expires_at <= clock_timestamp()
                  THEN 'expired' ELSE request.status END AS status,
                request.expires_at AS "expiresAt", request.created_at AS "createdAt"
         FROM booking_reschedule_requests AS request
         WHERE request.provider_id = $1
         ORDER BY request.created_at DESC LIMIT 100`,
        [providerId],
      );
      return rows;
    },
    async decideRescheduleRequest(providerId, requestId, decision) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT request.*, booking.status AS booking_status,
                  booking.slot_id AS current_slot_id,
                  booking.starts_at AS current_starts_at,
                  booking.quoted_price AS current_price
           FROM booking_reschedule_requests AS request
           JOIN bookings AS booking ON booking.id = request.booking_id
           WHERE request.id = $1 AND request.provider_id = $2
           FOR UPDATE OF request, booking`,
          [requestId, providerId],
        );
        const request = rows[0];
        if (!request) throw new HttpError(404, 'Reschedule request not found');
        if (request.status !== 'pending' || new Date(request.expires_at).getTime() <= Date.now()) {
          throw new HttpError(409, 'Reschedule request expired or already decided');
        }
        if (request.booking_status !== 'confirmed' ||
            request.current_slot_id !== request.old_slot_id ||
            new Date(request.current_starts_at).getTime() !== new Date(request.old_starts_at).getTime() ||
            request.current_price !== request.quoted_price) {
          throw new HttpError(409, 'Booking changed since the reschedule request');
        }
        if (decision === 'accepted') {
          const changed = await client.query(
            `UPDATE bookings SET slot_id = $2, service_id = $3,
                    starts_at = $4, ends_at = $5
             WHERE id = $1 AND status = 'confirmed'`,
            [request.booking_id, request.slot_id, request.service_id,
              request.starts_at, request.ends_at],
          );
          if (!changed.rowCount) throw new HttpError(409, 'Booking no longer confirmed');
        }
        const updated = await client.query(
          `UPDATE booking_reschedule_requests
           SET status = $2, decided_at = clock_timestamp()
           WHERE id = $1 RETURNING id, booking_id AS "bookingId", status`,
          [requestId, decision],
        );
        await client.query('COMMIT');
        return updated.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23P01' || error.code === '23514') {
          throw new HttpError(409, 'Requested time is no longer available');
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async decide(providerId, bookingId, decision) {
      const { rows } = await pool.query(
        `UPDATE bookings SET status = $3
         WHERE id = $1 AND provider_id = $2 AND status = 'held'
           AND hold_expires_at > clock_timestamp()
           AND EXISTS (SELECT 1 FROM booking_customer_requests WHERE booking_id = bookings.id)
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
