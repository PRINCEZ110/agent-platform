import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir, readdir, stat, rm, cp } from 'fs/promises';
import {
  readFileTool,
  writeFileTool,
  listDirTool,
  deleteTool,
  statTool,
  copyTool
} from '../../src/tools/filesystem-tool.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
  cp: vi.fn(),
  access: vi.fn(),
  constants: { O_RDONLY: 0 }
}));

beforeEach(() => {
  vi.resetAllMocks();
});

const dirent = (name: string, isDir: boolean) => ({
  name,
  isDirectory: () => isDir,
  isFile: () => !isDir
});

describe('readFileTool', () => {
  it('reads a file and reports content and size', async () => {
    vi.mocked(readFile).mockResolvedValue('hello world' as never);

    const result = await readFileTool.execute({ path: 'notes.txt' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.content).toBe('hello world');
      expect(result.value.size).toBe(11);
    }
    expect(vi.mocked(readFile).mock.calls[0][1]).toBe('utf-8');
  });

  it('returns a ToolError result when reading fails', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
    const result = await readFileTool.execute({ path: 'missing.txt' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('ToolError');
      expect(result.error.message).toContain('Failed to read file');
    }
  });

  it('rejects path traversal attempts', async () => {
    const result = await readFileTool.execute({ path: '../outside.txt' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Path traversal attempt');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails validation when path is missing', async () => {
    const result = await readFileTool.execute({} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Invalid input for fs.read');
  });

  it.fails('BUG-009: safePath startsWith check is bypassable via a sibling dir sharing the root name prefix', async () => {
    const { basename } = await import('path');
    const probe = `../${basename(process.cwd())}probe-evil/x.txt`;
    vi.mocked(readFile).mockResolvedValue('leaked' as never);
    const result = await readFileTool.execute({ path: probe });
    expect(result.ok).toBe(false);
  });
});

describe('writeFileTool', () => {
  it('writes content with the requested encoding', async () => {
    const result = await writeFileTool.execute({ path: 'out.txt', content: 'data' });

    expect(result.ok).toBe(true);
    expect(String(vi.mocked(writeFile).mock.calls[0][0])).toContain('out.txt');
    expect(vi.mocked(writeFile).mock.calls[0][1]).toBe('data');
    expect(vi.mocked(writeFile).mock.calls[0][2]).toBe('utf-8');
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('creates parent directories when createDirs is set', async () => {
    await writeFileTool.execute({ path: 'nested/dir/file.txt', content: 'x', createDirs: true });
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mkdir).mock.calls[0][1]).toMatchObject({ recursive: true });
  });

  it('returns a ToolError result when writing fails', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('EACCES') as never);
    const result = await writeFileTool.execute({ path: 'ro.txt', content: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Failed to write file');
  });

  it('rejects path traversal attempts', async () => {
    const result = await writeFileTool.execute({ path: '../evil.txt', content: 'x' });
    expect(result.ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('listDirTool', () => {
  it('lists files and directories with sizes', async () => {
    vi.mocked(readdir).mockResolvedValue([dirent('sub', true), dirent('a.txt', false)] as never);
    vi.mocked(stat).mockResolvedValue({ size: 42 } as never);

    const result = await listDirTool.execute({ path: '.' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries).toEqual([
        { name: 'sub', path: 'sub', type: 'directory' },
        { name: 'a.txt', path: 'a.txt', type: 'file', size: 42 }
      ]);
    }
    expect(vi.mocked(readdir).mock.calls[0][1]).toMatchObject({ withFileTypes: true });
  });

  it('descends into subdirectories when recursive', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([dirent('sub', true), dirent('top.txt', false)] as never)
      .mockResolvedValueOnce([dirent('inner.txt', false)] as never);
    vi.mocked(stat).mockResolvedValue({ size: 1 } as never);

    const result = await listDirTool.execute({ path: '.', recursive: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.value.entries.map(e => e.name);
      expect(names).toEqual(['sub', 'inner.txt', 'top.txt']);
      const inner = result.value.entries.find(e => e.name === 'inner.txt');
      expect(inner!.type).toBe('file');
    }
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  it('filters files with a pattern', async () => {
    vi.mocked(readdir).mockResolvedValue([dirent('a.txt', false), dirent('b.md', false)] as never);
    vi.mocked(stat).mockResolvedValue({ size: 1 } as never);

    const result = await listDirTool.execute({ path: '.', pattern: '\\.txt$' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries.map(e => e.name)).toEqual(['a.txt']);
  });

  it('returns a ToolError result on invalid patterns or read failures', async () => {
    vi.mocked(readdir).mockResolvedValue([dirent('a.txt', false)] as never);
    const badPattern = await listDirTool.execute({ path: '.', pattern: '[' });
    expect(badPattern.ok).toBe(false);
    if (!badPattern.ok) expect(badPattern.error.message).toContain('Failed to list directory');

    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT') as never);
    const failed = await listDirTool.execute({ path: 'nowhere' });
    expect(failed.ok).toBe(false);
  });

  it('rejects path traversal attempts', async () => {
    const result = await listDirTool.execute({ path: '../../etc' });
    expect(result.ok).toBe(false);
    expect(readdir).not.toHaveBeenCalled();
  });
});

describe('deleteTool', () => {
  it('deletes without recursion by default', async () => {
    const result = await deleteTool.execute({ path: 'old.txt' });
    expect(result.ok).toBe(true);
    expect(vi.mocked(rm).mock.calls[0][1]).toMatchObject({ recursive: false, force: true });
  });

  it('honors the recursive flag', async () => {
    await deleteTool.execute({ path: 'dir', recursive: true });
    expect(vi.mocked(rm).mock.calls[0][1]).toMatchObject({ recursive: true, force: true });
  });

  it('returns a ToolError result when rm fails', async () => {
    vi.mocked(rm).mockRejectedValue(new Error('locked') as never);
    const result = await deleteTool.execute({ path: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Failed to delete');
  });

  it('rejects path traversal attempts', async () => {
    const result = await deleteTool.execute({ path: '../important' });
    expect(result.ok).toBe(false);
    expect(rm).not.toHaveBeenCalled();
  });
});

describe('statTool', () => {
  it('maps filesystem stats to the output shape', async () => {
    const mtime = new Date('2026-01-01T00:00:00.000Z');
    const birthtime = new Date('2025-01-01T00:00:00.000Z');
    vi.mocked(stat).mockResolvedValue({
      size: 1234,
      isFile: () => true,
      isDirectory: () => false,
      mtime,
      birthtime
    } as never);

    const result = await statTool.execute({ path: 'file.txt' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stats).toEqual({
        size: 1234,
        isFile: true,
        isDirectory: false,
        modified: mtime,
        created: birthtime
      });
    }
  });

  it('returns a ToolError result when stat fails', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT') as never);
    const result = await statTool.execute({ path: 'ghost' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Failed to stat');
  });
});

describe('copyTool', () => {
  it('copies files with the recursive flag off by default', async () => {
    const result = await copyTool.execute({ source: 'a.txt', destination: 'b.txt' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.output).toEqual({ source: 'a.txt', destination: 'b.txt' });
    expect(vi.mocked(cp).mock.calls[0][2]).toMatchObject({ recursive: false });
  });

  it('honors the recursive flag', async () => {
    await copyTool.execute({ source: 'dir', destination: 'backup', recursive: true });
    expect(vi.mocked(cp).mock.calls[0][2]).toMatchObject({ recursive: true });
  });

  it('returns a ToolError result when cp fails', async () => {
    vi.mocked(cp).mockRejectedValue(new Error('EXDEV') as never);
    const result = await copyTool.execute({ source: 'a', destination: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Failed to copy');
  });

  it('rejects traversal in either operand', async () => {
    const result = await copyTool.execute({ source: '../a', destination: 'b' });
    expect(result.ok).toBe(false);
    expect(cp).not.toHaveBeenCalled();
  });
});
