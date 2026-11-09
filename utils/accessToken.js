import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const encodedSecret = config.jwtSecret;
if (!encodedSecret || !/^[A-Za-z0-9_-]+$/.test(encodedSecret)) {
  throw new Error('JWT_SECRET must be a base64url-encoded random secret');
}
const secret = Buffer.from(encodedSecret, 'base64url');
if (secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 random bytes');

const issuer = 'home-service-api';
const audience = 'home-service-client';
const lifetimeSeconds = 15 * 60;

export async function issueAccessToken(account) {
  const accessToken = await new SignJWT({ role: account.role, ver: account.authVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(account.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${lifetimeSeconds}s`)
    .sign(secret);
  return { accessToken, tokenType: 'Bearer', expiresIn: lifetimeSeconds };
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], issuer, audience });
  return payload;
}
