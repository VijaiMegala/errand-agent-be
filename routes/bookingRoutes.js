import { Router } from 'express';
import { createBookingController } from '../controllers/bookingController.js';
import { requireAuth } from '../middleware/auth.js';

export function createBookingRouter(service, authService) {
  const router = Router();
  const controller = createBookingController(service);
  router.get('/', requireAuth(authService), controller.listMine);
  return router;
}
