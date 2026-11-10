import { Router } from 'express';
import { createProviderController } from '../controllers/providerController.js';
import { requireAuth } from '../middleware/auth.js';

export function createProviderRouter(service, authService, bookingService) {
  const router = Router();
  const controller = createProviderController(service);
  const authenticate = requireAuth(authService);

  router.get('/:providerId/services', controller.listServices);
  router.post('/:providerId/services', authenticate, controller.createService);
  router.get('/:providerId/slots', controller.listSlots);
  router.post('/:providerId/slots', authenticate, controller.createSlot);
  if (bookingService) {
    router.post('/:providerId/bookings', authenticate, async (req, res, next) => {
      try { res.status(201).json({ data: await bookingService.create(req.params.providerId, req.auth, req.body) }); }
      catch (error) { next(error); }
    });
  }
  router.get('/:providerId/reviews', controller.listReviews);
  router.post('/:providerId/reviews', authenticate, controller.createReview);
  return router;
}
