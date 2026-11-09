import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  ...config.db,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 80000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});
