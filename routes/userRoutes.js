import { Router } from 'express';
import { createAuthController } from '../controllers/authController.js';
import { createUserController } from '../controllers/userController.js';
import { requireAdmin, requireAuth, requireSelf, requireSelfOrAdmin } from '../middleware/auth.js';

export function createUserRouter(service, authService) {
  const router = Router();
  const controller = createUserController(service);
  const authController = createAuthController(authService);
  const authenticated = requireAuth(authService);
  const selfOrAdmin = [authenticated, requireSelfOrAdmin];
  router.post('/', controller.create);
  router.get('/', authenticated, requireAdmin, controller.list);
  router.get('/:id', ...selfOrAdmin, controller.get);
  router.patch('/:id', ...selfOrAdmin, controller.update);
  router.patch('/:id/password', authenticated, requireSelf, authController.changePassword);
  router.delete('/:id', ...selfOrAdmin, controller.delete);
  return router;
}
