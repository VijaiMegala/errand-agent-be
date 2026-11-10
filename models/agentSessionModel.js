import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

const toSession = (row) => row && ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  summary: row.summary,
  summarizedThroughSeq: Number(row.summarized_through_seq),
  lastSeq: Number(row.last_seq),
  processingStartedAt: row.processing_started_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toApproval = (row) => row && ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  kind: row.kind,
  payload: row.payload,
  status: row.status,
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  createdAt: row.created_at,
});

const toBooking = (row) => row && ({
  bookingId: row.booking_id,
  userId: row.user_id,
  sessionId: row.session_id,
  providerId: row.provider_id,
  service: row.service,
  slot: row.slot,
  startsAt: row.starts_at,
  quote: Number(row.quoted_price),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function normalizeBooking(booking) {
  if (!booking || typeof booking !== 'object' || Array.isArray(booking)) {
    throw new Error('Booking must be an object');
  }
  return {
    bookingId: booking.bookingId ?? booking.booking_id,
    providerId: booking.providerId ?? booking.provider_id,
    service: booking.service,
    slot: booking.slot,
    startsAt: booking.startsAt ?? booking.starts_at,
    quote: booking.quote ?? booking.quotedPrice ?? booking.quoted_price,
    status: booking.status,
  };
}

function parseSlotToken(value) {
  const match = typeof value === 'string' &&
    /^([0-9a-f-]{36})\|([0-9a-f-]{36})\|(\d{10})$/i.exec(value);
  return match ? { slotId: match[1], serviceId: match[2], epoch: Number(match[3]) } : null;
}

export function createAgentSessionRepository(dbPool = pool) {
  return {
    async submitBookingRequest(userId, holdId) {
      const { rows } = await dbPool.query(
        `INSERT INTO booking_customer_requests (booking_id)
         SELECT id FROM bookings
         WHERE id = $1 AND customer_user_id = $2 AND status = 'held'
           AND hold_expires_at > clock_timestamp()
         ON CONFLICT (booking_id) DO NOTHING
         RETURNING booking_id`,
        [holdId, userId],
      );
      if (rows.length) return true;
      const existing = await dbPool.query(
        `SELECT 1 FROM booking_customer_requests AS request
         JOIN bookings AS booking ON booking.id = request.booking_id
         WHERE booking.id = $1 AND booking.customer_user_id = $2
           AND (booking.status = 'confirmed' OR
                (booking.status = 'held' AND booking.hold_expires_at > clock_timestamp()))`,
        [holdId, userId],
      );
      return existing.rowCount > 0;
    },

    async submitRescheduleRequest(userId, approvalId, details) {
      const next = parseSlotToken(details.newSlot);
      const old = parseSlotToken(details.oldSlot);
      if (!next || !old || next.serviceId !== old.serviceId ||
          next.epoch * 1000 !== Date.parse(details.newStartsAt) ||
          old.epoch * 1000 !== Date.parse(details.oldStartsAt)) return null;
      await dbPool.query(
        `UPDATE booking_reschedule_requests
         SET status = 'expired', decided_at = clock_timestamp()
         WHERE booking_id = $1 AND customer_user_id = $2 AND status = 'pending'
           AND expires_at <= clock_timestamp()`,
        [details.bookingId, userId],
      );
      const { rows } = await dbPool.query(
        `INSERT INTO booking_reschedule_requests
           (id, approval_id, booking_id, provider_id, customer_user_id,
            slot_id, service_id, old_slot_id, old_starts_at,
            starts_at, ends_at, quoted_price, expires_at)
         SELECT $1, $2, booking.id, booking.provider_id, booking.customer_user_id,
                slot.id, service.id, booking.slot_id, booking.starts_at,
                $7::timestamptz, $7::timestamptz + make_interval(mins => service.duration_minutes),
                booking.quoted_price, LEAST($7::timestamptz, clock_timestamp() + interval '10 minutes')
         FROM bookings AS booking
         JOIN provider_slots AS slot ON slot.id = $5 AND slot.provider_id = booking.provider_id
           AND slot.status = 'available'
         JOIN provider_services AS service ON service.id = $6 AND service.provider_id = booking.provider_id
           AND service.active = TRUE AND (slot.service_id IS NULL OR slot.service_id = service.id)
         WHERE booking.id = $3 AND booking.customer_user_id = $4 AND booking.provider_id = $10
           AND booking.status = 'confirmed' AND booking.slot_id = $11
           AND booking.starts_at = $8::timestamptz AND booking.quoted_price = $9
           AND booking.service_id = service.id
           AND $7::timestamptz > clock_timestamp()
           AND $7::timestamptz >= slot.starts_at
           AND $7::timestamptz + make_interval(mins => service.duration_minutes) <= slot.ends_at
           AND NOT EXISTS (
             SELECT 1 FROM bookings AS other
             WHERE other.provider_id = booking.provider_id AND other.id <> booking.id
               AND (other.status = 'confirmed' OR
                    (other.status = 'held' AND other.hold_expires_at > clock_timestamp()))
               AND other.starts_at < $7::timestamptz + make_interval(mins => service.duration_minutes)
               AND other.ends_at > $7::timestamptz
           )
         ON CONFLICT DO NOTHING
         RETURNING id, status`,
        [randomUUID(), approvalId, details.bookingId, userId,
          next.slotId, next.serviceId, details.newStartsAt, details.oldStartsAt,
          details.quotedPrice, details.providerId, old.slotId],
      );
      if (rows[0]) return rows[0];
      const existing = await dbPool.query(
        `SELECT id, status FROM booking_reschedule_requests
         WHERE approval_id = $1 AND customer_user_id = $2`,
        [approvalId, userId],
      );
      return existing.rows[0] ?? null;
    },
    async listSessions(userId, limit, offset) {
      const { rows } = await dbPool.query(
        `SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM agent_sessions WHERE user_id = $1
         ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      );
      return rows;
    },

    async listMessages(sessionId, userId, limit, offset) {
      const { rows } = await dbPool.query(
        `SELECT m.seq, m.role, m.content, m.created_at AS "createdAt"
         FROM agent_messages AS m
         JOIN agent_sessions AS s ON s.id = m.session_id
         WHERE s.id = $1 AND s.user_id = $2
         ORDER BY m.seq LIMIT $3 OFFSET $4`,
        [sessionId, userId, limit, offset],
      );
      return rows.map((row) => ({ ...row, seq: Number(row.seq) }));
    },

    async updateTitle(sessionId, userId, title) {
      const { rows } = await dbPool.query(
        `UPDATE agent_sessions SET title = $3, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, title, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [sessionId, userId, title],
      );
      return rows[0] ?? null;
    },

    async deleteSession(sessionId, userId) {
      const { rowCount } = await dbPool.query(
        `DELETE FROM agent_sessions
         WHERE id = $1 AND user_id = $2
           AND (processing_token IS NULL OR processing_started_at < NOW() - INTERVAL '60 seconds')`,
        [sessionId, userId],
      );
      return rowCount > 0;
    },

    async create(userId) {
      const { rows } = await dbPool.query(
        `INSERT INTO agent_sessions (id, user_id)
         VALUES ($1, $2)
         RETURNING *`,
        [randomUUID(), userId],
      );
      return toSession(rows[0]);
    },

    async getOwned(sessionId, userId) {
      const { rows } = await dbPool.query(
        'SELECT * FROM agent_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId],
      );
      return toSession(rows[0]) ?? null;
    },

    async appendMessage(sessionId, role, content) {
      if (!['user', 'assistant'].includes(role)) throw new Error('Invalid chat message role');
      if (typeof content !== 'string' || !content.trim()) throw new Error('Chat message content is required');

      const client = await dbPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE agent_sessions
           SET title = CASE WHEN $2 = 'user' AND last_seq = 0 AND title = 'New chat'
               THEN LEFT(trim($3), 120) ELSE title END,
               last_seq = last_seq + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING last_seq`,
          [sessionId, role, content],
        );
        if (!rows.length) throw new Error('Agent session not found');
        const seq = Number(rows[0].last_seq);
        const inserted = await client.query(
          `INSERT INTO agent_messages (session_id, seq, role, content)
           VALUES ($1, $2, $3, $4)
           RETURNING created_at`,
          [sessionId, seq, role, content],
        );
        await client.query('COMMIT');
        return { seq, role, content, createdAt: inserted.rows[0].created_at };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async loadContext(sessionId) {
      const session = await dbPool.query(
        `SELECT summary, summarized_through_seq
         FROM agent_sessions WHERE id = $1`,
        [sessionId],
      );
      if (!session.rows.length) return null;
      const summarizedThroughSeq = Number(session.rows[0].summarized_through_seq);
      const { rows } = await dbPool.query(
        `SELECT seq, role, content
         FROM agent_messages
         WHERE session_id = $1 AND seq > $2
         ORDER BY seq`,
        [sessionId, summarizedThroughSeq],
      );
      return {
        summary: session.rows[0].summary,
        summarizedThroughSeq,
        messages: rows.map((row) => ({
          seq: Number(row.seq),
          role: row.role,
          content: row.content,
        })),
      };
    },

    async saveSummary(sessionId, summary, throughSeq) {
      if (typeof summary !== 'string' || !summary.trim()) throw new Error('Summary is required');
      if (!Number.isSafeInteger(throughSeq) || throughSeq < 1) throw new Error('Invalid summary cursor');
      const { rows } = await dbPool.query(
        `UPDATE agent_sessions
         SET summary = $2, summarized_through_seq = $3, updated_at = NOW()
         WHERE id = $1 AND summarized_through_seq < $3 AND last_seq >= $3
         RETURNING summarized_through_seq`,
        [sessionId, summary, throughSeq],
      );
      return rows.length > 0;
    },

    // A short lease prevents overlapping chat turns without holding a database
    // connection open while the model streams. Release requires the lease token.
    async claim(sessionId, userId) {
      const leaseToken = randomUUID();
      const { rows } = await dbPool.query(
        `UPDATE agent_sessions
         SET processing_token = $3, processing_started_at = NOW()
         WHERE id = $1 AND user_id = $2
           AND (processing_token IS NULL
             OR processing_started_at < NOW() - INTERVAL '60 seconds')
         RETURNING processing_token`,
        [sessionId, userId, leaseToken],
      );
      return rows[0]?.processing_token ?? null;
    },

    async release(sessionId, leaseToken) {
      const { rowCount } = await dbPool.query(
        `UPDATE agent_sessions
         SET processing_token = NULL, processing_started_at = NULL
         WHERE id = $1 AND processing_token = $2`,
        [sessionId, leaseToken],
      );
      return rowCount > 0;
    },

    async createApproval(sessionId, userId, kind, payload, expiresAt) {
      if (!['book', 'cancel', 'reschedule'].includes(kind)) throw new Error('Invalid approval kind');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Approval payload must be an object');
      }
      const now = Date.now();
      const requestedExpiry = expiresAt ? new Date(expiresAt).getTime() : now + 10 * 60_000;
      if (!Number.isFinite(requestedExpiry) || requestedExpiry <= now) {
        throw new Error('Approval expiry must be in the future');
      }
      const boundedExpiry = new Date(Math.min(requestedExpiry, now + 10 * 60_000));

      const client = await dbPool.connect();
      try {
        await client.query('BEGIN');
        const owned = await client.query(
          `SELECT 1 FROM agent_sessions
           WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [sessionId, userId],
        );
        if (!owned.rowCount) throw new Error('Agent session not found');
        await client.query(
          `UPDATE agent_approvals SET status = 'superseded'
           WHERE session_id = $1 AND status = 'pending'`,
          [sessionId],
        );
        const { rows } = await client.query(
          `INSERT INTO agent_approvals
             (id, session_id, user_id, kind, payload, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [randomUUID(), sessionId, userId, kind, payload, boundedExpiry],
        );
        await client.query('COMMIT');
        return toApproval(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async getApproval(approvalId, sessionId, userId) {
      const { rows } = await dbPool.query(
        `SELECT * FROM agent_approvals
         WHERE id = $1 AND session_id = $2 AND user_id = $3`,
        [approvalId, sessionId, userId],
      );
      return toApproval(rows[0]) ?? null;
    },

    async consumeApproval(approvalId, sessionId, userId) {
      const { rows } = await dbPool.query(
        `UPDATE agent_approvals
         SET status = 'consumed', consumed_at = NOW()
         WHERE id = $1 AND session_id = $2 AND user_id = $3
           AND status = 'pending' AND expires_at > NOW()
         RETURNING *`,
        [approvalId, sessionId, userId],
      );
      return toApproval(rows[0]) ?? null;
    },

    async supersedeApprovals(sessionId, userId) {
      const { rowCount } = await dbPool.query(
        `UPDATE agent_approvals SET status = 'superseded'
         WHERE session_id = $1 AND user_id = $2 AND status = 'pending'`,
        [sessionId, userId],
      );
      return rowCount;
    },

    async upsertBooking(userId, sessionId, booking) {
      const values = normalizeBooking(booking);
      if (!values.bookingId || !values.providerId || !values.service || !values.slot
        || !values.status || values.quote == null) {
        throw new Error('Booking is missing required details');
      }
      const startsAt = new Date(values.startsAt);
      const quote = Number(values.quote);
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(quote) || quote < 0) {
        throw new Error('Booking has invalid date or quote');
      }
      const { rows } = await dbPool.query(
        `INSERT INTO agent_mock_bookings
           (booking_id, user_id, session_id, provider_id, service, slot, starts_at, quoted_price, status)
         SELECT $1, $2, s.id, $4, $5, $6, $7, $8, $9
         FROM agent_sessions AS s
         WHERE s.id = $3 AND s.user_id = $2
         ON CONFLICT (booking_id) DO UPDATE
           SET provider_id = EXCLUDED.provider_id,
               service = EXCLUDED.service,
               slot = EXCLUDED.slot,
               starts_at = EXCLUDED.starts_at,
               quoted_price = EXCLUDED.quoted_price,
               status = EXCLUDED.status,
               updated_at = NOW()
         WHERE agent_mock_bookings.user_id = EXCLUDED.user_id
         RETURNING *`,
        [values.bookingId, userId, sessionId, values.providerId, values.service,
          values.slot, startsAt, quote, values.status],
      );
      if (!rows.length) throw new Error('Booking is not available to this user');
      return toBooking(rows[0]);
    },

    async listBookings(userId) {
      const { rows } = await dbPool.query(
        `SELECT * FROM agent_mock_bookings
         WHERE user_id = $1 ORDER BY starts_at DESC, created_at DESC`,
        [userId],
      );
      return rows.map(toBooking);
    },

    async getBooking(userId, bookingId) {
      const { rows } = await dbPool.query(
        `SELECT * FROM agent_mock_bookings
         WHERE user_id = $1 AND booking_id = $2`,
        [userId, bookingId],
      );
      return toBooking(rows[0]) ?? null;
    },

    async updateBooking(userId, bookingId, booking) {
      const values = normalizeBooking(booking);
      const startsAt = values.startsAt == null ? null : new Date(values.startsAt);
      const quote = values.quote == null ? null : Number(values.quote);
      if ((startsAt && !Number.isFinite(startsAt.getTime()))
        || (quote != null && (!Number.isFinite(quote) || quote < 0))) {
        throw new Error('Booking has invalid date or quote');
      }
      const { rows } = await dbPool.query(
        `UPDATE agent_mock_bookings
         SET slot = COALESCE($3, slot),
             starts_at = COALESCE($4, starts_at),
             quoted_price = COALESCE($5, quoted_price),
             status = COALESCE($6, status),
             updated_at = NOW()
         WHERE user_id = $1 AND booking_id = $2
         RETURNING *`,
        [userId, bookingId, values.slot ?? null, startsAt, quote, values.status ?? null],
      );
      return toBooking(rows[0]) ?? null;
    },
  };
}
