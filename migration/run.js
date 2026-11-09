import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../models/db.js';

const migrationDir = fileURLToPath(new URL('./', import.meta.url));
const files = (await readdir(migrationDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
const client = await pool.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  for (const filename of files) {
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
