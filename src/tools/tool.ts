import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';

export const ToolPermissionSchema = z.enum([
  'fs.read',
  'fs.write',
  'fs.delete',
  'fs.execute',
  'terminal.exec',
  'terminal.read',
  'git.read',
  'git.write',
  'git.push',
  'network.http',
  'network.websocket',
  'process.spawn'
]);
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

export const ToolResultSchema = z.object({
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export interface Tool<TInput = Record<string, unknown>, TOutput = ToolResult> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<TInput>;
  readonly permissions: ToolPermission[];
  readonly timeout?: number;

  execute(input: TInput): Promise<ResultOrError<TOutput>>;
  validate(input: unknown): ResultOrError<TInput>;
}

export function createTool<TInput, TOutput>(
  name: string,
  description: string,
  inputSchema: z.ZodSchema<TInput>,
  permissions: ToolPermission[],
  execute: (input: TInput) => Promise<ResultOrError<TOutput>>,
  options?: { timeout?: number }
): Tool<TInput, TOutput> {
  return {
    name,
    description,
    inputSchema,
    permissions,
    timeout: options?.timeout,
    async execute(input) {
      const validated = this.validate(input);
      if (!validated.ok) return validated;
      return execute(validated.value);
    },
    validate(input) {
      const result = inputSchema.safeParse(input);
      if (!result.success) {
        return err(new Error(`Invalid input for ${name}: ${result.error.message}`));
      }
      return ok(result.data);
    }
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallResult {
  callId: string;
  success: boolean;
  output?: unknown;
  error?: string;
}