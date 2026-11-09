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

function validateFields(body, creating) {
  requireObject(body);
  const allowed = creating
    ? new Set(['role', 'fullName', 'email', 'phone', 'password'])
    : new Set(['fullName', 'email', 'phone']);
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
  return result;
}

function validateId(id) {
  if (!uuidPattern.test(id)) throw new HttpError(400, 'id must be a UUID');
}

export function createUserService(repository) {
  return {
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
      const values = validateFields(body, false);
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
