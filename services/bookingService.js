import { pool } from '../models/db.js';
import { createBookingRepository } from '../models/bookingModel.js';
import { HttpError } from '../utils/httpError.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createBookingService(repository) {
  async function requireProviderOwner(providerId, actor) {
    if (actor.role !== 'service_provider') throw new HttpError(403, 'Only providers can manage booking requests');
    if (!uuid.test(providerId)) throw new HttpError(400, 'providerId must be a UUID');
    const ownerId = await repository.findProviderOwner(providerId);
    if (!ownerId) throw new HttpError(404, 'Provider not found');
    if (ownerId !== actor.id) throw new HttpError(403, 'You can manage only your own bookings');
  }

  return {
    async create(providerId, actor, body) {
      if (actor.role !== 'customer') throw new HttpError(403, 'Only customers can book slots');
      if (!uuid.test(providerId)) throw new HttpError(400, 'providerId must be a UUID');
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some((key) => !['slotId', 'serviceId', 'startsAt'].includes(key)) ||
          !uuid.test(body.slotId) || !uuid.test(body.serviceId) ||
          typeof body.startsAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.startsAt) ||
          !Number.isFinite(Date.parse(body.startsAt))) {
        throw new HttpError(400, 'slotId, serviceId, and startsAt with time zone are required');
      }
      const startsAt = new Date(body.startsAt).toISOString();
      if (Date.parse(startsAt) <= Date.now()) throw new HttpError(400, 'Booking must be in the future');
      return repository.create(providerId, actor.id, { slotId: body.slotId, serviceId: body.serviceId, startsAt });
    },
    async listMine(actor) {
      if (actor.role !== 'customer') throw new HttpError(403, 'Only customers can view their bookings');
      return repository.listMine(actor.id);
    },
    async listProvider(providerId, actor) {
      await requireProviderOwner(providerId, actor);
      return repository.listProvider(providerId);
    },
    async decide(providerId, bookingId, decision, actor) {
      await requireProviderOwner(providerId, actor);
      if (!uuid.test(bookingId)) throw new HttpError(400, 'bookingId must be a UUID');
      if (!['confirmed', 'rejected'].includes(decision)) throw new HttpError(400, 'Invalid booking decision');
      return repository.decide(providerId, bookingId, decision);
    },
  };
}

export const bookingService = createBookingService(createBookingRepository(pool));
