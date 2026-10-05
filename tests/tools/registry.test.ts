import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createTool, Tool } from '../../src/tools/tool.js';
import { ok, err } from '../../src/core/types.js';

const echoTool = (): Tool<{ text: string }, { success: boolean; output?: unknown }> =>
  createTool(
    'echo',
    'Echoes the input text',
    z.object({ text: z.string() }),
    ['fs.read'],
    async input => ok({ success: true, output: input.text })
  );

const failingTool = (): Tool<Record<string, never>, never> =>
  createTool(
    'broken',
    'Always fails',
    z.object({}),
    ['fs.read'],
    async () => err(new Error('tool exploded'))
  );

const hangingTool = (): Tool<Record<string, never>, never> =>
  createTool(
    'hanger',
    'Never resolves',
    z.object({}),
    ['fs.read'],
    () => new Promise(() => undefined),
    { timeout: 50 }
  );

let registry: ToolRegistry;

beforeEach(() => {
  registry = new ToolRegistry();
});

describe('ToolRegistry registration', () => {
  it('registers and retrieves a tool', () => {
    registry.register(echoTool());
    expect(registry.get('echo')).toBeDefined();
    expect(registry.getNames()).toEqual(['echo']);
    expect(registry.getAll()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    registry.register(echoTool());
    expect(() => registry.register(echoTool())).toThrow('Tool already registered: echo');
  });

  it('unregisters tools and reports whether it existed', () => {
    registry.register(echoTool());
    expect(registry.unregister('echo')).toBe(true);
    expect(registry.unregister('echo')).toBe(false);
    expect(registry.get('echo')).toBeUndefined();
  });

  it('returns undefined for unknown tools', () => {
    expect(registry.get('nope')).toBeUndefined();
  });
});

describe('ToolRegistry permissions', () => {
  it('grants, checks and revokes permissions', () => {
    expect(registry.hasPermission('fs.read')).toBe(false);
    registry.grantPermission('fs.read');
    expect(registry.hasPermission('fs.read')).toBe(true);
    registry.revokePermission('fs.read');
    expect(registry.hasPermission('fs.read')).toBe(false);
  });

  it('grantAll grants every permission a tool requires', () => {
    const tool = createTool(
      'writer',
      'writes',
      z.object({}),
      ['fs.write', 'fs.delete'],
      async () => ok({ success: true })
    );
    registry.grantAll(tool);
    expect(registry.hasPermission('fs.write')).toBe(true);
    expect(registry.hasPermission('fs.delete')).toBe(true);
    expect(registry.hasPermission('git.push')).toBe(false);
  });
});

describe('ToolRegistry.execute', () => {
  it('fails when the tool is not registered', async () => {
    const result = await registry.execute({ id: 'c1', name: 'ghost', input: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool not found: ghost');
    expect(result.callId).toBe('c1');
  });

  it('fails when a required permission is missing', async () => {
    registry.register(echoTool());
    const result = await registry.execute({ id: 'c2', name: 'echo', input: { text: 'hi' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied: fs.read');
  });

  it('executes and returns output when permitted', async () => {
    registry.register(echoTool());
    registry.grantPermission('fs.read');
    const result = await registry.execute({ id: 'c3', name: 'echo', input: { text: 'hello' } });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ success: true, output: 'hello' });
  });

  it('fails validation for malformed input without running the tool', async () => {
    const spy = vi.fn();
    const tool = createTool(
      'spy',
      'spy',
      z.object({ text: z.string() }),
      ['fs.read'],
      async () => {
        spy();
        return ok({ success: true });
      }
    );
    registry.register(tool);
    registry.grantPermission('fs.read');

    const result = await registry.execute({ id: 'c4', name: 'spy', input: { text: 123 } });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input for spy');
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces tool-level error results', async () => {
    registry.register(failingTool());
    registry.grantPermission('fs.read');
    const result = await registry.execute({ id: 'c5', name: 'broken', input: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe('tool exploded');
  });

  it('times out a hanging tool', async () => {
    registry.register(hangingTool());
    registry.grantPermission('fs.read');

    const pending = registry.execute({ id: 'c6', name: 'hanger', input: {} });
    await vi.advanceTimersByTimeAsync(51);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool timeout after 50ms');
  });

  it('runs batches and keeps per-call results independent', async () => {
    registry.register(echoTool());
    registry.grantPermission('fs.read');

    const results = await registry.executeBatch([
      { id: 'b1', name: 'echo', input: { text: 'one' } },
      { id: 'b2', name: 'ghost', input: {} }
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].callId).toBe('b1');
    expect(results[0].success).toBe(true);
    expect(results[1].callId).toBe('b2');
    expect(results[1].success).toBe(false);
  });
});

describe('ToolRegistry.getToolSchemas', () => {
  it('exposes name, description and a parameter object per tool', () => {
    registry.register(echoTool());
    const schemas = registry.getToolSchemas();

    expect(Object.keys(schemas)).toEqual(['echo']);
    expect(schemas.echo.name).toBe('echo');
    expect(schemas.echo.description).toBe('Echoes the input text');
    expect(typeof schemas.echo.parameters).toBe('object');
    expect(schemas.echo.parameters).not.toBeNull();
  });
});
