import { readFileSync } from 'node:fs';
import { Agent } from '@mastra/core/agent';
import { config } from '../config.js';

const instructions = readFileSync(new URL('../prompts/errandAgent.md', import.meta.url), 'utf8');
const allowedTools = new Set([
  'searchProviders', 'getProvider', 'listBookings',
  'prepareBooking', 'prepareCancellation', 'prepareReschedule',
]);
const providerApiKeyVariables = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

export function resolveConfiguredModel({
  provider = config.llm.provider,
  name = config.llm.name,
  apiKey = config.llm.apiKey,
} = {}) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const modelName = typeof name === 'string' ? name.trim() : '';
  const apiKeyValue = typeof apiKey === 'string' ? apiKey.trim() : '';
  const providerApiKeyVariable = providerApiKeyVariables[normalizedProvider];
  if (!providerApiKeyVariable) {
    throw new Error('LLM_PROVIDER must be anthropic, openai, or google');
  }
  if (!modelName) throw new Error('LLM_NAME is required');
  if (!apiKeyValue) throw new Error('LLM_API_KEY is required');

  // Mastra's provider/model router reads the provider's standard key variable.
  process.env[providerApiKeyVariable] = apiKeyValue;
  return `${normalizedProvider}/${modelName}`;
}

export function createErrandAgent({ tools = {}, ...llm } = {}) {
  const unexpected = Object.keys(tools).filter((name) => !allowedTools.has(name));
  if (unexpected.length) throw new Error(`Errand agent cannot receive raw write tools: ${unexpected.join(', ')}`);
  return new Agent({
    id: 'errand-agent',
    name: 'Home Service Errand Agent',
    instructions,
    model: resolveConfiguredModel(llm),
    tools,
  });
}
