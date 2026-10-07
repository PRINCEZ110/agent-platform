import { ModelProvider, ChatOptions, ChatResponse, StreamChunk, EmbeddingOptions, EmbeddingResponse, ModelInfo, ProviderConfig } from './model-provider.js';
import { ProviderError } from '@core/errors.js';
import { ResultOrError, ok, err } from '@core/types.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string }>;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'tool'; name?: string };
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly models: ModelInfo[] = [
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', capabilities: ['chat', 'function_calling', 'vision'], contextWindow: 200000, maxOutputTokens: 4096, pricing: { inputPer1k: 0.015, outputPer1k: 0.075 } },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic', capabilities: ['chat', 'function_calling', 'vision'], contextWindow: 200000, maxOutputTokens: 4096, pricing: { inputPer1k: 0.003, outputPer1k: 0.015 } },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic', capabilities: ['chat', 'function_calling', 'vision'], contextWindow: 200000, maxOutputTokens: 4096, pricing: { inputPer1k: 0.00025, outputPer1k: 0.00125 } }
  ];

  private config: ProviderConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      ...config.extraHeaders
    };
  }

  private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<ResultOrError<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout ?? 60000)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        return err(new ProviderError(error.message ?? `HTTP ${response.status}`, this.name));
      }

      return ok(await response.json() as T);
    } catch (e) {
      return err(new ProviderError(e instanceof Error ? e.message : 'Unknown error', this.name, e instanceof Error ? e : undefined));
    }
  }

  private toAnthropicMessages(messages: ChatOptions['messages']): { system?: string; messages: AnthropicMessage[] } {
    const system = messages.find(m => m.role === 'system')?.content;
    const msgs = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user' as 'user' | 'assistant',
        content: m.content
      }));
    return { system, messages: msgs };
  }

  async chat(options: ChatOptions): Promise<ResultOrError<ChatResponse>> {
    const { system, messages } = this.toAnthropicMessages(options.messages);
    const request: AnthropicRequest = {
      model: options.model,
      messages,
      system,
      tools: options.tools?.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Record<string, unknown>
      })),
      tool_choice: options.toolChoice === 'auto' ? { type: 'auto' } : options.toolChoice && 'function' in options.toolChoice ? { type: 'tool' as const, name: options.toolChoice.function.name } : undefined,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stop ? (Array.isArray(options.stop) ? options.stop : [options.stop]) : undefined,
      stream: false
    };

    const result = await this.request<AnthropicResponse>('/v1/messages', request);
    if (!result.ok) return result;

    const data = result.value;
    const toolCalls = data.content
      .filter(c => c.type === 'tool_use')
      .map(c => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input) } }));

    return ok({
      id: data.id,
      model: data.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: data.content.filter(c => c.type === 'text').map(c => c.text).join(''),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : data.stop_reason === 'max_tokens' ? 'length' : 'stop'
      }],
      usage: { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens, totalTokens: data.usage.input_tokens + data.usage.output_tokens }
    });
  }

  async *streamChat(options: ChatOptions): AsyncIterable<ResultOrError<StreamChunk>> {
    const { system, messages } = this.toAnthropicMessages(options.messages);
    const request: AnthropicRequest = {
      model: options.model,
      messages,
      system,
      tools: options.tools?.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Record<string, unknown>
      })),
      tool_choice: options.toolChoice === 'auto' ? { type: 'auto' } : options.toolChoice && 'function' in options.toolChoice ? { type: 'tool' as const, name: options.toolChoice.function.name } : undefined,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stop ? (Array.isArray(options.stop) ? options.stop : [options.stop]) : undefined,
      stream: true
    };

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.timeout ?? 60000)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        yield err(new ProviderError(error.message ?? `HTTP ${response.status}`, this.name));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield err(new ProviderError('No response body', this.name));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                yield ok({
                  id: event.message_id ?? '',
                  model: options.model,
                  choices: [{ index: 0, delta: { role: 'assistant', content: event.delta.text }, finishReason: null }],
                  created: Date.now()
                });
              } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
                yield ok({
                  id: event.message_id ?? '',
                  model: options.model,
                  choices: [{ index: 0, delta: {}, finishReason: event.delta.stop_reason === 'tool_use' ? 'tool_calls' : event.delta.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
                  created: Date.now()
                });
              }
            } catch {
              // Skip malformed
            }
          }
        }
      }
    } catch (e) {
      yield err(new ProviderError(e instanceof Error ? e.message : 'Stream error', this.name, e instanceof Error ? e : undefined));
    }
  }

  async embed(_options: EmbeddingOptions): Promise<ResultOrError<EmbeddingResponse>> {
    return err(new ProviderError('Embeddings not supported by Anthropic', this.name));
  }

  async countTokens(model: string, text: string): Promise<ResultOrError<number>> {
    return ok(Math.ceil(text.length / 4));
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}