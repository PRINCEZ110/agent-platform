import { ResultOrError, ok, err } from '@core/types.js';
import { GitError } from '@core/errors.js';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
  changes: number;
  binary: boolean;
  type: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  oldPath?: string;
  hunks: Hunk[];
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: HunkLine[];
}

export interface HunkLine {
  type: 'context' | 'add' | 'del';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffSummary {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
  binaryFiles: number;
}

export class DiffAnalyzer {
  private git: SimpleGit;

  constructor(private projectRoot: string) {
    this.git = simpleGit({ baseDir: projectRoot, binary: 'git' });
  }

  async analyzeDiff(from: string, to: string): Promise<ResultOrError<DiffSummary>> {
    try {
      const diff = await this.git.raw(['diff', '--numstat', `${from}..${to}`]);
      return ok(this.parseDiff(diff));
    } catch (e) {
      return err(new GitError(`Failed to analyze diff: ${e instanceof Error ? e.message : 'Unknown error'}`, 'analyzeDiff', e instanceof Error ? e : undefined));
    }
  }

  async analyzeWorktreeDiff(worktreePath: string, baseBranch: string): Promise<ResultOrError<DiffSummary>> {
    try {
      const worktreeGit = simpleGit({ baseDir: worktreePath, binary: 'git' });
      const diff = await worktreeGit.raw(['diff', '--numstat', `${baseBranch}..HEAD`]);
      return ok(this.parseDiff(diff));
    } catch (e) {
      return err(new GitError(`Failed to analyze worktree diff: ${e instanceof Error ? e.message : 'Unknown error'}`, 'analyzeWorktreeDiff', e instanceof Error ? e : undefined));
    }
  }

  private parseDiff(diffOutput: string): DiffSummary {
    const files: FileChange[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;
    let binaryFiles = 0;

    const lines = diffOutput.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [additions, deletions, file] = line.split('\t');
      const add = additions === '-' ? 0 : parseInt(additions, 10);
      const del = deletions === '-' ? 0 : parseInt(deletions, 10);

      totalAdditions += add;
      totalDeletions += del;
      if (additions === '-' || deletions === '-') binaryFiles++;

      files.push({
        file,
        additions: add,
        deletions: del,
        changes: add + del,
        binary: additions === '-' || deletions === '-',
        type: 'modified',
        hunks: []
      });
    }

    return {
      files,
      totalAdditions,
      totalDeletions,
      totalFiles: files.length,
      binaryFiles
    };
  }

  getFileTypes(files: FileChange[]): Record<string, number> {
    const types: Record<string, number> = {};
    for (const file of files) {
      const ext = file.file.split('.').pop()?.toLowerCase() ?? 'unknown';
      types[ext] = (types[ext] ?? 0) + 1;
    }
    return types;
  }

  getLargestChanges(files: FileChange[], count = 10): FileChange[] {
    return [...files].sort((a, b) => b.changes - a.changes).slice(0, count);
  }

  getConflictRisk(files: FileChange[]): 'low' | 'medium' | 'high' {
    const modifiedCore = files.some(f =>
      f.file.includes('package.json') ||
      f.file.includes('tsconfig') ||
      f.file.includes('.config.') ||
      f.file.includes('schema') ||
      f.file.includes('migration')
    );
    const manyFiles = files.length > 20;
    const largeChanges = files.some(f => f.changes > 100);

    if (modifiedCore || largeChanges) return 'high';
    if (manyFiles) return 'medium';
    return 'low';
  }
}

export function createDiffAnalyzer(projectRoot?: string): DiffAnalyzer {
  return new DiffAnalyzer(projectRoot ?? process.cwd());
}