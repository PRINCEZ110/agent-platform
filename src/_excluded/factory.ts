import { ProviderConfig, ProviderConfigs, loadProviderConfigs, DEFAULT_PROVIDER_CONFIGS } from './config.js';
import { ModelProvider, ModelInfo } from './model-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { AzureProvider } from './azure-provider.js';
import { LocalProvider } from './local-provider.js';
import { ProviderError } from '@core/errors.js';
import { ResultOrError, ok, err } from '@core/types.js';

export class ProviderFactory {
  private providers = new Map<string, ModelProvider>();
  private configs: ProviderConfigs;
  private initialized = false;

  constructor(configs?: ProviderConfigs) {
    this.configs = configs ?? DEFAULT_PROVIDER_CONFIGS;
  }

  async initialize(configPath?: string): Promise<void> {
    if (this.initialized) return;
    this.configs = await loadProviderConfigs(configPath);
    this.initialized = true;
  }

  getProvider(name: string): ModelProvider {
    const cached = this.providers.get(name);
    if (cached) return cached;

    const config = this.configs[name];
    if (!config) {
      throw new ProviderError(`Provider not configured: ${name}`, name);
    }

    const provider = this.createProvider(config);
    this.providers.set(name, provider);
    return provider;
  }

  private createProvider(config: ProviderConfig): ModelProvider {
    switch (config.type) {
      case 'openai':
        return new OpenAIProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'azure':
        return new AzureProvider(config);
      case 'local':
        return new LocalProvider(config);
      default:
        throw new ProviderError(`Unknown provider type: ${config.type}`, config.name);
    }
  }

  async getProviderForModel(modelId: string): Promise<ModelProvider> {
    for (const [name, config] of Object.entries(this.configs)) {
      const provider = this.getProvider(name);
      const models = await provider.listModels();
      if (models.some(m => m.id === modelId)) {
        return provider;
      }
    }
    throw new ProviderError(`No provider found for model: ${modelId}`, 'unknown');
  }

  async listAllModels(): Promise<ModelInfo[]> {
    const allModels: ModelInfo[] = [];
    for (const name of Object.keys(this.configs)) {
      try {
        const provider = this.getProvider(name);
        const models = await provider.listModels();
        allModels.push(...models);
      } catch {
        // Skip failed providers
      }
    }
    return allModels;
  }

  getConfiguredProviders(): string[] {
    return Object.keys(this.configs);
  }

  clearCache(): void {
    this.providers.clear();
  }
}

export const providerFactory = new ProviderFactory();