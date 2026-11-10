import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../app.js';
import { createAssignmentMcpClient } from '../mcp/assignmentClient.js';
import { HttpError } from '../utils/httpError.js';

test('MCP introspection uses the same user access token check', async () => {
  const userId = randomUUID();
  const authService = {
    async authenticate(token) {
      if (token !== 'valid') throw new HttpError(401, 'Invalid token');
      return { id: userId, role: 'customer' };
    },
  };
  const server = createApp({ authService }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/auth/introspect`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer revoked' } })).status, 401);
    const response = await fetch(url, { headers: { Authorization: 'Bearer valid' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { active: true, userId, role: 'customer' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
  assert.throws(() => createAssignmentMcpClient(), /user access token/);
  const mcp = createAssignmentMcpClient({ accessToken: 'valid' });
  await mcp.disconnect();
});
