import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../models/db.js';

const migrationDir = fileURLToPath(new URL('./', import.meta.url));
const files = (await readdir(migrationDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
const baselineFiles = new Set([
  '001_create_users.sql',
  '002_create_provider_tables.sql',
  '003_create_provider_guards.sql',
  '004_create_bookings.sql',
  '005_create_notifications.sql',
  '006_create_agent_sessions.sql',
  '007_create_mcp_booking_operations.sql',
  '008_create_booking_requests.sql',
  '009_create_reschedule_requests.sql',
]);
// These names identify databases that already ran the original incremental
// migrations. The numbered SQL files now describe a fresh installation.
const legacyFiles = [
  '001_create_users.sql',
  '002_create_provider_tables.sql',
  '004_create_services_and_guards.sql',
  '006_create_bookings.sql',
  '007_update_booking_guard_for_rescheduling.sql',
  '008_create_notifications.sql',
  '009_agent_sessions.sql',
  '010_mcp_live_booking.sql',
  '011_add_agent_session_titles.sql',
  '012_enable_fuzzy_provider_search.sql',
  '013_link_availability_to_services.sql',
  '014_provider_confirms_booking_requests.sql',
  '015_provider_reschedule_approval.sql',
];
const client = await pool.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const appliedFiles = new Set(rows.map((row) => row.filename));
  const legacyCount = legacyFiles.filter((name) => appliedFiles.has(name)).length;
  const hasLegacySequence = appliedFiles.has('004_create_services_and_guards.sql');
  if (hasLegacySequence && legacyCount !== legacyFiles.length) {
    throw new Error('The original migration sequence is incomplete; finish it before using the consolidated creation scripts.');
  }
  for (const filename of files) {
    if (hasLegacySequence && baselineFiles.has(filename)) continue;
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
    if (applied.rowCount) continue;
    const sql = await readFile(new URL(filename, import.meta.url), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
