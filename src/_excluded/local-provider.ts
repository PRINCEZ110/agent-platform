import { OpenAIProvider } from './openai-provider.js';
import { ProviderConfig } from './config.js';

export class LocalProvider extends OpenAIProvider {
  readonly name = 'local';

  constructor(config: ProviderConfig) {
    const localConfig = {
      ...config,
      baseUrl: config.baseUrl ?? 'http://localhost:11434/v1',
      apiKey: config.apiKey ?? 'ollama',
      extraHeaders: {
        ...config.extraHeaders
      }
    };
    super(localConfig);
  }

  override readonly models = [
    { id: 'llama2', name: 'Llama 2', provider: 'local', capabilities: ['chat'] as const, contextWindow: 4096, maxOutputTokens: 2048 },
    { id: 'codellama', name: 'Code Llama', provider: 'local', capabilities: ['chat'] as const, contextWindow: 16384, maxOutputTokens: 4096 },
    { id: 'mistral', name: 'Mistral', provider: 'local', capabilities: ['chat'] as const, contextWindow: 8192, maxOutputTokens: 4096 }
  ];
}