import { Router } from 'express';
import { createNotificationController } from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

export function createNotificationRouter(service, authService) {
  const router = Router();
  const controller = createNotificationController(service);
  const authenticate = requireAuth(authService);
  router.get('/', authenticate, controller.list);
  router.patch('/:notificationId/read', authenticate, controller.markRead);
  return router;
}
