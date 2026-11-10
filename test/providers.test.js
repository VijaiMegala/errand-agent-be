import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { createProviderService } from '../services/providerService.js';
import { HttpError } from '../utils/httpError.js';

const providerId = randomUUID();
const providerOwnerId = randomUUID();
const otherProviderId = randomUUID();
const customerId = randomUUID();

function fakeRepository() {
  const services = [];
  const slots = [];
  const reviews = [];
  return {
    services, slots, reviews,
    async findOwner(id) { return id === providerId ? providerOwnerId : null; },
    async createService(id, values) {
      if (services.some((item) => item.name.toLowerCase() === values.name.toLowerCase())) {
        throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'provider_services_name_unique' });
      }
      const item = { id: randomUUID(), providerId: id, ...values, active: true };
      services.push(item);
      return item;
    },
    async listServices() { return services; },
    async createSlot(id, values) {
      if (!services.some((item) => item.id === values.serviceId && item.active)) {
        throw new HttpError(404, 'Active service not found for provider');
      }
      if (slots.some((item) => item.startsAt < values.endsAt && item.endsAt > values.startsAt)) {
        throw Object.assign(new Error('overlap'), { code: '23P01' });
      }
      const item = { id: randomUUID(), providerId: id, ...values, status: 'available' };
      slots.push(item);
      return item;
    },
    async listSlots() { return slots; },
    async createReview(id, reviewerUserId, values) {
      const item = { id: randomUUID(), providerId: id, ...values };
      reviews.push({ ...item, reviewerUserId });
      return item;
    },
    async listReviews() { return reviews.map(({ reviewerUserId: _reviewerUserId, ...item }) => item); },
  };
}

const actors = {
  owner: { id: providerOwnerId, role: 'service_provider' },
  other: { id: otherProviderId, role: 'service_provider' },
  customer: { id: customerId, role: 'customer' },
};

async function withServer(callback) {
  const repository = fakeRepository();
  const authService = {
    async authenticate(token) {
      if (!actors[token]) throw new HttpError(401, 'Invalid token');
      return actors[token];
    },
  };
  const app = createApp({ providerService: createProviderService(repository), authService });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`, repository); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function request(base, method, path, body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('only the listing owner creates services and slots, with bounded input and no overlap', async () => {
  await withServer(async (base, repository) => {
    const servicesPath = `/api/providers/${providerId}/services`;
    const slotsPath = `/api/providers/${providerId}/slots`;
    const service = { name: 'Kitchen tap repair', description: 'Fix a leaking tap', price: 1200, durationMinutes: 60 };

    assert.equal((await request(base, 'POST', servicesPath, service)).status, 401);
    assert.equal((await request(base, 'POST', servicesPath, service, 'customer')).status, 403);
    assert.equal((await request(base, 'POST', servicesPath, service, 'other')).status, 403);
    assert.equal((await request(base, 'POST', servicesPath, { ...service, price: -1 }, 'owner')).status, 400);
    assert.equal(repository.services.length, 0);

    const created = await request(base, 'POST', servicesPath, service, 'owner');
    assert.equal(created.status, 201);
    assert.equal(created.body.data.providerId, providerId);
    assert.equal((await request(base, 'POST', servicesPath, { ...service, name: 'KITCHEN TAP REPAIR' }, 'owner')).status, 409);
    assert.equal((await request(base, 'GET', servicesPath)).body.data.length, 1);

    const start = new Date(Date.now() + 86400000);
    const end = new Date(start.getTime() + 3600000);
    const slot = { serviceId: created.body.data.id, startsAt: start.toISOString(), endsAt: end.toISOString() };
    assert.equal((await request(base, 'POST', slotsPath, slot, 'customer')).status, 403);
    assert.equal((await request(base, 'POST', slotsPath, { startsAt: slot.startsAt, endsAt: slot.endsAt }, 'owner')).status, 400);
    assert.equal((await request(base, 'POST', slotsPath, { ...slot, serviceId: randomUUID() }, 'owner')).status, 404);
    assert.equal((await request(base, 'POST', slotsPath, { ...slot, endsAt: slot.startsAt }, 'owner')).status, 400);
    assert.equal((await request(base, 'POST', slotsPath, {
      serviceId: slot.serviceId,
      startsAt: '2027-02-30T10:00:00Z', endsAt: '2027-02-30T11:00:00Z',
    }, 'owner')).status, 400);
    const createdSlot = await request(base, 'POST', slotsPath, slot, 'owner');
    assert.equal(createdSlot.status, 201);
    assert.equal(createdSlot.body.data.serviceId, slot.serviceId);
    assert.equal((await request(base, 'POST', slotsPath, {
      serviceId: slot.serviceId,
      startsAt: new Date(start.getTime() + 1800000).toISOString(),
      endsAt: new Date(end.getTime() + 1800000).toISOString(),
    }, 'owner')).status, 409);
    assert.equal((await request(base, 'GET', slotsPath)).body.data.length, 1);
  });
});

test('only customers add reviews and reviewer identity comes from the token', async () => {
  await withServer(async (base, repository) => {
    const path = `/api/providers/${providerId}/reviews`;
    const review = { rating: 5, reviewText: 'The repair was done well.' };
    assert.equal((await request(base, 'POST', path, review)).status, 401);
    assert.equal((await request(base, 'POST', path, review, 'owner')).status, 403);
    assert.equal((await request(base, 'POST', path, { ...review, reviewerUserId: providerOwnerId }, 'customer')).status, 400);
    assert.equal((await request(base, 'POST', path, { ...review, rating: 6 }, 'customer')).status, 400);
    assert.equal(repository.reviews.length, 0);

    const created = await request(base, 'POST', path, review, 'customer');
    assert.equal(created.status, 201);
    assert.equal(created.body.data.reviewerUserId, undefined);
    assert.equal(repository.reviews[0].reviewerUserId, customerId);
    assert.equal((await request(base, 'GET', path)).body.data.length, 1);
    assert.equal((await request(base, 'GET', `/api/providers/${randomUUID()}/reviews`)).status, 404);
  });
});

test('Swagger documents provider endpoints and bearer requirements', async () => {
  await withServer(async (base) => {
    const spec = (await request(base, 'GET', '/api/openapi.json')).body;
    for (const path of ['services', 'slots', 'reviews']) {
      const entry = spec.paths[`/api/providers/{providerId}/${path}`];
      assert.ok(entry.get);
      assert.ok(entry.post);
      assert.deepEqual(entry.post.security, [{ bearerAuth: [] }]);
    }
  });
});
