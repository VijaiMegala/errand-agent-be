import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';
import { pool } from '../models/db.js';
import { notificationChannel } from '../realtime/notificationSocket.js';

export const notificationQueueName = 'booking-notifications';

export async function publishOutboxBatch(database, queue) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM notification_outbox
       WHERE delivered_at IS NULL
         AND (enqueued_at IS NULL OR enqueued_at < NOW() - interval '1 minute')
       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      const jobId = `notification-${row.id}`;
      const existing = await queue.getJob(jobId);
      if (existing && await existing.getState() === 'failed') {
        await existing.retry();
      } else if (!existing) {
        await queue.add('deliver', { outboxId: row.id }, {
          jobId, attempts: 5, backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true, removeOnFail: false,
        });
      }
      await client.query('UPDATE notification_outbox SET enqueued_at = NOW() WHERE id = $1', [row.id]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function deliverNotification(database, outboxId) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO notifications (outbox_id, booking_id, recipient_user_id, event_type)
       SELECT id, booking_id, recipient_user_id, event_type
       FROM notification_outbox WHERE id = $1
       ON CONFLICT (outbox_id) DO NOTHING`,
      [outboxId],
    );
    await client.query('UPDATE notification_outbox SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = $1', [outboxId]);
    const { rows } = await client.query(
      `SELECT id, booking_id AS "bookingId", recipient_user_id AS "recipientUserId",
              event_type AS "eventType", created_at AS "createdAt", read_at AS "readAt"
       FROM notifications WHERE outbox_id = $1`,
      [outboxId],
    );
    await client.query('COMMIT');
    return rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function processNotificationJob(database, publisher, outboxId) {
  const notification = await deliverNotification(database, outboxId);
  if (!notification) return;
  const { recipientUserId, ...data } = notification;
  await publisher.publish(notificationChannel, JSON.stringify({ recipientUserId, notification: data }));
}

async function main() {
  if (!config.redisUrl) throw new Error('REDIS_URL is required for the notification worker');
  const producerConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const workerConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  producerConnection.on('error', (error) => console.error('Notification queue connection error:', error.message));
  workerConnection.on('error', (error) => console.error('Notification worker connection error:', error.message));
  const queue = new Queue(notificationQueueName, { connection: producerConnection });
  const worker = new Worker(notificationQueueName, (job) =>
    processNotificationJob(pool, producerConnection, job.data.outboxId), {
    connection: workerConnection, concurrency: 5,
  });
  worker.on('failed', (job, error) => console.error(`Notification job ${job?.id} failed:`, error));
  worker.on('error', (error) => console.error('Notification worker error:', error));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.close();
    await queue.close();
    await producerConnection.quit();
    await workerConnection.quit();
    await pool.end();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  while (!stopping) {
    try { await publishOutboxBatch(pool, queue); }
    catch (error) { console.error('Notification outbox publish failed:', error); }
    await sleep(2000);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error('Notification worker could not start:', error); process.exitCode = 1; }
}
