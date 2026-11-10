import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTrace } from '../observability/langsmith.js';

test('trace sanitizer keeps usage and safe search filters while removing private fields', () => {
  const sanitized = sanitizeTrace({
    providerName: 'Private Name', booking_id: 'booking', slot: 'opaque-token',
    email: 'person@example.com', service: 'plumbing', area: 'Indiranagar',
    modelName: 'example-model', tokenUsage: { inputTokens: 12, outputTokens: 5 },
    result: { reviews: ['private review'], status: 'held' },
  });
  assert.deepEqual(sanitized, {
    providerName: '[REDACTED]', booking_id: '[REDACTED]', slot: '[REDACTED]',
    email: '[REDACTED]', service: 'plumbing', area: 'Indiranagar',
    modelName: 'example-model', tokenUsage: { inputTokens: 12, outputTokens: 5 },
    result: { reviews: '[REDACTED]', status: 'held' },
  });
});
