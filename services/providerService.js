import { pool } from '../models/db.js';
import { createProviderRepository } from '../models/providerModel.js';
import { HttpError } from '../utils/httpError.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !fields.includes(key))) {
    throw new HttpError(400, 'Invalid request body');
  }
}

function validateProviderId(id) {
  if (!uuidPattern.test(id)) throw new HttpError(400, 'providerId must be a UUID');
}

function validateService(body) {
  requireBody(body, ['name', 'description', 'price', 'durationMinutes']);
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 120) {
    throw new HttpError(400, 'name must be 2 to 120 characters');
  }
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)) {
    throw new HttpError(400, 'description must be at most 2000 characters');
  }
  if (!Number.isInteger(body.price) || body.price < 0 || body.price > 2147483647) {
    throw new HttpError(400, 'price must be a non-negative whole number');
  }
  if (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 15 || body.durationMinutes > 1440) {
    throw new HttpError(400, 'durationMinutes must be between 15 and 1440');
  }
  return {
    name: body.name.trim(), description: body.description?.trim() ?? '',
    price: body.price, durationMinutes: body.durationMinutes,
  };
}

function validateSlot(body) {
  requireBody(body, ['startsAt', 'endsAt']);
  const parseTime = (value) => {
    const match = typeof value === 'string' &&
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw new HttpError(400, 'startsAt and endsAt must be ISO timestamps with time zones');
    const [, year, month, day, hour, minute, second, zone] = match;
    const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    const validCalendar = calendarDate.getUTCFullYear() === Number(year) &&
      calendarDate.getUTCMonth() + 1 === Number(month) && calendarDate.getUTCDate() === Number(day);
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4));
    const validZone = zone === 'Z' || (zoneHour < 14 && zoneMinute < 60) ||
      (zoneHour === 14 && zoneMinute === 0);
    const parsed = new Date(value);
    if (!validCalendar || !validZone || Number(hour) > 23 || Number(minute) > 59 ||
        Number(second ?? 0) > 59 || !Number.isFinite(parsed.getTime())) {
      throw new HttpError(400, 'startsAt and endsAt must be valid ISO timestamps');
    }
    return parsed;
  };
  const start = parseTime(body.startsAt);
  const end = parseTime(body.endsAt);
  if (start.getTime() <= Date.now() || end.getTime() <= start.getTime() ||
      end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
    throw new HttpError(400, 'Slot must be in the future and last no more than 24 hours');
  }
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

function validateReview(body) {
  requireBody(body, ['rating', 'reviewText']);
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    throw new HttpError(400, 'rating must be an integer from 1 to 5');
  }
  if (typeof body.reviewText !== 'string' || !body.reviewText.trim() || body.reviewText.length > 2000) {
    throw new HttpError(400, 'reviewText must be 1 to 2000 characters');
  }
  return { rating: body.rating, reviewText: body.reviewText.trim() };
}

export function createProviderService(repository) {
  async function ownerOf(providerId) {
    validateProviderId(providerId);
    const ownerId = await repository.findOwner(providerId);
    if (!ownerId) throw new HttpError(404, 'Provider not found');
    return ownerId;
  }

  async function requireOwner(providerId, actor) {
    if (actor.role !== 'service_provider') throw new HttpError(403, 'Only service providers can manage services and slots');
    const ownerId = await ownerOf(providerId);
    if (ownerId !== actor.id) throw new HttpError(403, 'You can manage only your own provider listing');
  }

  return {
    async createService(providerId, actor, body) {
      const values = validateService(body);
      await requireOwner(providerId, actor);
      return repository.createService(providerId, values);
    },
    async listServices(providerId) {
      await ownerOf(providerId);
      return repository.listServices(providerId);
    },
    async createSlot(providerId, actor, body) {
      const values = validateSlot(body);
      await requireOwner(providerId, actor);
      return repository.createSlot(providerId, values);
    },
    async listSlots(providerId) {
      await ownerOf(providerId);
      return repository.listSlots(providerId);
    },
    async createReview(providerId, actor, body) {
      if (actor.role !== 'customer') throw new HttpError(403, 'Only customers can add reviews');
      const values = validateReview(body);
      await ownerOf(providerId);
      return repository.createReview(providerId, actor.id, values);
    },
    async listReviews(providerId) {
      await ownerOf(providerId);
      return repository.listReviews(providerId);
    },
  };
}

export const providerService = createProviderService(createProviderRepository(pool));
