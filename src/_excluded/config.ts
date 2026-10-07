import { z } from 'zod';
import { ProviderConfig, ModelInfo } from './model-provider.js';
import { readFile } from 'fs/promises';

export const ProviderConfigsSchema = z.record(z.string(), z.object({
  name: z.string(),
  type: z.enum(['openai', 'anthropic', 'azure', 'local']),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  organization: z.string().optional(),
  defaultModel: z.string().optional(),
  timeout: z.number().positive().optional(),
  maxRetries: z.number().nonnegative().optional(),
  extraHeaders: z.record(z.string()).optional(),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    capabilities: z.array(z.enum(['chat', 'embedding', 'vision', 'function_calling', 'json_mode'])),
    contextWindow: z.number(),
    maxOutputTokens: z.number(),
    pricing: z.object({
      inputPer1k: z.number(),
      outputPer1k: z.number()
    }).optional()
  })).optional()
}));

export type ProviderConfigs = z.infer<typeof ProviderConfigsSchema>;

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfigs = {
  openai: {
    name: 'openai',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4-turbo-preview',
    timeout: 60000,
    maxRetries: 3
  },
  anthropic: {
    name: 'anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-opus-20240229',
    timeout: 60000,
    maxRetries: 3
  },
  azure: {
    name: 'azure',
    type: 'azure',
    defaultModel: 'gpt-4',
    timeout: 60000,
    maxRetries: 3
  },
  local: {
    name: 'local',
    type: 'local',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama2',
    timeout: 120000,
    maxRetries: 1
  }
};

export async function loadProviderConfigs(configPath?: string): Promise<ProviderConfigs> {
  const configs = { ...DEFAULT_PROVIDER_CONFIGS };

  if (configPath) {
    try {
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      const validated = ProviderConfigsSchema.parse(parsed);
      Object.assign(configs, validated);
    } catch {
      // Use defaults if config file missing or invalid
    }
  }

  // Override with environment variables
  for (const [key, config] of Object.entries(configs)) {
    const envPrefix = key.toUpperCase();
    if (process.env[`${envPrefix}_API_KEY`]) config.apiKey = process.env[`${envPrefix}_API_KEY`]!;
    if (process.env[`${envPrefix}_BASE_URL`]) config.baseUrl = process.env[`${envPrefix}_BASE_URL`]!;
    if (process.env[`${envPrefix}_DEFAULT_MODEL`]) config.defaultModel = process.env[`${envPrefix}_DEFAULT_MODEL`]!;
  }

  return configs;
}