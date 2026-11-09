import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './httpError.js';

const scrypt = promisify(scryptCallback);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const keyLength = 64;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 16) {
    throw new HttpError(400, 'password must be 8 to 16 characters');
  }
  return password;
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keyLength, options);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' ||
      Number(parts[1]) !== options.N || Number(parts[2]) !== options.r || Number(parts[3]) !== options.p) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== keyLength) return false;
  const actual = await scrypt(password, salt, keyLength, options);
  return timingSafeEqual(actual, expected);
}

// Keeps unknown-email logins on the same password-verification path.
export const dummyPasswordHash = `scrypt$${options.N}$${options.r}$${options.p}$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(keyLength).toString('base64url')}`;
