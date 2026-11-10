export function createNotificationRepository(pool) {
  return {
    async list(recipientUserId) {
      const { rows } = await pool.query(
        `SELECT id, booking_id AS "bookingId", event_type AS "eventType",
                created_at AS "createdAt", read_at AS "readAt"
         FROM notifications WHERE recipient_user_id = $1
         ORDER BY created_at DESC, id DESC LIMIT 100`,
        [recipientUserId],
      );
      return rows;
    },
    async markRead(id, recipientUserId) {
      const { rows } = await pool.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND recipient_user_id = $2
         RETURNING id, booking_id AS "bookingId", event_type AS "eventType",
                   created_at AS "createdAt", read_at AS "readAt"`,
        [id, recipientUserId],
      );
      return rows[0] ?? null;
    },
  };
}
