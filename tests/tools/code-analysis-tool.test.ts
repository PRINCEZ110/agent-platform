import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import { analyzeFileTool, findReferencesTool } from '../../src/tools/code-analysis-tool.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn()
}));

vi.mock('glob', () => ({
  glob: vi.fn()
}));

beforeEach(() => {
  vi.resetAllMocks();
});

const tsFixture = [
  "import { z } from 'zod';",
  "import helper from './helper.js';",
  "import './side-effect.js';",
  '',
  'export default class Widget extends Base {',
  '  render() { return 1; }',
  '  async update(data) { return data; }',
  '}',
  '',
  'export function greet(name, greeting) {',
  '  return name;',
  '}',
  '',
  "export const VERSION = '1.0';"
].join('\n');

const pyFixture = [
  'from os import path',
  'import sys',
  '',
  'async def fetch(url, timeout=5):',
  '    return url',
  '',
  'def plain(a):',
  '    return a',
  '',
  'class Engine(Base):',
  '    def run(self):',
  '        pass'
].join('\n');

describe('analyzeFileTool on TypeScript', () => {
  it('extracts imports, exports, functions, classes, and complexity', async () => {
    vi.mocked(readFile).mockResolvedValue(tsFixture as never);

    const result = await analyzeFileTool.execute({ path: 'src/widget.ts' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analysis = result.value.analysis;

    expect(analysis.path).toBe('src/widget.ts');
    expect(analysis.language).toBe('ts');
    expect(analysis.lines).toBe(tsFixture.split('\n').length);

    expect(analysis.imports).toEqual([
      { source: 'zod', specifiers: ['z'] },
      { source: './helper.js', specifiers: ['helper'] },
      { source: './side-effect.js', specifiers: [] }
    ]);

    expect(analysis.exports.map(e => e.name)).toEqual(['Widget', 'greet', 'VERSION']);
    expect(analysis.exports[1]).toEqual({ name: 'greet', type: 'named' });
    expect(analysis.exports[2]).toEqual({ name: 'VERSION', type: 'named' });

    expect(analysis.functions).toHaveLength(1);
    expect(analysis.functions[0]).toMatchObject({ name: 'greet', params: ['name', 'greeting'], async: false });
    expect(analysis.functions[0].line).toBeGreaterThan(0);

    expect(result.value.success).toBe(true);
  });

  it.fails('BUG-012: classRegex misses "export default class Widget" (classes array empty, complexity understated)', async () => {
    vi.mocked(readFile).mockResolvedValue(tsFixture as never);
    const result = await analyzeFileTool.execute({ path: 'src/widget.ts' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analysis = result.value.analysis;
    expect(analysis.classes).toHaveLength(1);
    expect(analysis.classes[0]).toMatchObject({ name: 'Widget', extends: 'Base', methods: ['render', 'update'] });
    expect(analysis.complexity).toBe(4);
  });

  it.fails('BUG-011: "export default class Widget" is classified as a named export (checks "default Widget", not "default class Widget")', async () => {
    vi.mocked(readFile).mockResolvedValue(tsFixture as never);
    const result = await analyzeFileTool.execute({ path: 'src/widget.ts' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.analysis.exports[0]).toEqual({ name: 'Widget', type: 'default' });
  });

  it('honors include* flags set to false', async () => {
    vi.mocked(readFile).mockResolvedValue(tsFixture as never);

    const result = await analyzeFileTool.execute({
      path: 'src/widget.ts',
      includeImports: false,
      includeExports: false,
      includeFunctions: false,
      includeClasses: false
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.analysis.imports).toEqual([]);
    expect(result.value.analysis.exports).toEqual([]);
    expect(result.value.analysis.functions).toEqual([]);
    expect(result.value.analysis.classes).toEqual([]);
    expect(result.value.analysis.complexity).toBe(1);
  });
});

describe('analyzeFileTool on Python', () => {
  it('extracts imports, functions, async flag, and classes', async () => {
    vi.mocked(readFile).mockResolvedValue(pyFixture as never);

    const result = await analyzeFileTool.execute({ path: 'script.py' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analysis = result.value.analysis;

    expect(analysis.language).toBe('py');
    expect(analysis.imports).toEqual([
      { source: 'os', specifiers: ['path'] },
      { source: 'sys', specifiers: ['sys'] }
    ]);
    expect(analysis.functions.map(f => f.name)).toEqual(['fetch', 'plain']);
    expect(analysis.functions[0].async).toBe(true);
    expect(analysis.functions[0].params).toEqual(['url', 'timeout=5']);
    expect(analysis.functions[1].async).toBe(false);
    expect(analysis.classes).toHaveLength(1);
    expect(analysis.classes[0]).toMatchObject({ name: 'Engine', extends: 'Base', methods: ['run'] });
    expect(analysis.complexity).toBe(4);
  });
});

describe('analyzeFileTool edge cases', () => {
  it('returns base analysis for non-code files', async () => {
    vi.mocked(readFile).mockResolvedValue('plain\ntext' as never);

    const result = await analyzeFileTool.execute({ path: 'notes.txt' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.analysis).toMatchObject({
      language: 'txt',
      lines: 2,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      complexity: 1
    });
  });

  it('wraps read failures as ToolError results', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const result = await analyzeFileTool.execute({ path: 'ghost.ts' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('ToolError');
      expect(result.error.message).toContain('Code analysis failed');
    }
  });

  it('rejects path traversal attempts', async () => {
    const result = await analyzeFileTool.execute({ path: '../outside.ts' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Path traversal attempt');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails validation without a path', async () => {
    const result = await analyzeFileTool.execute({} as never);
    expect(result.ok).toBe(false);
  });
});

describe('findReferencesTool', () => {
  it('finds word-boundary references with line, column, and context', async () => {
    vi.mocked(glob).mockResolvedValue(['/root/src/x.ts'] as never);
    vi.mocked(readFile).mockResolvedValue('const foo = 1;\nfoo(2);\nfoobar();' as never);

    const result = await findReferencesTool.execute({ symbol: 'foo' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.value.references;
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ file: '/root/src/x.ts', line: 1, context: 'const foo = 1;' });
    expect(refs[1]).toMatchObject({ file: '/root/src/x.ts', line: 2, context: 'foo(2);' });
    expect(typeof refs[0].column).toBe('number');
    expect(vi.mocked(glob).mock.calls[0][0]).toBe('**/*.{ts,tsx,js,jsx,py}');
  });

  it('returns an empty list when the symbol does not appear', async () => {
    vi.mocked(glob).mockResolvedValue(['/root/src/x.ts'] as never);
    vi.mocked(readFile).mockResolvedValue('nothing to see' as never);

    const result = await findReferencesTool.execute({ symbol: 'missing' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.references).toEqual([]);
  });

  it('honors a custom file pattern', async () => {
    vi.mocked(glob).mockResolvedValue([] as never);
    await findReferencesTool.execute({ symbol: 'x', filePattern: '**/*.py' });
    expect(vi.mocked(glob).mock.calls[0][0]).toBe('**/*.py');
  });

  it('wraps glob failures as ToolError results', async () => {
    vi.mocked(glob).mockRejectedValue(new Error('glob exploded') as never);
    const result = await findReferencesTool.execute({ symbol: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Find references failed');
  });

  it('fails validation without a symbol', async () => {
    const result = await findReferencesTool.execute({} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Invalid input for code.references');
  });
});
