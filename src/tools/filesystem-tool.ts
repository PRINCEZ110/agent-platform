import { createTool, ToolPermission, ToolResult } from './tool.js';
import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';
import { ToolError } from '@core/errors.js';
import { readFile, writeFile, mkdir, readdir, stat, rm, cp, access, constants } from 'fs/promises';
import { join, resolve, relative, dirname } from 'path';

const projectRoot = resolve(process.cwd());

function safePath(inputPath: string): string {
  const resolved = resolve(projectRoot, inputPath);
  if (!resolved.startsWith(projectRoot)) {
    throw new ToolError(`Path traversal attempt: ${inputPath}`, 'filesystem');
  }
  return resolved;
}

const ReadFileInputSchema = z.object({
  path: z.string(),
  encoding: z.enum(['utf-8', 'base64']).optional()
});
type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

interface ReadFileOutput extends ToolResult {
  content: string;
  size: number;
}

export const readFileTool = createTool<ReadFileInput, ReadFileOutput>(
  'fs.read',
  'Read a file from the filesystem',
  ReadFileInputSchema,
  ['fs.read'],
  async (input) => {
    try {
      const path = safePath(input.path);
      const encoding = input.encoding ?? 'utf-8';
      const content = await readFile(path, encoding);
      return ok({ success: true, content, size: Buffer.byteLength(content, encoding), output: { content, size: Buffer.byteLength(content, encoding) } });
    } catch (e) {
      return err(new ToolError(`Failed to read file: ${e instanceof Error ? e.message : 'Unknown error'}`, 'fs.read', e instanceof Error ? e : undefined));
    }
  }
);

const WriteFileInputSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).optional(),
  createDirs: z.boolean().optional()
});
type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export const writeFileTool = createTool<WriteFileInput, ToolResult>(
  'fs.write',
  'Write a file to the filesystem',
  WriteFileInputSchema,
  ['fs.write'],
  async (input) => {
    try {
      const path = safePath(input.path);
      if (input.createDirs) {
        await mkdir(dirname(path), { recursive: true });
      }
      await writeFile(path, input.content, input.encoding ?? 'utf-8');
      return ok({ success: true, output: { path } });
    } catch (e) {
      return err(new ToolError(`Failed to write file: ${e instanceof Error ? e.message : 'Unknown error'}`, 'fs.write', e instanceof Error ? e : undefined));
    }
  }
);

const ListDirInputSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
  pattern: z.string().optional()
});
type ListDirInput = z.infer<typeof ListDirInputSchema>;

interface ListDirOutput extends ToolResult {
  entries: Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }>;
}

export const listDirTool = createTool<ListDirInput, ListDirOutput>(
  'fs.list',
  'List directory contents',
  ListDirInputSchema,
  ['fs.read'],
  async (input) => {
    try {
      const path = safePath(input.path ?? '.');
      const entries: ListDirOutput['entries'] = [];

      async function scan(dir: string, base: string) {
        const items = await readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = join(dir, item.name);
          const relPath = join(base, item.name);
          if (item.isDirectory()) {
            entries.push({ name: item.name, path: relPath, type: 'directory' });
            if (input.recursive) await scan(fullPath, relPath);
          } else if (item.isFile()) {
            if (!input.pattern || new RegExp(input.pattern).test(item.name)) {
              const stats = await stat(fullPath);
              entries.push({ name: item.name, path: relPath, type: 'file', size: stats.size });
            }
          }
        }
      }

      await scan(path, input.path ?? '.');
      return ok({ success: true, entries, output: { entries } });
    } catch (e) {
      return err(new ToolError(`Failed to list directory: ${e instanceof Error ? e.message : 'Unknown error'}`, 'fs.list', e instanceof Error ? e : undefined));
    }
  }
);

const DeleteInputSchema = z.object({
  path: z.string(),
  recursive: z.boolean().optional()
});
type DeleteInput = z.infer<typeof DeleteInputSchema>;

export const deleteTool = createTool<DeleteInput, ToolResult>(
  'fs.delete',
  'Delete a file or directory',
  DeleteInputSchema,
  ['fs.delete'],
  async (input) => {
    try {
      const path = safePath(input.path);
      await rm(path, { recursive: input.recursive ?? false, force: true });
      return ok({ success: true, output: { path } });
    } catch (e) {
      return err(new ToolError(`Failed to delete: ${e instanceof Error ? e.message : 'Unknown error'}`, 'fs.delete', e instanceof Error ? e : undefined));
    }
  }
);

const StatInputSchema = z.object({ path: z.string() });
type StatInput = z.infer<typeof StatInputSchema>;

interface StatOutput extends ToolResult {
  stats: { size: number; isFile: boolean; isDirectory: boolean; modified: Date; created: Date };
}

export const statTool = createTool<StatInput, StatOutput>(
  'fs.stat',
  'Get file/directory stats',
  StatInputSchema,
  ['fs.read'],
  async (input) => {
    try {
      const path = safePath(input.path);
      const stats = await stat(path);
      return ok({
        success: true,
        stats: { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory(), modified: stats.mtime, created: stats.birthtime },
        output: { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory() }
      });
    } catch (e) {
      return err(new ToolError(`Failed to stat: ${e instanceof Error ? e.message : 'Unknown error'}`, 'fs.stat', e instanceof Error ? e : undefined));
    }
  }
);

const CopyInputSchema = z.object({
  source: z.string(),
  destination: z.string(),
  recursive: z.boolean().optional()
});
type CopyInput = z.infer<typeof CopyInputSchema>;

export const copyTool = createTool<CopyInput, ToolResult>(
  'fs.copy',
  'Copy a file or directory',
  CopyInputSchema,
  ['fs.read', 'fs.write'],
  async (input) => {
    try {
      const src = safePath(input.source);
      const dest = safePath(input.destination);
      await cp(src, dest, { recursive: input.recursive ?? false });
      return ok({ success: true, output: { source: input.source, destination: input.destination } });
    } catch (e) {
      return err(new ToolError(`Failed to copy: ${e instanceof Error ? e.message : 'Unknown error'}`, 'fs.copy', e instanceof Error ? e : undefined));
    }
  }
);