import { ModelProvider, ChatOptions, ChatResponse, StreamChunk, EmbeddingOptions, EmbeddingResponse, ModelInfo, ProviderConfig } from './model-provider.js';
import { ProviderError } from '@core/errors.js';
import { ResultOrError, ok, err } from '@core/types.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  user?: string;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}

interface OpenAIEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{ object: string; embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  readonly models: ModelInfo[] = [
    { id: 'gpt-4-turbo-preview', name: 'GPT-4 Turbo', provider: 'openai', capabilities: ['chat', 'function_calling', 'json_mode', 'vision'], contextWindow: 128000, maxOutputTokens: 4096, pricing: { inputPer1k: 0.01, outputPer1k: 0.03 } },
    { id: 'gpt-4', name: 'GPT-4', provider: 'openai', capabilities: ['chat', 'function_calling', 'json_mode'], contextWindow: 8192, maxOutputTokens: 4096, pricing: { inputPer1k: 0.03, outputPer1k: 0.06 } },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', capabilities: ['chat', 'function_calling', 'json_mode'], contextWindow: 16385, maxOutputTokens: 4096, pricing: { inputPer1k: 0.0005, outputPer1k: 0.0015 } },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', provider: 'openai', capabilities: ['embedding'], contextWindow: 8191, maxOutputTokens: 0, pricing: { inputPer1k: 0.00013, outputPer1k: 0 } },
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', provider: 'openai', capabilities: ['embedding'], contextWindow: 8191, maxOutputTokens: 0, pricing: { inputPer1k: 0.00002, outputPer1k: 0 } }
  ];

  private config: ProviderConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey ?? process.env['OPENAI_API_KEY']}`,
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

  private toOpenAIMessages(messages: ChatOptions['messages']): OpenAIMessage[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      name: m.name,
      tool_call_id: m.toolCallId,
      tool_calls: m.toolCalls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: tc.function
      }))
    }));
  }

  async chat(options: ChatOptions): Promise<ResultOrError<ChatResponse>> {
    const request: OpenAIChatRequest = {
      model: options.model,
      messages: this.toOpenAIMessages(options.messages),
      tools: options.tools,
      tool_choice: options.toolChoice,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stop: options.stop,
      stream: false,
      response_format: options.responseFormat,
      seed: options.seed,
      user: options.user
    };

    const result = await this.request<OpenAIChatResponse>('/chat/completions', request);
    if (!result.ok) return result;

    const data = result.value;
    return ok({
      id: data.id,
      model: data.model,
      choices: data.choices.map((c, i) => ({
        index: i,
        message: {
          role: c.message.role,
          content: c.message.content ?? '',
          name: c.message.name,
          toolCallId: c.message.tool_call_id,
          toolCalls: c.message.tool_calls?.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: tc.function
          }))
        },
        finishReason: c.finish_reason as ChatResponse['choices'][0]['finishReason']
      })),
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined,
      created: data.created,
      systemFingerprint: data.system_fingerprint
    });
  }

  async *streamChat(options: ChatOptions): AsyncIterable<ResultOrError<StreamChunk>> {
    const request: OpenAIChatRequest = {
      model: options.model,
      messages: this.toOpenAIMessages(options.messages),
      tools: options.tools,
      tool_choice: options.toolChoice,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stop: options.stop,
      stream: true,
      response_format: options.responseFormat,
      seed: options.seed,
      user: options.user
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
            if (data === '[DONE]') return;

            try {
              const chunk = JSON.parse(data) as OpenAIChatResponse;
              if (chunk.choices.length > 0) {
                const choice = chunk.choices[0];
                yield ok({
                  id: chunk.id,
                  model: chunk.model,
                  choices: [{
                    index: choice.index,
                    delta: {
                      role: choice.message.role,
                      content: choice.message.content ?? '',
                      name: choice.message.name,
                      toolCallId: choice.message.tool_call_id,
                      toolCalls: choice.message.tool_calls?.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: tc.function
                      }))
                    },
                    finishReason: choice.finish_reason as StreamChunk['choices'][0]['finishReason']
                  }],
                  created: chunk.created,
                  systemFingerprint: chunk.system_fingerprint
                });
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } catch (e) {
      yield err(new ProviderError(e instanceof Error ? e.message : 'Stream error', this.name, e instanceof Error ? e : undefined));
    }
  }

  async embed(options: EmbeddingOptions): Promise<ResultOrError<EmbeddingResponse>> {
    const request: OpenAIEmbeddingRequest = {
      model: options.model,
      input: options.input,
      encoding_format: options.encodingFormat,
      dimensions: options.dimensions,
      user: options.user
    };

    const result = await this.request<OpenAIEmbeddingResponse>('/embeddings', request);
    if (!result.ok) return result;

    const data = result.value;
    return ok({
      object: 'list',
      data: data.data.map((d, i) => ({ object: 'embedding', embedding: d.embedding, index: i })),
      model: data.model,
      usage: { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens }
    });
  }

  async countTokens(_model: string, text: string): Promise<ResultOrError<number>> {
    // Simple approximation: ~4 chars per token
    return ok(Math.ceil(text.length / 4));
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}