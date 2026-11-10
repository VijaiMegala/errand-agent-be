import { pool } from '../models/db.js';
import { createUserRepository } from '../models/userModel.js';
import { hashPassword, validatePassword } from '../utils/password.js';
import { readHidden } from '../utils/readHidden.js';

try {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !process.stdin.isTTY) {
    throw new Error('Usage: npm run set-password -- user@example.com (interactive terminal required)');
  }
  const password = validatePassword(await readHidden('New password: '));
  const confirmation = await readHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  const changed = await createUserRepository(pool).setPasswordByEmail(email, await hashPassword(password));
  if (!changed) throw new Error('No passwordless account found for this email');
  console.log('Password set. The account can now log in.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
