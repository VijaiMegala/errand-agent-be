import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAgentRouter } from '../routes/agentRoutes.js';
import { createAgentService } from '../services/agentService.js';
import { HttpError } from '../utils/httpError.js';

function createMemoryRepository(ownerId, initialMessages = [], initialApproval = null) {
  const sessionId = randomUUID();
  const messages = initialMessages.map((content, index) => ({
    seq: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content,
  }));
  let summary = null;
  let summarizedThroughSeq = 0;
  let claimed = false;
  const approval = initialApproval && {
    ...initialApproval,
    sessionId,
    userId: ownerId,
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const saved = { summaries: [], bookings: [], requests: [], reschedules: [] };

  const repository = {
    async create(userId) { return { id: sessionId, userId }; },
    async getOwned(id, userId) {
      return id === sessionId && userId === ownerId ? { id: sessionId, userId } : null;
    },
    async claim(id, userId) {
      if (id !== sessionId || userId !== ownerId || claimed) return null;
      claimed = true;
      return 'lease';
    },
    async release(id, lease) {
      if (id === sessionId && lease === 'lease') claimed = false;
    },
    async appendMessage(id, role, content) {
      assert.equal(id, sessionId);
      const message = { seq: messages.length + 1, role, content };
      messages.push(message);
      return message;
    },
    async loadContext(id) {
      if (id !== sessionId) return null;
      return {
        summary,
        summarizedThroughSeq,
        messages: messages.filter(({ seq }) => seq > summarizedThroughSeq),
      };
    },
    async saveSummary(id, nextSummary, throughSeq) {
      assert.equal(id, sessionId);
      summary = nextSummary;
      summarizedThroughSeq = throughSeq;
      saved.summaries.push({ summary, throughSeq });
      return true;
    },
    async supersedeApprovals() {
      if (approval?.status === 'pending') approval.status = 'superseded';
    },
    async getApproval(id, requestedSession, userId) {
      return approval?.id === id && requestedSession === sessionId && userId === ownerId ? { ...approval } : null;
    },
    async consumeApproval(id, requestedSession, userId) {
      if (approval?.id !== id || requestedSession !== sessionId || userId !== ownerId || approval.status !== 'pending') return null;
      approval.status = 'consumed';
      approval.consumedAt = new Date().toISOString();
      return { ...approval };
    },
    async upsertBooking(userId, requestedSession, booking) {
      saved.bookings.push({ userId, sessionId: requestedSession, booking });
    },
    async submitBookingRequest(userId, holdId) {
      assert.equal(userId, ownerId);
      if (!saved.requests.includes(holdId)) saved.requests.push(holdId);
      return true;
    },
    async submitRescheduleRequest(userId, approvalId, details) {
      assert.equal(userId, ownerId);
      if (!saved.reschedules.some((item) => item.approvalId === approvalId)) {
        saved.reschedules.push({ approvalId, details });
      }
      return { id: 'request-1', status: 'pending' };
    },
  };
  return { repository, sessionId, messages, saved, approval };
}

function createFakeService(repository, {
  calls = [], summaries = [], modelInputs = [], narratorInputs = [], reply = 'A reply', assignmentCall, discoveryError,
} = {}) {
  const heldBooking = {
    status: 'held', booking_id: 'hold-token', provider_id: 'provider',
    service: 'cleaning', slot: 'slot-token', starts_at: '2026-11-15T10:00:00Z', quoted_price: 500,
  };
  return createAgentService({
    repository,
    mcpClientFactory: () => ({ async disconnect() {} }),
    assignmentFactory: async () => {
      if (discoveryError) throw discoveryError;
      return {
      async call(name, args) {
        calls.push({ name, args });
        if (assignmentCall) return assignmentCall(name, args);
        if (name === 'get_booking_status') {
          return heldBooking;
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
      };
    },
    summarizerFactory: () => ({
      async generate(input) {
        summaries.push(JSON.parse(input[0].content));
        return { text: `Summary ${summaries.length}` };
      },
    }),
    agentFactory: () => ({
      async stream(input) {
        modelInputs.push(input);
        return {
          textStream: (async function* () { yield reply; })(),
          text: Promise.resolve(reply),
        };
      },
    }),
    actionNarratorFactory: () => ({
      async generate(input) {
        const outcome = JSON.parse(input[0].content);
        narratorInputs.push(outcome);
        const text = outcome.status === 'confirmed'
          ? `Booking confirmed with ${outcome.providerName}.`
          : outcome.status === 'details_changed'
            ? 'The booking details changed since approval.'
            : `The ${outcome.action} outcome is ${outcome.status}.`;
        return { text };
      },
    }),
  });
}

test('chat route streams JSONL and rejects unauthenticated, provider, and invalid requests', async () => {
  const customer = { id: randomUUID(), role: 'customer' };
  const provider = { id: randomUUID(), role: 'service_provider' };
  const sessionId = randomUUID();
  const seen = [];
  const service = {
    async chat(input, emit) {
      seen.push(input);
      await emit({ type: 'session', sessionId });
      await emit({ type: 'delta', text: 'Hello' });
      return { sessionId };
    },
  };
  const authService = {
    async authenticate(token) {
      if (token === 'customer') return customer;
      if (token === 'provider') return provider;
      throw new HttpError(401, 'Invalid token');
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter(service, authService));
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/agent/chat`;
    const send = (body, token) => fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    assert.equal((await send({ message: 'Hello' })).status, 401);
    assert.equal((await send({ message: 'Hello' }, 'provider')).status, 403);
    assert.equal((await send({ message: '' }, 'customer')).status, 400);
    assert.equal((await send({ approval: { id: randomUUID(), confirm: false }, sessionId }, 'customer')).status, 400);
    assert.equal(seen.length, 0);

    const response = await send({ message: '  Find a cleaner  ' }, 'customer');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/x-ndjson/);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events, [
      { type: 'session', sessionId },
      { type: 'delta', text: 'Hello' },
      { type: 'done', sessionId },
    ]);
    assert.equal(seen[0].accessToken, 'customer');
    assert.deepEqual(seen[0].user, customer);
    assert.equal(seen[0].message, 'Find a cleaner');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('agent keeps all messages through 10, then summarizes older messages and retains the latest 10', async () => {
  const user = { id: randomUUID(), role: 'customer' };
  const { repository, sessionId, saved } = createMemoryRepository(user.id,
    Array.from({ length: 9 }, (_unused, index) => `Message ${index + 1}`));
  const modelInputs = [];
  const summaries = [];
  const service = createFakeService(repository, { modelInputs, summaries });
  const emit = async () => {};

  await service.chat({ user, accessToken: 'token', sessionId, message: 'Message 10' }, emit);
  assert.equal(modelInputs[0].length, 11);
  assert.match(modelInputs[0][0].content, /^Application context: current date and time in Asia\/Kolkata is /);
  assert.equal(modelInputs[0][1].content, 'Message 1');
  assert.equal(summaries.length, 0);

  await service.chat({ user, accessToken: 'token', sessionId, message: 'Message 12' }, emit);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].previousSummary, null);
  assert.deepEqual(summaries[0].transcript.map(({ content }) => content), ['Message 1', 'Message 2']);
  assert.deepEqual(saved.summaries, [{ summary: 'Summary 1', throughSeq: 2 }]);
  assert.equal(modelInputs[1].length, 12);
  assert.match(modelInputs[1][0].content, /^Application context: current date and time in Asia\/Kolkata is /);
  assert.match(modelInputs[1][1].content, /Summary 1/);
  assert.equal(modelInputs[1][2].content, 'Message 3');
  assert.equal(modelInputs[1].at(-1).content, 'Message 12');
});

test('agent rejects another customer’s session without calling MCP or model', async () => {
  const ownerId = randomUUID();
  const user = { id: randomUUID(), role: 'customer' };
  const { repository, sessionId } = createMemoryRepository(ownerId);
  const calls = [];
  const modelInputs = [];
  const service = createFakeService(repository, { calls, modelInputs });
  await assert.rejects(
    service.chat({ user, accessToken: 'token', sessionId, message: 'Hello' }, async () => {}),
    { status: 404 },
  );
  assert.equal(calls.length, 0);
  assert.equal(modelInputs.length, 0);
});

test('customer approval submits a provider request without confirming the booking', async () => {
  const user = { id: randomUUID(), role: 'customer' };
  const approvalId = randomUUID();
  const approval = {
    id: approvalId,
    kind: 'book',
    payload: {
      holdId: 'hold-token', providerId: 'provider', providerName: 'Cleaner',
      slot: 'slot-token', quotedPrice: 500, startsAt: '2026-11-15T10:00:00Z',
    },
  };
  const state = createMemoryRepository(user.id, [], approval);
  const calls = [];
  const service = createFakeService(state.repository, { calls });
  await assert.rejects(
    service.chat({
      user, accessToken: 'token', sessionId: state.sessionId,
      approval: { id: approvalId, confirm: false },
    }, async () => {}),
    { status: 400 },
  );
  assert.equal(calls.length, 0);
  assert.equal(state.approval.status, 'pending');

  await service.chat({
    user, accessToken: 'token', sessionId: state.sessionId,
    approval: { id: approvalId, confirm: true },
  }, async () => {});
  const expectedArgs = { hold_id: 'hold-token' };
  assert.deepEqual(calls, [{ name: 'get_booking_status', args: expectedArgs }]);
  assert.deepEqual(state.saved.requests, ['hold-token']);
  assert.equal(state.approval.status, 'consumed');

  await service.chat({
    user, accessToken: 'token', sessionId: state.sessionId,
    approval: { id: approvalId, confirm: true },
  }, async () => {});
  assert.deepEqual(calls, [
    { name: 'get_booking_status', args: expectedArgs },
    { name: 'get_booking_status', args: expectedArgs },
  ]);
  assert.deepEqual(state.saved.requests, ['hold-token']);
  assert.ok(calls.every(({ name }) => name !== 'book'));
});

test('provider acceptance is reported only after the provider confirms the submitted request', async () => {
  const user = { id: randomUUID(), role: 'customer' };
  const approvalId = randomUUID();
  const state = createMemoryRepository(user.id, [], {
    id: approvalId,
    kind: 'book',
    payload: {
      holdId: 'hold-token', providerId: 'provider', providerName: 'Cleaner',
      slot: 'slot-token', quotedPrice: 500, startsAt: '2026-11-15T10:00:00Z',
    },
  });
  const calls = [];
  const narratorInputs = [];
  let remoteStatus = 'held';
  const confirmed = {
    status: 'confirmed', booking_id: 'hold-token', provider_id: 'provider',
    service: 'cleaning', slot: 'slot-token', starts_at: '2026-11-15T10:00:00Z', quoted_price: 500,
  };
  const service = createFakeService(state.repository, {
    calls, narratorInputs,
    async assignmentCall(name) {
      if (name === 'get_booking_status') return { ...confirmed, status: remoteStatus };
      throw new Error(`Unexpected tool: ${name}`);
    },
  });
  const events = [];
  const input = {
    user, accessToken: 'token', sessionId: state.sessionId,
    approval: { id: approvalId, confirm: true },
  };
  await service.chat(input, async (event) => { events.push(event); });
  assert.deepEqual(calls.map(({ name }) => name), ['get_booking_status']);
  assert.equal(state.saved.bookings.length, 1);
  assert.match(events.find(({ type }) => type === 'delta').text, /awaiting provider acceptance/);
  assert.deepEqual(events.find(({ type }) => type === 'action_outcome'), {
    type: 'action_outcome', approvalId, action: 'book', status: 'request_sent',
  });
  assert.deepEqual(state.saved.requests, ['hold-token']);
  assert.equal(narratorInputs.length, 0);

  remoteStatus = 'confirmed';
  await service.chat(input, async (event) => { events.push(event); });
  assert.deepEqual(calls.map(({ name }) => name), ['get_booking_status', 'get_booking_status']);
  assert.deepEqual(state.saved.requests, ['hold-token']);
  assert.equal(narratorInputs[0].status, 'confirmed');
});

test('customer reschedule approval sends a provider request without changing the booking', async () => {
  const user = { id: randomUUID(), role: 'customer' };
  const bookingId = randomUUID();
  const approvalId = randomUUID();
  const payload = {
    bookingId, providerId: 'provider', service: 'cleaning',
    oldSlot: 'old-slot', oldStartsAt: '2026-11-15T10:00:00Z',
    newSlot: 'new-slot', newStartsAt: '2026-11-16T10:00:00Z', quotedPrice: 500,
  };
  const state = createMemoryRepository(user.id, [], { id: approvalId, kind: 'reschedule', payload });
  state.repository.getBooking = async () => ({ bookingId, providerId: 'provider',
    service: 'cleaning', slot: 'old-slot', startsAt: payload.oldStartsAt, quote: 500 });
  const calls = [];
  const service = createFakeService(state.repository, {
    calls,
    async assignmentCall(name) {
      if (name === 'list_bookings') return [{ booking_id: bookingId, status: 'confirmed',
        provider_id: 'provider', service: 'cleaning', slot: 'old-slot',
        starts_at: payload.oldStartsAt, quoted_price: 500 }];
      throw new Error(`Unexpected MCP tool: ${name}`);
    },
  });
  const events = [];
  await service.chat({ user, accessToken: 'token', sessionId: state.sessionId,
    approval: { id: approvalId, confirm: true } }, async (event) => events.push(event));
  assert.deepEqual(calls.map(({ name }) => name), ['list_bookings']);
  assert.equal(state.saved.reschedules.length, 1);
  assert.equal(events.find(({ type }) => type === 'action_outcome').status, 'request_sent');
  assert.match(events.find(({ type }) => type === 'delta').text, /original time until the provider accepts/);
});

for (const kind of ['cancel', 'reschedule']) {
  test(`${kind} refuses a booking whose remote details changed after approval`, async () => {
    const user = { id: randomUUID(), role: 'customer' };
    const bookingId = randomUUID();
    const approvalId = randomUUID();
    const baseline = {
      bookingId, providerId: 'provider', service: 'cleaning',
      slot: 'old-slot', startsAt: '2026-11-15T10:00:00Z', quotedPrice: 500,
      idempotencyKey: 'stable-key',
    };
    const payload = kind === 'cancel' ? baseline : {
      bookingId, providerId: baseline.providerId, service: baseline.service,
      oldSlot: baseline.slot, oldStartsAt: baseline.startsAt,
      newSlot: 'new-slot', newStartsAt: '2026-11-16T10:00:00Z',
      quotedPrice: baseline.quotedPrice, idempotencyKey: baseline.idempotencyKey,
    };
    const state = createMemoryRepository(user.id, [], { id: approvalId, kind, payload });
    state.repository.getBooking = async (requestedUser, requestedBooking) =>
      requestedUser === user.id && requestedBooking === bookingId ? baseline : null;
    const calls = [];
    const service = createFakeService(state.repository, {
      calls,
      async assignmentCall(name) {
        if (name === 'list_bookings') return [{
          booking_id: bookingId, status: 'confirmed', provider_id: 'provider',
          service: 'cleaning', slot: 'old-slot', starts_at: baseline.startsAt,
          quoted_price: 700,
        }];
        throw new Error(`Unexpected write tool: ${name}`);
      },
    });
    const events = [];
    await service.chat({
      user, accessToken: 'token', sessionId: state.sessionId,
      approval: { id: approvalId, confirm: true },
    }, async (event) => { events.push(event); });
    assert.deepEqual(calls.map(({ name }) => name), ['list_bookings']);
    assert.match(events.find(({ type }) => type === 'delta').text, /details changed since approval/);
  });
}

test('MCP discovery failure still allows a clarification response', async () => {
  const user = { id: randomUUID(), role: 'customer' };
  const state = createMemoryRepository(user.id);
  const modelInputs = [];
  const reply = 'What date would you prefer?';
  const service = createFakeService(state.repository, {
    modelInputs, reply, discoveryError: new Error('MCP unavailable'),
  });
  const events = [];
  await service.chat({ user, accessToken: 'token', sessionId: state.sessionId, message: 'Book a cleaner' },
    async (event) => { events.push(event); });
  assert.match(modelInputs[0][0].content, /tools are currently unavailable/);
  assert.equal(modelInputs[0].at(-1).content, 'Book a cleaner');
  assert.deepEqual(events.map(({ type }) => type), ['session', 'delta']);
  assert.equal(events[1].text, reply);
  assert.equal(state.messages.at(-1).content, reply);
});
