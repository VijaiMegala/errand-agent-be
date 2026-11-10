import { randomUUID } from 'node:crypto';
import { pool } from '../models/db.js';
import { createUserRepository } from '../models/userModel.js';
import { HttpError } from '../utils/httpError.js';
import { hashPassword, validatePassword } from '../utils/password.js';

const roles = new Set(['customer', 'service_provider']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9]{7,15}$/;

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
}

function validateProviderDetails(value, requireComplete) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'providerDetails must be an object');
  }
  const allowed = new Set(['serviceType', 'serviceArea', 'basePrice', 'attributes']);
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !allowed.has(key))) {
    throw new HttpError(400, 'providerDetails has no valid fields or contains unknown fields');
  }
  if (requireComplete && ['serviceType', 'serviceArea', 'basePrice'].some((key) => !Object.hasOwn(value, key))) {
    throw new HttpError(400, 'providerDetails requires serviceType, serviceArea, and basePrice');
  }
  const result = {};
  for (const [key, max] of [['serviceType', 100], ['serviceArea', 120]]) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'string' || value[key].trim().length < 2 || value[key].trim().length > max) {
      throw new HttpError(400, `${key} must be 2 to ${max} characters`);
    }
    result[key] = value[key].trim();
  }
  if (Object.hasOwn(value, 'basePrice')) {
    if (!Number.isInteger(value.basePrice) || value.basePrice < 0 || value.basePrice > 2147483647) {
      throw new HttpError(400, 'basePrice must be a non-negative whole number');
    }
    result.basePrice = value.basePrice;
  }
  if (Object.hasOwn(value, 'attributes')) {
    if (!value.attributes || typeof value.attributes !== 'object' || Array.isArray(value.attributes)) {
      throw new HttpError(400, 'attributes must be an object');
    }
    result.attributes = value.attributes;
  } else if (requireComplete) {
    result.attributes = {};
  }
  return result;
}

function validateFields(body, creating, existingUser) {
  requireObject(body);
  const allowed = creating
    ? new Set(['role', 'fullName', 'email', 'phone', 'password', 'providerDetails'])
    : new Set(['fullName', 'email', 'phone', 'providerDetails']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new HttpError(400, `Unknown or immutable field: ${key}`);
  }
  if (!creating && Object.keys(body).length === 0) {
    throw new HttpError(400, 'Provide at least one field to update');
  }

  const result = {};
  if (creating) {
    if (typeof body.role !== 'string' || !roles.has(body.role)) {
      throw new HttpError(400, 'role must be customer or service_provider');
    }
    result.role = body.role;
  }
  if (creating || Object.hasOwn(body, 'fullName')) {
    if (typeof body.fullName !== 'string' || body.fullName.trim().length < 2 || body.fullName.trim().length > 120) {
      throw new HttpError(400, 'fullName must be 2 to 120 characters');
    }
    result.fullName = body.fullName.trim();
  }
  if (creating || Object.hasOwn(body, 'email')) {
    if (typeof body.email !== 'string' || body.email.length > 254 || !emailPattern.test(body.email.trim())) {
      throw new HttpError(400, 'email must be a valid email address');
    }
    result.email = body.email.trim().toLowerCase();
  }
  if (creating || Object.hasOwn(body, 'phone')) {
    if (body.phone == null) result.phone = null;
    else if (typeof body.phone === 'string' && phonePattern.test(body.phone)) result.phone = body.phone;
    else throw new HttpError(400, 'phone must contain 7 to 15 digits, optionally starting with +');
  }
  if (creating) result.password = validatePassword(body.password);
  if (creating) {
    if (body.role === 'service_provider') {
      if (Object.hasOwn(body, 'providerDetails')) {
        result.providerDetails = validateProviderDetails(body.providerDetails, true);
      }
    } else if (Object.hasOwn(body, 'providerDetails')) {
      throw new HttpError(400, 'Only service providers can have providerDetails');
    }
  } else if (Object.hasOwn(body, 'providerDetails')) {
    if (existingUser.role !== 'service_provider') {
      throw new HttpError(400, 'Only service providers can have providerDetails');
    }
    result.providerDetails = validateProviderDetails(body.providerDetails, !existingUser.providerDetails);
  }
  return result;
}

function validateId(id) {
  if (!uuidPattern.test(id)) throw new HttpError(400, 'id must be a UUID');
}

export function createUserService(repository) {
  return {
    async list(query = {}) {
      const role = query.role;
      if (role !== undefined && !['customer', 'service_provider', 'admin'].includes(role)) {
        throw new HttpError(400, 'role must be customer, service_provider, or admin');
      }
      const parsePageNumber = (value, fallback, max, name) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) > max || Number(value) < 0) {
          throw new HttpError(400, `${name} must be a non-negative integer no greater than ${max}`);
        }
        return Number(value);
      };
      const limit = parsePageNumber(query.limit, 20, 100, 'limit');
      if (limit < 1) throw new HttpError(400, 'limit must be at least 1');
      const offset = parsePageNumber(query.offset, 0, 100000, 'offset');
      return repository.list({ role, limit, offset });
    },
    async create(body) {
      const { password, ...values } = validateFields(body, true);
      const passwordHash = await hashPassword(password);
      return repository.create({ id: randomUUID(), ...values, passwordHash });
    },
    async get(id) {
      validateId(id);
      const user = await repository.findById(id);
      if (!user) throw new HttpError(404, 'User not found');
      return user;
    },
    async update(id, body) {
      validateId(id);
      const existing = await repository.findById(id);
      if (!existing) throw new HttpError(404, 'User not found');
      const values = validateFields(body, false, existing);
      const user = await repository.update(id, values);
      if (!user) throw new HttpError(404, 'User not found');
      return user;
    },
    async delete(id) {
      validateId(id);
      if (!await repository.delete(id)) throw new HttpError(404, 'User not found');
    },
  };
}

export const userService = createUserService(createUserRepository(pool));
