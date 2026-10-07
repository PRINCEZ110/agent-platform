import { ResultOrError, ok, err } from '@core/types.js';
import { GitError } from '@core/errors.js';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

export interface BranchInfo {
  name: string;
  current: boolean;
  commit: string;
  tracking?: string;
}

export interface CreateBranchOptions {
  name: string;
  startPoint?: string;
  checkout?: boolean;
  track?: boolean;
}

export class BranchManager {
  private git: SimpleGit;

  constructor(private projectRoot: string) {
    this.git = simpleGit({ baseDir: projectRoot, binary: 'git' });
  }

  async list(all = false): Promise<ResultOrError<BranchInfo[]>> {
    try {
      const output = await this.git.raw(['branch', ...(all ? ['-a'] : []), '--format=%(refname:short)%(if)%(HEAD)%(then)*%(end)%(if)%(upstream:short)%(then) %(upstream:short)%(end)%(objectname:short)']);
      return ok(this.parseBranchList(output));
    } catch (e) {
      return err(new GitError(`Failed to list branches: ${e instanceof Error ? e.message : 'Unknown error'}`, 'list', e instanceof Error ? e : undefined));
    }
  }

  private parseBranchList(output: string): BranchInfo[] {
    return output.trim().split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split(' ');
        const name = parts[0].replace('*', '');
        const current = parts[0].startsWith('*');
        const tracking = parts.length > 2 ? parts[1] : undefined;
        const commit = parts[parts.length - 1];
        return { name, current, commit, tracking };
      });
  }

  async create(options: CreateBranchOptions): Promise<ResultOrError<BranchInfo>> {
    try {
      const { name, startPoint, checkout = true, track = false } = options;

      const exists = await this.exists(name);
      if (exists.ok && exists.value) {
        return err(new GitError(`Branch already exists: ${name}`, 'create'));
      }

      if (checkout) {
        if (startPoint) {
          await this.git.raw(['checkout', '-b', name, startPoint]);
        } else {
          await this.git.raw(['checkout', '-b', name]);
        }
      } else {
        if (startPoint) {
          await this.git.raw(['branch', name, startPoint]);
        } else {
          await this.git.raw(['branch', name]);
        }
      }

      if (track && startPoint) {
        await this.git.raw(['branch', '--set-upstream-to', startPoint, name]);
      }

      return this.getInfo(name);
    } catch (e) {
      return err(new GitError(`Failed to create branch: ${e instanceof Error ? e.message : 'Unknown error'}`, 'create', e instanceof Error ? e : undefined));
    }
  }

  async delete(name: string, force = false): Promise<ResultOrError<void>> {
    try {
      await this.git.raw(['branch', force ? '-D' : '-d', name]);
      return ok(undefined);
    } catch (e) {
      return err(new GitError(`Failed to delete branch: ${e instanceof Error ? e.message : 'Unknown error'}`, 'delete', e instanceof Error ? e : undefined));
    }
  }

  async checkout(name: string): Promise<ResultOrError<void>> {
    try {
      await this.git.raw(['checkout', name]);
      return ok(undefined);
    } catch (e) {
      return err(new GitError(`Failed to checkout branch: ${e instanceof Error ? e.message : 'Unknown error'}`, 'checkout', e instanceof Error ? e : undefined));
    }
  }

  async rename(oldName: string, newName: string): Promise<ResultOrError<void>> {
    try {
      await this.git.raw(['branch', '-m', oldName, newName]);
      return ok(undefined);
    } catch (e) {
      return err(new GitError(`Failed to rename branch: ${e instanceof Error ? e.message : 'Unknown error'}`, 'rename', e instanceof Error ? e : undefined));
    }
  }

  async getCurrent(): Promise<ResultOrError<string>> {
    try {
      const output = await this.git.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
      return ok(output.trim());
    } catch (e) {
      return err(new GitError(`Failed to get current branch: ${e instanceof Error ? e.message : 'Unknown error'}`, 'getCurrent', e instanceof Error ? e : undefined));
    }
  }

  async exists(name: string): Promise<ResultOrError<boolean>> {
    try {
      const list = await this.list(true);
      if (!list.ok) return list;
      return ok(list.value.some(b => b.name === name));
    } catch (e) {
      return err(new GitError(`Failed to check branch existence: ${e instanceof Error ? e.message : 'Unknown error'}`, 'exists', e instanceof Error ? e : undefined));
    }
  }

  async getInfo(name: string): Promise<ResultOrError<BranchInfo>> {
    try {
      const list = await this.list(true);
      if (!list.ok) return list;
      const found = list.value.find(b => b.name === name);
      if (!found) return err(new GitError(`Branch not found: ${name}`, 'getInfo'));
      return ok(found);
    } catch (e) {
      return err(new GitError(`Failed to get branch info: ${e instanceof Error ? e.message : 'Unknown error'}`, 'getInfo', e instanceof Error ? e : undefined));
    }
  }

  async getMergeBase(branch1: string, branch2: string): Promise<ResultOrError<string>> {
    try {
      const output = await this.git.raw(['merge-base', branch1, branch2]);
      return ok(output.trim());
    } catch (e) {
      return err(new GitError(`Failed to get merge base: ${e instanceof Error ? e.message : 'Unknown error'}`, 'getMergeBase', e instanceof Error ? e : undefined));
    }
  }
}

export function createBranchManager(projectRoot?: string): BranchManager {
  return new BranchManager(projectRoot ?? process.cwd());
}