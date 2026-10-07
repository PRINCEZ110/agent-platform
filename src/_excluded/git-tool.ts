import { createTool, ToolPermission, ToolResult } from './tool.js';
import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';
import { ToolError } from '@core/errors.js';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

const projectRoot = process.cwd();

function getGit(cwd?: string): SimpleGit {
  return simpleGit({ baseDir: cwd ?? projectRoot, binary: 'git' });
}

const GitStatusInputSchema = z.object({ cwd: z.string().optional() });
type GitStatusInput = z.infer<typeof GitStatusInputSchema>;

interface GitStatusOutput extends ToolResult {
  status: string;
}

export const gitStatusTool = createTool<GitStatusInput, GitStatusOutput>(
  'git.status',
  'Get git status',
  GitStatusInputSchema,
  ['git.read'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      const status = await git.raw(['status', '--porcelain']);
      return ok({ success: true, status, output: { status } });
    } catch (e) {
      return err(new ToolError(`Git status failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.status', e instanceof Error ? e : undefined));
    }
  }
);

const GitDiffInputSchema = z.object({
  cwd: z.string().optional(),
  staged: z.boolean().optional(),
  file: z.string().optional()
});
type GitDiffInput = z.infer<typeof GitDiffInputSchema>;

interface GitDiffOutput extends ToolResult {
  diff: string;
}

export const gitDiffTool = createTool<GitDiffInput, GitDiffOutput>(
  'git.diff',
  'Get git diff',
  GitDiffInputSchema,
  ['git.read'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      const args = ['diff'];
      if (input.staged) args.push('--cached');
      if (input.file) args.push(input.file);
      const diff = await git.raw(args);
      return ok({ success: true, diff, output: { diff } });
    } catch (e) {
      return err(new ToolError(`Git diff failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.diff', e instanceof Error ? e : undefined));
    }
  }
);

const GitLogInputSchema = z.object({
  cwd: z.string().optional(),
  maxCount: z.number().positive().optional(),
  file: z.string().optional()
});
type GitLogInput = z.infer<typeof GitLogInputSchema>;

interface GitLogOutput extends ToolResult {
  log: string;
}

export const gitLogTool = createTool<GitLogInput, GitLogOutput>(
  'git.log',
  'Get git log',
  GitLogInputSchema,
  ['git.read'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      const args = ['log', '--oneline', `-${input.maxCount ?? 10}`];
      if (input.file) args.push(input.file);
      const log = await git.raw(args);
      return ok({ success: true, log, output: { log } });
    } catch (e) {
      return err(new ToolError(`Git log failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.log', e instanceof Error ? e : undefined));
    }
  }
);

const GitBranchInputSchema = z.object({
  cwd: z.string().optional(),
  list: z.boolean().optional(),
  create: z.string().optional(),
  delete: z.string().optional(),
  checkout: z.string().optional()
});
type GitBranchInput = z.infer<typeof GitBranchInputSchema>;

interface GitBranchOutput extends ToolResult {
  branches?: string;
  current?: string;
}

export const gitBranchTool = createTool<GitBranchInput, GitBranchOutput>(
  'git.branch',
  'Manage git branches',
  GitBranchInputSchema,
  ['git.read', 'git.write'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      if (input.list) {
        const branches = await git.raw(['branch', '-a']);
        return ok({ success: true, branches, output: { branches } });
      }
      if (input.create) {
        await git.raw(['checkout', '-b', input.create]);
        return ok({ success: true, current: input.create, output: { created: input.create } });
      }
      if (input.delete) {
        await git.raw(['branch', '-d', input.delete]);
        return ok({ success: true, output: { deleted: input.delete } });
      }
      if (input.checkout) {
        await git.raw(['checkout', input.checkout]);
        return ok({ success: true, current: input.checkout, output: { checkout: input.checkout } });
      }
      const current = await git.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
      return ok({ success: true, current: current.trim(), output: { current: current.trim() } });
    } catch (e) {
      return err(new ToolError(`Git branch failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.branch', e instanceof Error ? e : undefined));
    }
  }
);

const GitCommitInputSchema = z.object({
  cwd: z.string().optional(),
  message: z.string(),
  addAll: z.boolean().optional(),
  files: z.array(z.string()).optional()
});
type GitCommitInput = z.infer<typeof GitCommitInputSchema>;

export const gitCommitTool = createTool<GitCommitInput, ToolResult>(
  'git.commit',
  'Create a git commit',
  GitCommitInputSchema,
  ['git.write'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      if (input.addAll) await git.raw(['add', '.']);
      else if (input.files) await git.raw(['add', ...input.files]);
      await git.raw(['commit', '-m', input.message]);
      return ok({ success: true, output: { message: input.message } });
    } catch (e) {
      return err(new ToolError(`Git commit failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.commit', e instanceof Error ? e : undefined));
    }
  }
);

const GitPushInputSchema = z.object({
  cwd: z.string().optional(),
  remote: z.string().optional(),
  branch: z.string().optional(),
  force: z.boolean().optional()
});
type GitPushInput = z.infer<typeof GitPushInputSchema>;

export const gitPushTool = createTool<GitPushInput, ToolResult>(
  'git.push',
  'Push to remote',
  GitPushInputSchema,
  ['git.push'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      await git.raw(['push', input.remote ?? 'origin', input.branch ?? '', ...(input.force ? ['--force'] : [])]);
      return ok({ success: true, output: { remote: input.remote, branch: input.branch } });
    } catch (e) {
      return err(new ToolError(`Git push failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.push', e instanceof Error ? e : undefined));
    }
  }
);

const GitPullInputSchema = z.object({
  cwd: z.string().optional(),
  remote: z.string().optional(),
  branch: z.string().optional()
});
type GitPullInput = z.infer<typeof GitPullInputSchema>;

export const gitPullTool = createTool<GitPullInput, ToolResult>(
  'git.pull',
  'Pull from remote',
  GitPullInputSchema,
  ['git.read', 'git.write'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      await git.raw(['pull', input.remote ?? 'origin', input.branch ?? '']);
      return ok({ success: true, output: { remote: input.remote, branch: input.branch } });
    } catch (e) {
      return err(new ToolError(`Git pull failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.pull', e instanceof Error ? e : undefined));
    }
  }
);

const GitAddInputSchema = z.object({
  cwd: z.string().optional(),
  files: z.array(z.string()).optional(),
  all: z.boolean().optional()
});
type GitAddInput = z.infer<typeof GitAddInputSchema>;

export const gitAddTool = createTool<GitAddInput, ToolResult>(
  'git.add',
  'Stage files',
  GitAddInputSchema,
  ['git.write'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      if (input.all) await git.raw(['add', '.']);
      else if (input.files) await git.raw(['add', ...input.files]);
      return ok({ success: true });
    } catch (e) {
      return err(new ToolError(`Git add failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.add', e instanceof Error ? e : undefined));
    }
  }
);

const GitStashInputSchema = z.object({
  cwd: z.string().optional(),
  action: z.enum(['push', 'pop', 'list', 'drop']),
  message: z.string().optional(),
  index: z.number().optional()
});
type GitStashInput = z.infer<typeof GitStashInputSchema>;

export const gitStashTool = createTool<GitStashInput, ToolResult>(
  'git.stash',
  'Stash changes',
  GitStashInputSchema,
  ['git.write'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      switch (input.action) {
        case 'push':
          if (input.message) await git.raw(['stash', 'push', '-m', input.message]);
          else await git.raw(['stash', 'push']);
          break;
        case 'pop': await git.raw(['stash', 'pop']); break;
        case 'list': return ok({ success: true, output: await git.raw(['stash', 'list']) });
        case 'drop': await git.raw(['stash', 'drop', `stash@{${input.index ?? 0}}`]); break;
      }
      return ok({ success: true });
    } catch (e) {
      return err(new ToolError(`Git stash failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.stash', e instanceof Error ? e : undefined));
    }
  }
);

const GitWorktreeInputSchema = z.object({
  cwd: z.string().optional(),
  action: z.enum(['add', 'remove', 'list', 'prune']),
  path: z.string().optional(),
  branch: z.string().optional()
});
type GitWorktreeInput = z.infer<typeof GitWorktreeInputSchema>;

interface GitWorktreeOutput extends ToolResult {
  worktrees?: string;
}

export const gitWorktreeTool = createTool<GitWorktreeInput, GitWorktreeOutput>(
  'git.worktree',
  'Manage git worktrees',
  GitWorktreeInputSchema,
  ['git.write'],
  async (input) => {
    try {
      const git = getGit(input.cwd);
      switch (input.action) {
        case 'add':
          if (!input.path || !input.branch) return err(new ToolError('path and branch required for add', 'git.worktree'));
          await git.raw(['worktree', 'add', '-b', input.branch, input.path]);
          return ok({ success: true, output: { path: input.path, branch: input.branch } });
        case 'remove':
          if (!input.path) return err(new ToolError('path required for remove', 'git.worktree'));
          await git.raw(['worktree', 'remove', input.path]);
          return ok({ success: true, output: { path: input.path } });
        case 'list':
          return ok({ success: true, worktrees: await git.raw(['worktree', 'list']), output: { worktrees: await git.raw(['worktree', 'list']) } });
        case 'prune': await git.raw(['worktree', 'prune']); return ok({ success: true });
      }
    } catch (e) {
      return err(new ToolError(`Git worktree failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'git.worktree', e instanceof Error ? e : undefined));
    }
  }
);