import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string()
    })
  })).optional()
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown())
  })
});
export type Tool = z.infer<typeof ToolSchema>;

export const ChatOptionsSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  tools: z.array(ToolSchema).optional(),
  toolChoice: z.union([z.literal('auto'), z.literal('none'), z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) })]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  stream: z.boolean().optional(),
  responseFormat: z.object({ type: z.enum(['text', 'json_object']) }).optional(),
  seed: z.number().optional(),
  user: z.string().optional()
});
export type ChatOptions = z.infer<typeof ChatOptionsSchema>;

export const ChatResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    message: MessageSchema,
    finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])
  })),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number()
  }).optional(),
  created: z.number().optional(),
  systemFingerprint: z.string().optional()
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const StreamChunkSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({
    index: z.number(),
    delta: MessageSchema.partial(),
    finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call']).nullable()
  })),
  created: z.number(),
  systemFingerprint: z.string().optional()
});
export type StreamChunk = z.infer<typeof StreamChunkSchema>;

export const EmbeddingOptionsSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string())]),
  encodingFormat: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().positive().optional(),
  user: z.string().optional()
});
export type EmbeddingOptions = z.infer<typeof EmbeddingOptionsSchema>;

export const EmbeddingResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.object({
    object: z.literal('embedding'),
    embedding: z.array(z.number()),
    index: z.number()
  })),
  model: z.string(),
  usage: z.object({
    promptTokens: z.number(),
    totalTokens: z.number()
  })
});
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  capabilities: z.array(z.enum(['chat', 'embedding', 'vision', 'function_calling', 'json_mode'])),
  contextWindow: z.number(),
  maxOutputTokens: z.number(),
  pricing: z.object({
    inputPer1k: z.number(),
    outputPer1k: z.number()
  }).optional()
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export interface ModelProvider {
  readonly name: string;
  readonly models: ModelInfo[];

  chat(options: ChatOptions): Promise<ResultOrError<ChatResponse>>;
  streamChat(options: ChatOptions): AsyncIterable<ResultOrError<StreamChunk>>;
  embed(options: EmbeddingOptions): Promise<ResultOrError<EmbeddingResponse>>;
  countTokens(model: string, text: string): Promise<ResultOrError<number>>;
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<boolean>;
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  extraHeaders?: Record<string, string>;
}