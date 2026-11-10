import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createBookingService } from '../services/bookingService.js';
import { openApiSpec } from '../docs/openapi.js';

test('customers book with their token identity and list only their bookings', async () => {
  const providerId = randomUUID();
  const actor = { id: randomUUID(), role: 'customer' };
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const values = { slotId: randomUUID(), serviceId: randomUUID(), startsAt: start.toISOString() };
  const saved = [];
  const service = createBookingService({
    async create(provider, customer, booking) {
      saved.push({ provider, customer, booking });
      return { id: randomUUID(), ...booking };
    },
    async listMine(customer) { return saved.filter((entry) => entry.customer === customer); },
  });
  await service.create(providerId, actor, values);
  assert.equal(saved[0].provider, providerId);
  assert.equal(saved[0].customer, actor.id);
  assert.equal(saved[0].booking.startsAt, start.toISOString());
  assert.equal((await service.listMine(actor)).length, 1);
  await assert.rejects(service.create(providerId, { id: randomUUID(), role: 'service_provider' }, values), { status: 403 });
  await assert.rejects(service.create(providerId, actor, { ...values, customerUserId: randomUUID() }), { status: 400 });
  assert.ok(openApiSpec.paths['/api/providers/{providerId}/bookings'].post.responses[409]);
});
