import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createBookingService } from '../services/bookingService.js';
import { createApp } from '../app.js';
import { HttpError } from '../utils/httpError.js';
import { openApiSpec } from '../docs/openapi.js';

test('customers create holds; only the listing owner accepts or rejects them', async () => {
  const providerId = randomUUID();
  const actor = { id: randomUUID(), role: 'customer' };
  const owner = { id: randomUUID(), role: 'service_provider' };
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const values = { slotId: randomUUID(), serviceId: randomUUID(), startsAt: start.toISOString() };
  const saved = [];
  const service = createBookingService({
    async create(provider, customer, booking) {
      saved.push({ provider, customer, booking });
      return { id: randomUUID(), ...booking };
    },
    async listMine(customer) { return saved.filter((entry) => entry.customer === customer); },
    async findProviderOwner(id) { return id === providerId ? owner.id : null; },
    async listProvider(id) { return id === providerId ? saved : []; },
    async decide(_providerId, bookingId, decision) { return { id: bookingId, status: decision }; },
    async reschedule(bookingId, customerId, booking) {
      return { id: bookingId, customerUserId: customerId, status: 'held', ...booking };
    },
  });
  await service.create(providerId, actor, values);
  assert.equal(saved[0].provider, providerId);
  assert.equal(saved[0].customer, actor.id);
  assert.equal(saved[0].booking.startsAt, start.toISOString());
  assert.equal((await service.listMine(actor)).length, 1);
  assert.equal((await service.listProvider(providerId, owner)).length, 1);
  assert.equal((await service.decide(providerId, randomUUID(), 'confirmed', owner)).status, 'confirmed');
  assert.equal((await service.decide(providerId, randomUUID(), 'rejected', owner)).status, 'rejected');
  const rescheduled = await service.reschedule(randomUUID(), actor, values);
  assert.equal(rescheduled.status, 'held');
  assert.equal(rescheduled.customerUserId, actor.id);
  await assert.rejects(service.reschedule(randomUUID(), owner, values), { status: 403 });
  await assert.rejects(service.reschedule(randomUUID(), actor, { ...values, providerId: randomUUID() }), { status: 400 });
  await assert.rejects(service.decide(providerId, randomUUID(), 'confirmed', actor), { status: 403 });
  await assert.rejects(service.decide(providerId, randomUUID(), 'confirmed', { id: randomUUID(), role: 'service_provider' }), { status: 403 });
  await assert.rejects(service.decide(providerId, 'invalid', 'confirmed', owner), { status: 400 });
  await assert.rejects(service.create(providerId, { id: randomUUID(), role: 'service_provider' }, values), { status: 403 });
  await assert.rejects(service.create(providerId, actor, { ...values, customerUserId: randomUUID() }), { status: 400 });
  assert.ok(openApiSpec.paths['/api/providers/{providerId}/bookings'].post.responses[409]);
  assert.ok(openApiSpec.paths['/api/providers/{providerId}/bookings'].get);
  assert.ok(openApiSpec.paths['/api/providers/{providerId}/bookings/{bookingId}/accept'].patch.responses[409]);
  assert.ok(openApiSpec.paths['/api/providers/{providerId}/bookings/{bookingId}/reject'].patch.responses[409]);
  assert.equal(openApiSpec.paths['/api/bookings/{bookingId}/confirm'], undefined);
  assert.ok(openApiSpec.paths['/api/bookings/{bookingId}/reschedule'].patch.responses[409]);
});

test('provider decision routes reject customers and other providers', async () => {
  const providerId = randomUUID();
  const bookingId = randomUUID();
  const owner = { id: randomUUID(), role: 'service_provider' };
  const actors = {
    owner, other: { id: randomUUID(), role: 'service_provider' },
    customer: { id: randomUUID(), role: 'customer' },
  };
  const bookingService = createBookingService({
    async findProviderOwner(id) { return id === providerId ? owner.id : null; },
    async listProvider() { return [{ id: bookingId, status: 'held' }]; },
    async decide(_providerId, id, status) { return { id, status }; },
    async reschedule(id, customerId) { return { id, customerUserId: customerId, status: 'held' }; },
  });
  const authService = {
    async authenticate(token) {
      if (!actors[token]) throw new HttpError(401, 'Invalid token');
      return actors[token];
    },
  };
  const server = createApp({ bookingService, authService }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, token, body) => {
      const response = await fetch(base + path, {
        method, headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return response.status;
    };
    const path = `/api/providers/${providerId}/bookings`;
    assert.equal(await request('GET', path, 'owner'), 200);
    assert.equal(await request('GET', path, 'customer'), 403);
    assert.equal(await request('GET', path, 'other'), 403);
    assert.equal(await request('PATCH', `${path}/${bookingId}/accept`, 'customer'), 403);
    assert.equal(await request('PATCH', `${path}/${bookingId}/reject`, 'other'), 403);
    assert.equal(await request('PATCH', `${path}/${bookingId}/accept`, 'owner'), 200);
    assert.equal(await request('PATCH', `${path}/${bookingId}/reject`, 'owner'), 200);
    assert.equal(await request('PATCH', `/api/bookings/${bookingId}/confirm`, 'customer'), 404);
    const newTime = { slotId: randomUUID(), serviceId: randomUUID(), startsAt: new Date(Date.now() + 86400000).toISOString() };
    assert.equal(await request('PATCH', `/api/bookings/${bookingId}/reschedule`, 'customer', newTime), 200);
    assert.equal(await request('PATCH', `/api/bookings/${bookingId}/reschedule`, 'owner', newTime), 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
