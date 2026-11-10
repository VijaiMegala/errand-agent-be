import { randomUUID } from 'node:crypto';
import { Mastra } from '@mastra/core/mastra';
import { SpanType } from '@mastra/core/observability';
import { LangSmithExporter } from '@mastra/langsmith';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, SensitiveDataFilter } from '@mastra/observability';
import '../config.js';

const enabled = process.env.LANGSMITH_TRACING === 'true' &&
  Boolean(process.env.LANGSMITH_API_KEY?.trim()) &&
  !process.env.NODE_TEST_CONTEXT &&
  !process.execArgv.some((argument) => argument === '--test' || argument.startsWith('--test=')) &&
  process.env.EVAL_OFFLINE !== 'true';

const privateText = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\+?\d{10,15}\b)/i;
function isPrivateField(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (['model', 'modelname', 'modelid', 'servicename', 'toolname',
    'tokenusage', 'inputtokens', 'outputtokens', 'totaltokens',
    'prompttokens', 'completiontokens'].includes(normalized)) return false;
  return /(?:id$|key|token|secret|auth|password|email|phone|address|name|review|slot|hold|booking|customer|user|message|prompt|content)/.test(normalized);
}

export function sanitizeTrace(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizeTrace(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [
      key, isPrivateField(key) ? '[REDACTED]' : sanitizeTrace(item, depth + 1),
    ]));
  }
  if (typeof value === 'string') return value.length > 120 || privateText.test(value)
    ? '[REDACTED]' : value;
  return value ?? null;
}

class SafeTraceProcessor {
  name = 'service-booking-safe-trace';
  process(span) {
    // Model prompts and completions can contain customer messages or untrusted reviews.
    if ([SpanType.MODEL_GENERATION, SpanType.MODEL_STEP, SpanType.MODEL_INFERENCE,
      SpanType.MODEL_CHUNK, SpanType.AGENT_RUN].includes(span.type)) {
      span.input = { redacted: true };
      span.output = { redacted: true };
    } else {
      span.input = sanitizeTrace(span.input);
      span.output = sanitizeTrace(span.output);
    }
    span.attributes = sanitizeTrace(span.attributes);
    span.metadata = sanitizeTrace(span.metadata);
    span.requestContext = undefined;
    return span;
  }
}

const mastra = enabled ? new Mastra({
  storage: new LibSQLStore({ id: 'service-booking-trace-store',
    url: 'file:./.mastra-tracing.db' }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'service-booking-agent',
        sampling: { type: 'always' },
        exporters: [new LangSmithExporter({
          apiKey: process.env.LANGSMITH_API_KEY,
          apiUrl: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
          projectName: process.env.LANGCHAIN_PROJECT || 'service-booking-agent',
        })],
        spanOutputProcessors: [new SafeTraceProcessor(), new SensitiveDataFilter()],
      },
    },
  }),
  telemetry: { enabled: false },
}) : null;

const noop = {
  context: undefined,
  register() {},
  event() {},
  async call(_name, _args, run) { return run(); },
  end() {},
  error() {},
  async close() {},
};

export function createAgentTrace({ mode = 'chat' } = {}) {
  if (!mastra) return noop;
  const instance = mastra.observability.getDefaultInstance();
  const root = instance.startSpan({
    type: SpanType.GENERIC,
    name: 'customer_chat_run',
    input: { mode },
    metadata: { environment: process.env.LANGSMITH_AGENT_ENVIRONMENT || 'local' },
  });
  const registered = [];
  let finished = false;
  return {
    context: { currentSpan: root },
    register(agent) {
      if (!agent || typeof agent.__registerMastra !== 'function') return;
      const key = `run-${randomUUID()}`;
      mastra.addAgent(agent, key);
      registered.push(key);
    },
    event(name, details = {}) {
      root.createEventSpan({ type: SpanType.GENERIC, name,
        input: sanitizeTrace(details), isEvent: true });
    },
    async call(name, args, run) {
      const span = root.createChildSpan({ type: SpanType.MCP_TOOL_CALL,
        name, input: sanitizeTrace(args) });
      try {
        const result = await run();
        span.end({ output: sanitizeTrace(result) });
        return result;
      } catch (error) {
        span.error({ error: new Error(error?.code || error?.name || 'tool_error') });
        throw error;
      }
    },
    end(details = {}) {
      if (finished) return;
      finished = true;
      root.end({ output: sanitizeTrace(details) });
    },
    error(error) {
      if (finished) return;
      finished = true;
      root.error({ error: new Error(error?.code || error?.name || 'run_error') });
    },
    async close() {
      if (!finished) root.end({ output: { status: 'interrupted' } });
      for (const key of registered) mastra.removeAgent(key);
      await mastra.observability.flush();
    },
  };
}

export const langsmithTracingEnabled = enabled;
