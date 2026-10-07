import { Tool, ToolPermission, ToolCall, ToolCallResult, createTool } from './tool.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { ToolError } from '@core/errors.js';
import * as z from 'zod';

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private permissionGrants = new Set<ToolPermission>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new ToolError(`Tool already registered: ${tool.name}`, tool.name);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  hasPermission(permission: ToolPermission): boolean {
    return this.permissionGrants.has(permission);
  }

  grantPermission(permission: ToolPermission): void {
    this.permissionGrants.add(permission);
  }

  revokePermission(permission: ToolPermission): void {
    this.permissionGrants.delete(permission);
  }

  grantAll(tool: Tool): void {
    for (const perm of tool.permissions) {
      this.grantPermission(perm);
    }
  }

  async execute(call: ToolCall): Promise<ToolCallResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { callId: call.id, success: false, error: `Tool not found: ${call.name}` };
    }

    for (const perm of tool.permissions) {
      if (!this.hasPermission(perm)) {
        return { callId: call.id, success: false, error: `Permission denied: ${perm}` };
      }
    }

    try {
      const timeout = tool.timeout ?? 30000;
      const result = await Promise.race([
        tool.execute(call.input as any),
        new Promise<ResultOrError<never>>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout)
        )
      ]);

      if (!result.ok) {
        const errResult = result as { ok: false; error: Error | string };
        return { callId: call.id, success: false, error: errResult.error instanceof Error ? errResult.error.message : String(errResult.error) };
      }

      return { callId: call.id, success: true, output: result.value };
    } catch (e) {
      return { callId: call.id, success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async executeBatch(calls: ToolCall[]): Promise<ToolCallResult[]> {
    return Promise.all(calls.map(call => this.execute(call)));
  }

  getToolSchemas(): Record<string, { name: string; description: string; parameters: Record<string, unknown> }> {
    const schemas: Record<string, { name: string; description: string; parameters: Record<string, unknown> }> = {};
    for (const tool of this.tools.values()) {
      schemas[tool.name] = {
        name: tool.name,
        description: tool.description,
        parameters: this.jsonSchemaFromZod(tool.inputSchema)
      };
    }
    return schemas;
  }

  private jsonSchemaFromZod(schema: z.ZodSchema): Record<string, unknown> {
    try {
      return schema instanceof z.ZodObject ? JSON.parse(JSON.stringify(schema.shape)) : {};
    } catch {
      return {};
    }
  }
}

export const toolRegistry = new ToolRegistry();