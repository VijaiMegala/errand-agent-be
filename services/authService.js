import { pool } from '../models/db.js';
import { createUserRepository } from '../models/userModel.js';
import { issueAccessToken, verifyAccessToken } from '../utils/accessToken.js';
import { HttpError } from '../utils/httpError.js';
import { dummyPasswordHash, hashPassword, validatePassword, verifyPassword } from '../utils/password.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthService(repository) {
  return {
    async login(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some((key) => !['email', 'password'].includes(key)) ||
          typeof body.email !== 'string' || !emailPattern.test(body.email.trim()) ||
          typeof body.password !== 'string') {
        throw new HttpError(400, 'email and password are required');
      }
      const account = await repository.findAuthByEmail(body.email.trim().toLowerCase());
      const matches = await verifyPassword(body.password, account?.passwordHash ?? dummyPasswordHash);
      if (!account?.passwordHash || !matches) throw new HttpError(401, 'Invalid email or password');
      return issueAccessToken(account);
    },

    async authenticate(token) {
      let claims;
      try { claims = await verifyAccessToken(token); }
      catch { throw new HttpError(401, 'Invalid or expired access token'); }
      if (typeof claims.sub !== 'string' || !Number.isInteger(claims.ver)) {
        throw new HttpError(401, 'Invalid or expired access token');
      }
      const account = await repository.findAuthById(claims.sub);
      if (!account?.passwordHash || account.authVersion !== claims.ver || account.role !== claims.role) {
        throw new HttpError(401, 'Invalid or expired access token');
      }
      return { id: account.id, role: account.role };
    },

    async changePassword(id, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some((key) => !['currentPassword', 'newPassword'].includes(key)) ||
          typeof body.currentPassword !== 'string') {
        throw new HttpError(400, 'currentPassword and newPassword are required');
      }
      validatePassword(body.newPassword);
      const account = await repository.findAuthById(id);
      if (!account?.passwordHash || !await verifyPassword(body.currentPassword, account.passwordHash)) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      if (body.currentPassword === body.newPassword) {
        throw new HttpError(400, 'New password must differ from current password');
      }
      const passwordHash = await hashPassword(body.newPassword);
      const updated = await repository.updatePassword(id, account.authVersion, passwordHash);
      if (!updated) throw new HttpError(409, 'Password changed concurrently; try again');
      return issueAccessToken(updated);
    },
  };
}

export const authService = createAuthService(createUserRepository(pool));
