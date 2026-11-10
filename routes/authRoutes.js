import { Router } from 'express';
import { createAuthController } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

export function createAuthRouter(service) {
  const router = Router();
  const controller = createAuthController(service);
  router.post('/login', controller.login);
  router.get('/introspect', requireAuth(service), controller.introspect);
  return router;
}
