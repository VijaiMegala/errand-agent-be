import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createAuthService } from '../services/authService.js';
import { createUserService } from '../services/userService.js';

const password = 'securepass123';
const nextPassword = 'newsecurepass456';

function publicUser(user) {
  const { passwordHash: _passwordHash, authVersion: _authVersion, ...visible } = user;
  return visible;
}

function memoryRepository() {
  const users = new Map();
  return {
    users,
    async create(user) {
      if ([...users.values()].some((saved) => saved.email === user.email)) {
        throw Object.assign(new Error('duplicate email'), { code: '23505' });
      }
      const now = new Date().toISOString();
      const saved = { ...user, authVersion: 0, createdAt: now, updatedAt: now };
      users.set(user.id, saved);
      return publicUser(saved);
    },
    async findById(id) {
      const user = users.get(id);
      return user ? publicUser(user) : null;
    },
    async findAuthByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findAuthById(id) { return users.get(id) ?? null; },
    async update(id, changes) {
      const existing = users.get(id);
      if (!existing) return null;
      if (changes.email && [...users.values()].some((saved) => saved.id !== id && saved.email === changes.email)) {
        throw Object.assign(new Error('duplicate email'), { code: '23505' });
      }
      const updated = { ...existing, ...changes, updatedAt: new Date().toISOString() };
      users.set(id, updated);
      return publicUser(updated);
    },
    async updatePassword(id, oldVersion, passwordHash) {
      const user = users.get(id);
      if (!user || user.authVersion !== oldVersion) return null;
      const updated = { ...user, passwordHash, authVersion: oldVersion + 1 };
      users.set(id, updated);
      return { id, role: user.role, authVersion: updated.authVersion };
    },
    async delete(id) { return users.delete(id); },
  };
}

