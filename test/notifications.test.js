import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { createNotificationService } from '../services/notificationService.js';
import { HttpError } from '../utils/httpError.js';
import { openApiSpec } from '../docs/openapi.js';

test('notification inbox is scoped to the signed-in user', async () => {
  const customerId = randomUUID();
  const providerId = randomUUID();
  const records = [
    { id: '1', recipientUserId: customerId, eventType: 'booking_confirmed' },
    { id: '2', recipientUserId: providerId, eventType: 'booking_requested' },
  ];
  const notificationService = createNotificationService({
    async list(id) { return records.filter((record) => record.recipientUserId === id); },
    async markRead(id, userId) {
      const record = records.find((item) => item.id === id && item.recipientUserId === userId);
      if (record) record.readAt = new Date().toISOString();
      return record ?? null;
    },
  });
  const authService = {
    async authenticate(token) {
      if (token === 'customer') return { id: customerId, role: 'customer' };
      if (token === 'provider') return { id: providerId, role: 'service_provider' };
      throw new HttpError(401, 'Invalid token');
    },
  };
  const server = createApp({ notificationService, authService }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, token) => {
      const response = await fetch(base + path, {
        method, headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call('GET', '/api/notifications')).status, 401);
    assert.deepEqual((await call('GET', '/api/notifications', 'customer')).body.data.map((item) => item.id), ['1']);
    assert.equal((await call('PATCH', '/api/notifications/2/read', 'customer')).status, 404);
    assert.equal((await call('PATCH', '/api/notifications/1/read', 'customer')).status, 200);
    assert.equal((await call('PATCH', '/api/notifications/1/read', 'provider')).status, 404);
    assert.equal((await call('PATCH', '/api/notifications/nope/read', 'customer')).status, 400);
    assert.ok(openApiSpec.paths['/api/notifications'].get);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
