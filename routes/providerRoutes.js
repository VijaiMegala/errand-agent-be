import { Router } from 'express';
import { createProviderController } from '../controllers/providerController.js';
import { createBookingController } from '../controllers/bookingController.js';
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
    const bookings = createBookingController(bookingService);
    router.post('/:providerId/bookings', authenticate, bookings.create);
    router.get('/:providerId/bookings', authenticate, bookings.listProvider);
    router.patch('/:providerId/bookings/:bookingId/accept', authenticate, bookings.accept);
    router.patch('/:providerId/bookings/:bookingId/reject', authenticate, bookings.reject);
    router.get('/:providerId/reschedule-requests', authenticate, bookings.listRescheduleRequests);
    router.patch('/:providerId/reschedule-requests/:requestId/accept', authenticate, bookings.acceptRescheduleRequest);
    router.patch('/:providerId/reschedule-requests/:requestId/reject', authenticate, bookings.rejectRescheduleRequest);
  }
  router.get('/:providerId/reviews', controller.listReviews);
  router.post('/:providerId/reviews', authenticate, controller.createReview);
  return router;
}
