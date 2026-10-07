import { OpenAIProvider } from './openai-provider.js';
import { ProviderConfig } from './config.js';

export class AzureProvider extends OpenAIProvider {
  readonly name = 'azure';

  constructor(config: ProviderConfig) {
    const azureConfig = {
      ...config,
      baseUrl: config.baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'],
      apiKey: config.apiKey ?? process.env['AZURE_OPENAI_API_KEY'],
      extraHeaders: {
        'api-key': config.apiKey ?? process.env['AZURE_OPENAI_API_KEY'] ?? '',
        ...config.extraHeaders
      }
    };
    super(azureConfig);
  }

  override readonly models = [
    { id: 'gpt-4', name: 'GPT-4 (Azure)', provider: 'azure', capabilities: ['chat', 'function_calling', 'json_mode'] as const, contextWindow: 8192, maxOutputTokens: 4096 },
    { id: 'gpt-35-turbo', name: 'GPT-3.5 Turbo (Azure)', provider: 'azure', capabilities: ['chat', 'function_calling', 'json_mode'] as const, contextWindow: 16385, maxOutputTokens: 4096 },
    { id: 'text-embedding-ada-002', name: 'Ada Embedding (Azure)', provider: 'azure', capabilities: ['embedding'] as const, contextWindow: 8191, maxOutputTokens: 0 }
  ];
}