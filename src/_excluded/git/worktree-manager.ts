import { ResultOrError, ok, err } from '@core/types.js';
import { GitError } from '@core/errors.js';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  bare: boolean;
  detached: boolean;
}

export interface CreateWorktreeOptions {
  path: string;
  branch: string;
  baseBranch?: string;
  force?: boolean;
}

export class WorktreeManager {
  private git: SimpleGit;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.git = simpleGit({ baseDir: projectRoot, binary: 'git' });
  }

  async list(): Promise<ResultOrError<WorktreeInfo[]>> {
    try {
      const output = await this.git.raw(['worktree', 'list', '--porcelain']);
      const worktrees = this.parseWorktreeList(output);
      return ok(worktrees);
    } catch (e) {
      return err(new GitError(`Failed to list worktrees: ${e instanceof Error ? e.message : 'Unknown error'}`, 'list', e instanceof Error ? e : undefined));
    }
  }

  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const lines = output.trim().split('\n');
    let current: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current as WorktreeInfo);
        current = { path: line.substring(9).trim() };
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).trim();
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.substring(5).trim();
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      }
    }
    if (current.path) worktrees.push(current as WorktreeInfo);
    return worktrees;
  }

  async create(options: CreateWorktreeOptions): Promise<ResultOrError<WorktreeInfo>> {
    try {
      const { path, branch, baseBranch = 'main', force = false } = options;

      const exists = await this.exists(path);
      if (exists.ok && exists.value) {
        if (!force) {
          return err(new GitError(`Worktree already exists at ${path}`, 'create'));
        }
        await this.remove(path);
      }

      await this.git.raw(['worktree', 'add', '-b', branch, path, baseBranch]);

      const info = await this.getInfo(path);
      return info;
    } catch (e) {
      return err(new GitError(`Failed to create worktree: ${e instanceof Error ? e.message : 'Unknown error'}`, 'create', e instanceof Error ? e : undefined));
    }
  }

  async remove(path: string, force = false): Promise<ResultOrError<void>> {
    try {
      await this.git.raw(['worktree', 'remove', ...(force ? ['--force'] : []), path]);
      return ok(undefined);
    } catch (e) {
      return err(new GitError(`Failed to remove worktree: ${e instanceof Error ? e.message : 'Unknown error'}`, 'remove', e instanceof Error ? e : undefined));
    }
  }

  async prune(): Promise<ResultOrError<void>> {
    try {
      await this.git.raw(['worktree', 'prune']);
      return ok(undefined);
    } catch (e) {
      return err(new GitError(`Failed to prune worktrees: ${e instanceof Error ? e.message : 'Unknown error'}`, 'prune', e instanceof Error ? e : undefined));
    }
  }

  async exists(path: string): Promise<ResultOrError<boolean>> {
    try {
      const list = await this.list();
      if (!list.ok) return list;
      return ok(list.value.some(w => w.path === path));
    } catch (e) {
      return err(new GitError(`Failed to check worktree existence: ${e instanceof Error ? e.message : 'Unknown error'}`, 'exists', e instanceof Error ? e : undefined));
    }
  }

  async getInfo(path: string): Promise<ResultOrError<WorktreeInfo>> {
    try {
      const list = await this.list();
      if (!list.ok) return list;
      const found = list.value.find(w => w.path === path);
      if (!found) return err(new GitError(`Worktree not found: ${path}`, 'getInfo'));
      return ok(found);
    } catch (e) {
      return err(new GitError(`Failed to get worktree info: ${e instanceof Error ? e.message : 'Unknown error'}`, 'getInfo', e instanceof Error ? e : undefined));
    }
  }

  getWorktreeGit(path: string): SimpleGit {
    return simpleGit({ baseDir: path, binary: 'git' });
  }
}

export function createWorktreeManager(projectRoot?: string): WorktreeManager {
  return new WorktreeManager(projectRoot ?? process.cwd());
}