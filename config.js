import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

const dbPort = Number(process.env.DB_PORT ?? 5432);
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
  throw new Error('DB_PORT must be a valid TCP port');
}

const dbHost = process.env.DB_HOST;
const localDb = ['localhost', '127.0.0.1', '::1'].includes(dbHost);
const sslSetting = process.env.DB_SSL ?? (localDb ? 'false' : 'true');
if (!['true', 'false'].includes(sslSetting)) {
  throw new Error('DB_SSL must be true or false');
}

export const config = {
  port,
  corsOrigin: process.env.CROSS_ORIGIN || null,
  jwtSecret: process.env.JWT_SECRET,
  db: {
    host: dbHost,
    port: dbPort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: sslSetting === 'true' ? { rejectUnauthorized: true } : false,
  },
};
