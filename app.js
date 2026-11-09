import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { openApiSpec } from './docs/openapi.js';
import { pool } from './models/db.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createUserRouter } from './routes/userRoutes.js';
import { authService as defaultAuthService } from './services/authService.js';
import { userService as defaultUserService } from './services/userService.js';
import { HttpError } from './utils/httpError.js';

export function createApp({ userService = defaultUserService, authService = defaultAuthService } = {}) {
  const app = express();
  app.disable('x-powered-by');

  if (config.corsOrigin) {
    app.use((req, res, next) => {
      if (req.headers.origin === config.corsOrigin) {
        res.set('Access-Control-Allow-Origin', config.corsOrigin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') return res.status(204).end();
      }
      next();
    });
  }

  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.use('/api/auth', createAuthRouter(authService));
  app.use('/api/users', createUserRouter(userService, authService));

  app.use((req, _res, next) => next(new HttpError(404, 'Route not found')));
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    if (error.code === '23505') return res.status(409).json({ error: 'Email is already registered' });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('Request failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function startServer() {
  try {
    await pool.query('SELECT 1');
    const server = createApp().listen(config.port, () => {
      console.log(`API: http://localhost:${config.port}`);
      console.log(`Swagger: http://localhost:${config.port}/api/docs`);
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        server.close(() => pool.end().finally(() => process.exit(0)));
      });
    }
  } catch (error) {
    console.error('Could not connect to PostgreSQL:', error.message);
    await pool.end();
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
}
