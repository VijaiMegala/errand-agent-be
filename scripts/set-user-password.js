import { pool } from '../models/db.js';
import { createUserRepository } from '../models/userModel.js';
import { hashPassword, validatePassword } from '../utils/password.js';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new Error('Cancelled'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

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
