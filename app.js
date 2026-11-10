import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { openApiSpec } from './docs/openapi.js';
import { pool } from './models/db.js';
import { attachNotificationSocket } from './realtime/notificationSocket.js';
import { createAgentRouter } from './routes/agentRoutes.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createBookingRouter } from './routes/bookingRoutes.js';
import { createNotificationRouter } from './routes/notificationRoutes.js';
import { createProviderRouter } from './routes/providerRoutes.js';
import { createUserRouter } from './routes/userRoutes.js';
import { authService as defaultAuthService } from './services/authService.js';
import { agentService as defaultAgentService } from './services/agentService.js';
import { bookingService as defaultBookingService } from './services/bookingService.js';
import { notificationService as defaultNotificationService } from './services/notificationService.js';
import { providerService as defaultProviderService } from './services/providerService.js';
import { userService as defaultUserService } from './services/userService.js';
import { HttpError } from './utils/httpError.js';

export function createApp({
  userService = defaultUserService,
  authService = defaultAuthService,
  providerService = defaultProviderService,
  bookingService = defaultBookingService,
  notificationService = defaultNotificationService,
  agentService = defaultAgentService,
} = {}) {
  const app = express();
  app.disable('x-powered-by');

  if (config.corsOrigin) {
    app.use((req, res, next) => {
      if (req.headers.origin === config.corsOrigin) {
        res.set('Access-Control-Allow-Origin', config.corsOrigin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
  app.use('/api/providers', createProviderRouter(providerService, authService, bookingService));
  app.use('/api/bookings', createBookingRouter(bookingService, authService));
  app.use('/api/notifications', createNotificationRouter(notificationService, authService));
  app.use('/api/agent', createAgentRouter(agentService, authService));

  app.use((req, _res, next) => next(new HttpError(404, 'Route not found')));
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    if (error.code === '23505') {
      const messages = {
        provider_services_name_unique: 'Service already exists for this provider',
        users_email_unique: 'Email is already registered',
        provider_slots_provider_id_starts_at_key: 'Slot overlaps an existing slot',
      };
      return res.status(409).json({ error: messages[error.constraint] ?? 'Resource already exists' });
    }
    if (error.code === '23P01') return res.status(409).json({ error: error.message.includes('booking') ? 'Requested time overlaps an existing booking or hold' : 'Slot overlaps an existing slot' });
    if (error.code === '23514' && error.message.includes('Booking')) return res.status(409).json({ error: error.message });
    if (error.code === '23503') return res.status(409).json({ error: 'Referenced record no longer exists' });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('Request failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function startServer() {
  try {
    if (!config.redisUrl) throw new Error('REDIS_URL is required for notification WebSockets');
    await pool.query('SELECT 1');
    const server = createApp().listen(config.port, () => {
      console.log(`API: http://localhost:${config.port}`);
      console.log(`Swagger: http://localhost:${config.port}/api/docs`);
    });
    const closeNotifications = attachNotificationSocket(server, {
      authService: defaultAuthService, redisUrl: config.redisUrl, corsOrigin: config.corsOrigin,
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, async () => {
        await closeNotifications();
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
