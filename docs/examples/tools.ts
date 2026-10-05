import { z } from 'zod';
import { createTool } from '@tools/tool.js';
import { ToolRegistry } from '@tools/registry.js';

const shoutTool = createTool(
  'shout',
  'Uppercase the input text',
  z.object({ text: z.string().max(200) }),
  [],
  async ({ text }) => ({
    ok: true as const,
    value: { success: true as const, output: text.toUpperCase() },
  }),
  { timeout: 5_000 }
);

const guardedTool = createTool(
  'danger-zone',
  'Requires the fs.write permission to execute',
  z.object({ target: z.string() }),
  ['fs.write'],
  async ({ target }) => ({
    ok: true as const,
    value: { success: true as const, output: `would write ${target}` },
  }),
  { timeout: 5_000 }
);

async function main(): Promise<void> {
  const registry = new ToolRegistry();
  registry.register(shoutTool);
  registry.register(guardedTool);

  console.log('registered tools:', registry.getNames().join(', '));

  const schemas = registry.getToolSchemas();
  console.log('LLM tool schema for "shout":', JSON.stringify(schemas['shout']?.parameters));

  const okResult = await registry.execute({ id: '1', name: 'shout', input: { text: 'hello agents' } });
  console.log('shout ->', okResult);

  const invalid = await registry.execute({ id: '2', name: 'shout', input: { text: 42 } });
  console.log('invalid input ->', invalid);

  const denied = await registry.execute({ id: '3', name: 'danger-zone', input: { target: 'x.txt' } });
  console.log('without permission ->', denied);

  registry.grantPermission('fs.write');
  const allowed = await registry.execute({ id: '4', name: 'danger-zone', input: { target: 'x.txt' } });
  console.log('with permission    ->', allowed);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
