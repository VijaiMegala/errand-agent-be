import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAgentRouter } from '../routes/agentRoutes.js';
import { createAgentService } from '../services/agentService.js';
import { openApiSpec } from '../docs/openapi.js';
import { HttpError } from '../utils/httpError.js';

test('session APIs list and manage only the signed-in customer’s conversations', async () => {
  const firstUser = randomUUID();
  const secondUser = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const now = new Date().toISOString();
  const sessions = new Map([
    [firstId, { id: firstId, userId: firstUser, title: 'Find a plumber', createdAt: now, updatedAt: now,
      messages: [{ seq: 1, role: 'user', content: 'Find a plumber', createdAt: now }], processing: false }],
    [secondId, { id: secondId, userId: secondUser, title: 'Find a cleaner', createdAt: now, updatedAt: now,
      messages: [], processing: false }],
  ]);
  const repository = {
    async listSessions(userId, limit, offset) {
      return [...sessions.values()].filter((session) => session.userId === userId)
        .slice(offset, offset + limit).map(({ id, title, createdAt, updatedAt }) =>
          ({ id, title, createdAt, updatedAt }));
    },
    async getOwned(id, userId) {
      const session = sessions.get(id);
      return session?.userId === userId ? session : null;
    },
    async listMessages(id, userId, limit, offset) {
      const session = sessions.get(id);
      return session?.userId === userId ? session.messages.slice(offset, offset + limit) : [];
    },
    async updateTitle(id, userId, title) {
      const session = sessions.get(id);
      if (!session || session.userId !== userId) return null;
      session.title = title;
      return { id, title, createdAt: session.createdAt, updatedAt: session.updatedAt };
    },
    async deleteSession(id, userId) {
      const session = sessions.get(id);
      return Boolean(session && session.userId === userId && !session.processing && sessions.delete(id));
    },
  };
  const service = createAgentService({ repository });
  const authService = {
    async authenticate(token) {
      if (token === 'first') return { id: firstUser, role: 'customer' };
      if (token === 'second') return { id: secondUser, role: 'customer' };
      if (token === 'provider') return { id: randomUUID(), role: 'service_provider' };
      throw new HttpError(401, 'Invalid token');
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter(service, authService));
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, token, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  try {
    assert.equal((await call('GET', '/api/agent/sessions')).status, 401);
    assert.equal((await call('GET', '/api/agent/sessions', 'provider')).status, 403);
    assert.deepEqual((await call('GET', '/api/agent/sessions', 'first')).body.data.map(({ id }) => id), [firstId]);
    assert.deepEqual((await call('GET', '/api/agent/sessions', 'second')).body.data.map(({ id }) => id), [secondId]);
    assert.equal((await call('GET', '/api/agent/sessions?limit=0', 'first')).status, 400);
    assert.deepEqual((await call('GET', `/api/agent/sessions/${firstId}/messages`, 'first')).body.data,
      sessions.get(firstId).messages);
    assert.equal((await call('GET', `/api/agent/sessions/${firstId}/messages`, 'second')).status, 404);
    assert.equal((await call('PATCH', `/api/agent/sessions/${firstId}`, 'second', { title: 'Stolen' })).status, 404);
    assert.equal((await call('PATCH', `/api/agent/sessions/${firstId}`, 'first', { title: '   ' })).status, 400);
    assert.equal((await call('PATCH', `/api/agent/sessions/${firstId}`, 'first', { title: '  Kitchen plumbing  ' })).body.data.title,
      'Kitchen plumbing');
    sessions.get(firstId).processing = true;
    assert.equal((await call('DELETE', `/api/agent/sessions/${firstId}`, 'first')).status, 409);
    sessions.get(firstId).processing = false;
    assert.equal((await call('DELETE', `/api/agent/sessions/${firstId}`, 'second')).status, 404);
    assert.equal((await call('DELETE', `/api/agent/sessions/${firstId}`, 'first')).status, 204);
    assert.equal((await call('GET', `/api/agent/sessions/${firstId}/messages`, 'first')).status, 404);
    assert.equal((await call('DELETE', '/api/agent/sessions/not-a-uuid', 'first')).status, 400);
    assert.ok(openApiSpec.paths['/api/agent/sessions'].get);
    assert.ok(openApiSpec.paths['/api/agent/sessions/{sessionId}/messages'].get);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
