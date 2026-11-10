import { randomUUID } from 'node:crypto';
import { pool } from '../models/db.js';
import { createUserRepository } from '../models/userModel.js';
import { hashPassword, validatePassword } from '../utils/password.js';
import { readHidden } from '../utils/readHidden.js';

try {
  const email = process.argv[2]?.trim().toLowerCase();
  const fullName = process.argv[3]?.trim();
  if (!process.stdin.isTTY || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !fullName || fullName.length < 2 || fullName.length > 120) {
    throw new Error('Usage: npm run create-admin -- admin@example.com "Admin Name" (interactive terminal required)');
  }
  const password = validatePassword(await readHidden('Admin password: '));
  const confirmation = await readHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  const user = await createUserRepository(pool).create({
    id: randomUUID(), role: 'admin', fullName, email, phone: null,
    passwordHash: await hashPassword(password),
  });
  console.log(`Admin created: ${user.id}`);
} catch (error) {
  console.error(error.code === '23505' ? 'Email is already registered' : error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
