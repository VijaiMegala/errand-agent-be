import assert from 'node:assert/strict';
import test from 'node:test';
import { AssignmentToolError, createAssignmentTools } from '../mcp/assignmentTools.js';

const names = [
  'search_providers', 'get_provider', 'hold_slot', 'book',
  'get_booking_status', 'cancel', 'reschedule', 'list_bookings',
];

function fakeMcp(execute = async () => ({ content: [] })) {
  return {
    listTools: async () => Object.fromEntries(names.map((name) => [
      `assignment_${name}`, { execute: (args) => execute(name, args) },
    ])),
  };
}

test('assignment tools expose read-only agent tools and normalize Toolbox JSONL-style content', async () => {
  const { call, readTools } = await createAssignmentTools(fakeMcp(async (name) => ({
    content: name === 'search_providers'
      ? [{ type: 'text', text: '{"provider_id":"one"}' }, { type: 'text', text: '{"provider_id":"two"}' }]
      : [{ type: 'text', text: '{"provider_id":"one"}' }],
  })));
  assert.deepEqual(Object.keys(readTools), ['searchProviders', 'getProvider']);
  assert.deepEqual(await call('search_providers', {
    service: 'Plumbing', area: 'Indiranagar', date_range: '2026-11-11/2026-11-12',
    preferred_time: '11:00',
  }), [{ provider_id: 'one' }, { provider_id: 'two' }]);
  assert.deepEqual(await readTools.getProvider.execute({ provider_id: 'one' }), { provider_id: 'one' });
  await assert.rejects(call('delete_everything', {}), { code: 'unknown_tool' });
});

test('assignment tool errors preserve status and timeout details without exposing raw MCP errors', async () => {
  const { call } = await createAssignmentTools(fakeMcp(async () => {
    throw new Error('error processing request: unexpected status code: 504, response body: {"status":"timeout","outcome_unknown":true}\n');
  }));
  await assert.rejects(call('book', { hold_id: 'hold-1', idempotency_key: 'key-1' }), (error) => {
    assert.ok(error instanceof AssignmentToolError);
    assert.equal(error.code, 'timeout');
    assert.equal(error.httpStatus, 504);
    assert.equal(error.body.outcome_unknown, true);
    return true;
  });
});

test('assignment tool discovery fails when any required tool is unavailable', async () => {
  await assert.rejects(createAssignmentTools({ listTools: async () => ({}) }), /Assignment MCP tools unavailable/);
});
