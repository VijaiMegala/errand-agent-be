import { Router } from 'express';
import { createAuthController } from '../controllers/authController.js';

export function createAuthRouter(service) {
  const router = Router();
  const controller = createAuthController(service);
  router.post('/login', controller.login);
  return router;
}
