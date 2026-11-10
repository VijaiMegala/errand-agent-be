import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { attachNotificationSocket, notificationChannel } from '../realtime/notificationSocket.js';
import { HttpError } from '../utils/httpError.js';

test('notification WebSocket authenticates and sends only the recipient event', async () => {
  const customerId = randomUUID();
  const providerId = randomUUID();
  const subscriber = new EventEmitter();
  subscriber.status = 'ready';
  subscriber.subscribe = async () => 1;
  const authService = {
    async authenticate(token) {
      if (token === 'customer') return { id: customerId, role: 'customer' };
      if (token === 'provider') return { id: providerId, role: 'service_provider' };
      throw new HttpError(401, 'Invalid token');
    },
  };
  const server = createApp({ authService }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const closeSocket = attachNotificationSocket(server, { authService, subscriber });
  const clients = [];
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const url = `ws://127.0.0.1:${server.address().port}/api/notifications/ws`;
    const open = async (token) => {
      const client = new WebSocket(url, ['bearer', token]);
      client.on('error', () => {});
      clients.push(client);
      const ready = once(client, 'message');
      await once(client, 'open');
      assert.deepEqual(JSON.parse((await ready)[0]), { type: 'ready' });
      return client;
    };
    const customer = await open('customer');
    const provider = await open('provider');
    let providerMessages = 0;
    provider.on('message', () => { providerMessages++; });
    const message = once(customer, 'message');
    subscriber.emit('message', notificationChannel, JSON.stringify({
      recipientUserId: customerId,
      notification: { id: '1', bookingId: randomUUID(), eventType: 'booking_confirmed' },
    }));
    const event = JSON.parse((await message)[0]);
    assert.equal(event.type, 'notification');
    assert.equal(event.data.eventType, 'booking_confirmed');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(providerMessages, 0);
    const invalid = new WebSocket(url, ['bearer', 'invalid']);
    invalid.on('error', () => {});
    clients.push(invalid);
    const [, response] = await once(invalid, 'unexpected-response');
    assert.equal(response.statusCode, 401);
  } finally {
    for (const client of clients) client.terminate();
    await closeSocket();
    await new Promise((resolve) => server.close(resolve));
  }
});
