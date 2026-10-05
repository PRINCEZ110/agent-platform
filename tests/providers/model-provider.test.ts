import { describe, it, expect } from 'vitest';
import {
  MessageRoleSchema,
  MessageSchema,
  ToolSchema,
  ChatOptionsSchema,
  ChatResponseSchema,
  StreamChunkSchema,
  EmbeddingOptionsSchema,
  EmbeddingResponseSchema,
  ModelInfoSchema
} from '../../src/providers/model-provider.js';

describe('MessageRoleSchema', () => {
  it('accepts the four roles', () => {
    for (const role of ['system', 'user', 'assistant', 'tool']) {
      expect(MessageRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('rejects unknown roles', () => {
    expect(MessageRoleSchema.safeParse('developer').success).toBe(false);
    expect(MessageRoleSchema.safeParse('TOOLS').success).toBe(false);
  });
});

describe('MessageSchema', () => {
  it('accepts a minimal message', () => {
    const result = MessageSchema.safeParse({ role: 'user', content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts optional name, toolCallId, and toolCalls', () => {
    const result = MessageSchema.safeParse({
      role: 'tool',
      content: 'result',
      name: 'fs.read',
      toolCallId: 'call-1',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'fs.read', arguments: '{"path":"a.txt"}' }
        }
      ]
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid roles, non-string content, and malformed tool calls', () => {
    expect(MessageSchema.safeParse({ role: 'narrator', content: 'x' }).success).toBe(false);
    expect(MessageSchema.safeParse({ role: 'user', content: 42 }).success).toBe(false);
    expect(
      MessageSchema.safeParse({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c', type: 'tool', function: { name: 'x', arguments: '{}' } }]
      }).success
    ).toBe(false);
  });
});

describe('ToolSchema', () => {
  it('accepts a function tool definition', () => {
    const result = ToolSchema.safeParse({
      type: 'function',
      function: {
        name: 'fs.read',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} }
      }
    });
    expect(result.success).toBe(true);
  });

  it('rejects wrong type literals and missing fields', () => {
    expect(ToolSchema.safeParse({ type: 'prompt', function: { name: 'x', description: '', parameters: {} } }).success).toBe(false);
    expect(ToolSchema.safeParse({ type: 'function', function: { name: 'x', description: '' } }).success).toBe(false);
  });
});

describe('ChatOptionsSchema', () => {
  const base = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };

  it('accepts minimal options', () => {
    expect(ChatOptionsSchema.safeParse(base).success).toBe(true);
  });

  it('enforces numeric ranges', () => {
    expect(ChatOptionsSchema.safeParse({ ...base, temperature: 0 }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, temperature: 2 }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, temperature: 2.5 }).success).toBe(false);
    expect(ChatOptionsSchema.safeParse({ ...base, temperature: -1 }).success).toBe(false);
    expect(ChatOptionsSchema.safeParse({ ...base, topP: 0.5 }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, topP: 1.1 }).success).toBe(false);
    expect(ChatOptionsSchema.safeParse({ ...base, maxTokens: 0 }).success).toBe(false);
    expect(ChatOptionsSchema.safeParse({ ...base, frequencyPenalty: -2 }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, presencePenalty: 2.1 }).success).toBe(false);
  });

  it('accepts all toolChoice variants', () => {
    expect(ChatOptionsSchema.safeParse({ ...base, toolChoice: 'auto' }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, toolChoice: 'none' }).success).toBe(true);
    expect(
      ChatOptionsSchema.safeParse({
        ...base,
        toolChoice: { type: 'function', function: { name: 'fs.read' } }
      }).success
    ).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, toolChoice: 'sometimes' }).success).toBe(false);
  });

  it('accepts stop strings/arrays, stream flag, responseFormat, seed, and user', () => {
    expect(ChatOptionsSchema.safeParse({ ...base, stop: 'END' }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, stop: ['END', 'STOP'] }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, stream: true }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, responseFormat: { type: 'json_object' } }).success).toBe(true);
    expect(ChatOptionsSchema.safeParse({ ...base, responseFormat: { type: 'xml' } }).success).toBe(false);
    expect(ChatOptionsSchema.safeParse({ ...base, seed: 42, user: 'agent_b' }).success).toBe(true);
  });

  it('requires model and messages', () => {
    expect(ChatOptionsSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(ChatOptionsSchema.safeParse({ model: 'gpt' }).success).toBe(false);
  });
});

