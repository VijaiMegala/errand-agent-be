import { Router } from 'express';
import { createAuthController } from '../controllers/authController.js';
import { createUserController } from '../controllers/userController.js';
import { requireAuth, requireSelf } from '../middleware/auth.js';

export function createUserRouter(service, authService) {
  const router = Router();
  const controller = createUserController(service);
  const authController = createAuthController(authService);
  const onlySelf = [requireAuth(authService), requireSelf];
  router.post('/', controller.create);
  router.get('/:id', ...onlySelf, controller.get);
  router.patch('/:id', ...onlySelf, controller.update);
  router.patch('/:id/password', ...onlySelf, authController.changePassword);
  router.delete('/:id', ...onlySelf, controller.delete);
  return router;
}
