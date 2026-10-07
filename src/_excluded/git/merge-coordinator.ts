import { ResultOrError, ok, err } from '@core/types.js';
import { GitError } from '@core/errors.js';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

export interface MergeProposal {
  id: string;
  sourceBranch: string;
  targetBranch: string;
  sourceWorktree?: string;
  targetWorktree?: string;
  title: string;
  description: string;
  author: string;
  createdAt: Date;
  diff?: string;
  conflicts?: string[];
  status: 'pending' | 'review' | 'approved' | 'rejected' | 'merged' | 'conflict';
}

export interface MergeResult {
  success: boolean;
  commitHash?: string;
  conflicts?: string[];
  message: string;
}

export class MergeCoordinator {
  private git: SimpleGit;
  private proposals = new Map<string, MergeProposal>();

  constructor(private projectRoot: string) {
    this.git = simpleGit({ baseDir: projectRoot, binary: 'git' });
  }

  async createProposal(proposal: Omit<MergeProposal, 'id' | 'createdAt' | 'status'>): Promise<ResultOrError<MergeProposal>> {
    try {
      const diff = await this.getDiff(proposal.sourceBranch, proposal.targetBranch);
      const conflicts = await this.checkConflicts(proposal.sourceBranch, proposal.targetBranch);

      const fullProposal: MergeProposal = {
        ...proposal,
        id: `${proposal.sourceBranch}-to-${proposal.targetBranch}-${Date.now()}`,
        createdAt: new Date(),
        status: conflicts.length > 0 ? 'conflict' : 'pending',
        diff: diff.ok ? diff.value : undefined,
        conflicts: conflicts.length > 0 ? conflicts : undefined
      };

      this.proposals.set(fullProposal.id, fullProposal);

      return ok(fullProposal);
    } catch (e) {
      return err(new GitError(`Failed to create merge proposal: ${e instanceof Error ? e.message : 'Unknown error'}`, 'createProposal', e instanceof Error ? e : undefined));
    }
  }

  async getProposal(id: string): Promise<ResultOrError<MergeProposal>> {
    const proposal = this.proposals.get(id);
    if (!proposal) return err(new GitError(`Proposal not found: ${id}`, 'getProposal'));
    return ok(proposal);
  }

  async listProposals(): Promise<MergeProposal[]> {
    return Array.from(this.proposals.values());
  }

  async updateStatus(id: string, status: MergeProposal['status']): Promise<ResultOrError<void>> {
    const proposal = this.proposals.get(id);
    if (!proposal) return err(new GitError(`Proposal not found: ${id}`, 'updateStatus'));
    proposal.status = status;
    return ok(undefined);
  }

  async executeMerge(id: string): Promise<ResultOrError<MergeResult>> {
    const proposal = this.proposals.get(id);
    if (!proposal) return err(new GitError(`Proposal not found: ${id}`, 'executeMerge'));

    try {
      await this.git.raw(['checkout', proposal.targetBranch]);

      const mergeResult = await this.git.raw(['merge', proposal.sourceBranch]);

      if (mergeResult.includes('CONFLICT')) {
        proposal.status = 'conflict';
        const conflicts = mergeResult.match(/CONFLICT.*?:.*/g) ?? [];
        proposal.conflicts = conflicts;
        return ok({ success: false, conflicts, message: 'Merge conflicts detected' });
      }

      const logOutput = await this.git.raw(['log', '-1', '--format=%H']);
      proposal.status = 'merged';
      return ok({ success: true, commitHash: logOutput.trim(), message: 'Merge successful' });
    } catch (e) {
      return err(new GitError(`Failed to execute merge: ${e instanceof Error ? e.message : 'Unknown error'}`, 'executeMerge', e instanceof Error ? e : undefined));
    }
  }

  async getDiff(sourceBranch: string, targetBranch: string): Promise<ResultOrError<string>> {
    try {
      const diff = await this.git.raw(['diff', `${targetBranch}..${sourceBranch}`]);
      return ok(diff);
    } catch (e) {
      return err(new GitError(`Failed to get diff: ${e instanceof Error ? e.message : 'Unknown error'}`, 'getDiff', e instanceof Error ? e : undefined));
    }
  }

  async checkConflicts(sourceBranch: string, targetBranch: string): Promise<string[]> {
    try {
      await this.git.raw(['merge-base', sourceBranch, targetBranch]);
      return [];
    } catch {
      return [];
    }
  }

  async reviewDiff(id: string): Promise<ResultOrError<string>> {
    const proposal = this.proposals.get(id);
    if (!proposal) return err(new GitError(`Proposal not found: ${id}`, 'reviewDiff'));

    try {
      const diff = await this.git.raw(['diff', `${proposal.targetBranch}..${proposal.sourceBranch}`]);
      return ok(diff);
    } catch (e) {
      return err(new GitError(`Failed to review diff: ${e instanceof Error ? e.message : 'Unknown error'}`, 'reviewDiff', e instanceof Error ? e : undefined));
    }
  }

  deleteProposal(id: string): boolean {
    return this.proposals.delete(id);
  }
}

export function createMergeCoordinator(projectRoot?: string): MergeCoordinator {
  return new MergeCoordinator(projectRoot ?? process.cwd());
}