async function withServer(callback) {
  const repository = memoryRepository();
  const app = createApp({
    userService: createUserService(repository),
    authService: createAuthService(repository),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await callback(url, repository); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function request(url, method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    body: response.status === 204 ? null : await response.json(),
  };
}

async function registerAndLogin(url, role, email) {
  const created = await request(url, 'POST', '/api/users', {
    role, fullName: 'Alex Kumar', email, phone: '+919876543210', password,
  });
  assert.equal(created.status, 201);
  const login = await request(url, 'POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200);
  return { created, token: login.body.accessToken };
}

test('both roles can register, log in, and manage only their own profile', async () => {
  await withServer(async (url, repository) => {
    for (const role of ['customer', 'service_provider']) {
      const { created, token } = await registerAndLogin(url, role, `${role}@example.com`);
      const id = created.body.data.id;
      assert.equal(created.body.data.role, role);
      assert.equal(created.location, `/api/users/${id}`);
      assert.equal(created.body.data.passwordHash, undefined);
      assert.notEqual(repository.users.get(id).passwordHash, password);
      assert.match(repository.users.get(id).passwordHash, /^scrypt\$/);

      assert.equal((await request(url, 'GET', `/api/users/${id}`)).status, 401);
      const fetched = await request(url, 'GET', `/api/users/${id}`, undefined, token);
      assert.equal(fetched.status, 200);
      assert.equal(fetched.body.data.email, `${role}@example.com`);

      const updated = await request(url, 'PATCH', `/api/users/${id}`, { fullName: 'Alex Sharma', phone: null }, token);
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.fullName, 'Alex Sharma');
      assert.equal(updated.body.data.phone, null);
      assert.equal(updated.body.data.role, role);

      assert.equal((await request(url, 'DELETE', `/api/users/${id}`, undefined, token)).status, 204);
      assert.equal((await request(url, 'GET', `/api/users/${id}`, undefined, token)).status, 401);
    }
  });
});

test('authorization and password changes invalidate previous tokens', async () => {
  await withServer(async (url) => {
    const customer = await registerAndLogin(url, 'customer', 'customer@example.com');
    const provider = await registerAndLogin(url, 'service_provider', 'provider@example.com');
    const customerId = customer.created.body.data.id;
    const providerId = provider.created.body.data.id;

    assert.equal((await request(url, 'GET', `/api/users/${providerId}`, undefined, customer.token)).status, 403);
    assert.equal((await request(url, 'PATCH', `/api/users/${providerId}`, { fullName: 'Wrong' }, customer.token)).status, 403);
    assert.equal((await request(url, 'GET', `/api/users/${customerId}`, undefined, customer.token + 'x')).status, 401);
    assert.equal((await request(url, 'GET', '/api/users/not-a-uuid', undefined, customer.token)).status, 400);

    const changed = await request(url, 'PATCH', `/api/users/${customerId}/password`, {
      currentPassword: password, newPassword: nextPassword,
    }, customer.token);
    assert.equal(changed.status, 200);
    assert.ok(changed.body.accessToken);
    assert.equal((await request(url, 'GET', `/api/users/${customerId}`, undefined, customer.token)).status, 401);
    assert.equal((await request(url, 'GET', `/api/users/${customerId}`, undefined, changed.body.accessToken)).status, 200);
    assert.equal((await request(url, 'POST', '/api/auth/login', { email: 'customer@example.com', password })).status, 401);
    assert.equal((await request(url, 'POST', '/api/auth/login', { email: 'customer@example.com', password: nextPassword })).status, 200);
    assert.equal((await request(url, 'GET', `/api/users/${providerId}`, undefined, provider.token)).status, 200);
  });
});

test('validation, duplicate emails, and documented auth routes', async () => {
  await withServer(async (url, repository) => {
    assert.equal((await request(url, 'POST', '/api/users', { role: 'admin', fullName: 'A', email: 'bad' })).status, 400);
    assert.equal((await request(url, 'POST', '/api/users', {
      role: 'customer', fullName: 'Sam Rao', email: 'sam@example.com', password: 'short',
    })).status, 400);
    assert.equal((await request(url, 'POST', '/api/users', {
      role: 'customer', fullName: 'Sam Rao', email: 'sam@example.com', password: '12345678901234567',
    })).status, 400);
    assert.equal(repository.users.size, 0);
    assert.equal((await request(url, 'POST', '/api/users', {
      role: 'customer', fullName: 'Eight Chars', email: 'eight@example.com', password: '12345678',
    })).status, 201);
    assert.equal((await request(url, 'POST', '/api/users', {
      role: 'customer', fullName: 'Sixteen Chars', email: 'sixteen@example.com', password: '1234567890123456',
    })).status, 201);
    const { created, token } = await registerAndLogin(url, 'customer', 'sam@example.com');
    const id = created.body.data.id;
    assert.equal((await request(url, 'PATCH', `/api/users/${id}/password`, {
      currentPassword: password, newPassword: '1234567',
    }, token)).status, 400);
    assert.equal((await request(url, 'PATCH', `/api/users/${id}/password`, {
      currentPassword: password, newPassword: '12345678901234567',
    }, token)).status, 400);
    assert.equal((await request(url, 'POST', '/api/users', {
      role: 'customer', fullName: 'Sam Rao', email: 'SAM@example.com', password,
    })).status, 409);
    assert.equal((await request(url, 'PATCH', `/api/users/${id}`, { role: 'service_provider' }, token)).status, 400);
    assert.equal((await request(url, 'PATCH', `/api/users/${id}`, {}, token)).status, 400);
    assert.equal((await request(url, 'POST', '/api/auth/login', { email: 'nobody@example.com', password })).status, 401);
    assert.equal((await request(url, 'POST', '/api/auth/login', { email: 'sam@example.com', password: 'wrong password' })).status, 401);

    const spec = (await request(url, 'GET', '/api/openapi.json')).body;
    assert.ok(spec.paths['/api/auth/login'].post);
    assert.ok(spec.paths['/api/users/{id}/password'].patch);
    assert.deepEqual(spec.paths['/api/users/{id}'].get.security, [{ bearerAuth: [] }]);
    const docs = await fetch(url + '/api/docs/');
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /swagger-ui/i);
  });
});

test('legacy accounts without passwords cannot log in', async () => {
  await withServer(async (url, repository) => {
    repository.users.set('11111111-1111-4111-8111-111111111111', {
      id: '11111111-1111-4111-8111-111111111111',
      role: 'customer', email: 'legacy@example.com', passwordHash: null, authVersion: 0,
    });
    const result = await request(url, 'POST', '/api/auth/login', { email: 'legacy@example.com', password });
    assert.equal(result.status, 401);
  });
});