describe('ChatResponseSchema', () => {
  const base = {
    id: 'resp-1',
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finishReason: 'stop' }],
    usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 }
  };

  it('accepts a full response with usage', () => {
    expect(ChatResponseSchema.safeParse(base).success).toBe(true);
  });

  it('accepts responses without usage and with optional created/fingerprint', () => {
    const { usage: _usage, ...withoutUsage } = base;
    expect(
      ChatResponseSchema.safeParse({ ...withoutUsage, created: 1728000000, systemFingerprint: 'fp' }).success
    ).toBe(true);
  });

  it('rejects invalid finish reasons', () => {
    const bad = { ...base, choices: [{ ...base.choices[0], finishReason: 'canceled' }] };
    expect(ChatResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('StreamChunkSchema', () => {
  it('accepts delta chunks with nullable finishReason', () => {
    const chunk = {
      id: 'chunk-1',
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { content: 'tok' }, finishReason: null }],
      created: 1728000000
    };
    expect(StreamChunkSchema.safeParse(chunk).success).toBe(true);

    const done = { ...chunk, choices: [{ index: 0, delta: {}, finishReason: 'stop' }] };
    expect(StreamChunkSchema.safeParse(done).success).toBe(true);
  });

  it('rejects invalid finishReason values and missing created', () => {
    const bad = {
      id: 'c',
      model: 'm',
      choices: [{ index: 0, delta: {}, finishReason: 'done' }],
      created: 1
    };
    expect(StreamChunkSchema.safeParse(bad).success).toBe(false);
    const { created: _created, ...noCreated } = bad;
    expect(StreamChunkSchema.safeParse(noCreated).success).toBe(false);
  });
});

describe('Embedding schemas', () => {
  it('EmbeddingOptions accepts string and array inputs with options', () => {
    expect(EmbeddingOptionsSchema.safeParse({ model: 'text-embedding-3', input: 'hello' }).success).toBe(true);
    expect(EmbeddingOptionsSchema.safeParse({ model: 'text-embedding-3', input: ['a', 'b'] }).success).toBe(true);
    expect(
      EmbeddingOptionsSchema.safeParse({
        model: 'text-embedding-3',
        input: 'x',
        encodingFormat: 'base64',
        dimensions: 1536,
        user: 'u'
      }).success
    ).toBe(true);
    expect(EmbeddingOptionsSchema.safeParse({ model: 'm', input: 'x', dimensions: 0 }).success).toBe(false);
    expect(EmbeddingOptionsSchema.safeParse({ model: 'm', input: 'x', encodingFormat: 'gzip' }).success).toBe(false);
  });

  it('EmbeddingResponse validates the list shape', () => {
    const response = {
      object: 'list',
      data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
      model: 'text-embedding-3',
      usage: { promptTokens: 2, totalTokens: 2 }
    };
    expect(EmbeddingResponseSchema.safeParse(response).success).toBe(true);
    expect(EmbeddingResponseSchema.safeParse({ ...response, object: 'set' }).success).toBe(false);
    expect(EmbeddingResponseSchema.safeParse({ ...response, data: [{ object: 'vector', embedding: [], index: 0 }] }).success).toBe(false);
  });
});

describe('ModelInfoSchema', () => {
  it('accepts a full model description', () => {
    const info = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      capabilities: ['chat', 'vision', 'function_calling', 'json_mode'],
      contextWindow: 128000,
      maxOutputTokens: 4096,
      pricing: { inputPer1k: 0.005, outputPer1k: 0.015 }
    };
    expect(ModelInfoSchema.safeParse(info).success).toBe(true);
  });

  it('pricing is optional and capability enums are enforced', () => {
    const { pricing: _pricing, ...withoutPricing } = {
      id: 'm',
      name: 'M',
      provider: 'p',
      capabilities: ['chat', 'embedding'],
      contextWindow: 8000,
      maxOutputTokens: 1000
    };
    expect(ModelInfoSchema.safeParse(withoutPricing).success).toBe(true);
    expect(ModelInfoSchema.safeParse({ ...withoutPricing, capabilities: ['telepathy'] }).success).toBe(false);
  });
});
