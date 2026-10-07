import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { ResultOrError, ok, err } from '@core/types.js';
import { TaskError } from '@core/errors.js';

const LOCKS_DIR = resolve(process.cwd(), '.ai', 'locks');

export interface FileLock {
  file: string;
  taskId: string;
  agentId: 'agent_a' | 'agent_b';
  acquiredAt: Date;
  expiresAt?: Date;
}

export class FileLockManager {
  private locks = new Map<string, FileLock>();

  async initialize(): Promise<ResultOrError<void>> {
    try {
      await mkdir(LOCKS_DIR, { recursive: true });
      await this.loadLocks();
      return ok(undefined);
    } catch (e) {
      return err(new TaskError(`Failed to initialize lock manager: ${e instanceof Error ? e.message : 'Unknown error'}`, 'locks'));
    }
  }

  private async loadLocks(): Promise<void> {
    try {
      const files = await readdir(LOCKS_DIR);
      for (const file of files) {
        if (file.endsWith('.lock')) {
          const content = await readFile(resolve(LOCKS_DIR, file), 'utf-8');
          const lock = JSON.parse(content) as FileLock;
          lock.acquiredAt = new Date(lock.acquiredAt);
          lock.expiresAt = lock.expiresAt ? new Date(lock.expiresAt) : undefined;
          this.locks.set(lock.file, lock);
        }
      }
    } catch {
      // No locks directory or empty
    }
  }

  private getLockFile(file: string): string {
    return resolve(LOCKS_DIR, `${file.replace(/[/\\]/g, '_')}.lock`);
  }

  async acquire(file: string, taskId: string, agentId: 'agent_a' | 'agent_b', ttlMs = 3600000): Promise<ResultOrError<FileLock>> {
    const existing = this.locks.get(file);
    if (existing) {
      if (existing.expiresAt && existing.expiresAt < new Date()) {
        await this.release(file, taskId, agentId);
      } else if (existing.taskId !== taskId || existing.agentId !== agentId) {
        return err(new TaskError(`File locked by ${existing.agentId} (task: ${existing.taskId})`, taskId));
      }
    }

    const lock: FileLock = {
      file,
      taskId,
      agentId,
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs)
    };

    this.locks.set(file, lock);
    await this.persistLock(lock);
    return ok(lock);
  }

  async release(file: string, taskId: string, agentId: 'agent_a' | 'agent_b'): Promise<ResultOrError<void>> {
    const existing = this.locks.get(file);
    if (!existing) return ok(undefined);
    if (existing.taskId !== taskId || existing.agentId !== agentId) {
      return err(new TaskError(`Cannot release lock owned by ${existing.agentId} (task: ${existing.taskId})`, taskId));
    }

    this.locks.delete(file);
    await this.removeLockFile(file);
    return ok(undefined);
  }

  async forceRelease(file: string): Promise<ResultOrError<void>> {
    this.locks.delete(file);
    await this.removeLockFile(file);
    return ok(undefined);
  }

  isLocked(file: string): boolean {
    const lock = this.locks.get(file);
    if (!lock) return false;
    if (lock.expiresAt && lock.expiresAt < new Date()) {
      this.locks.delete(file);
      return false;
    }
    return true;
  }

  getLock(file: string): FileLock | undefined {
    const lock = this.locks.get(file);
    if (lock && lock.expiresAt && lock.expiresAt < new Date()) {
      this.locks.delete(file);
      return undefined;
    }
    return lock;
  }

  getLocksByTask(taskId: string): FileLock[] {
    return Array.from(this.locks.values()).filter(l => l.taskId === taskId);
  }

  getLocksByAgent(agentId: 'agent_a' | 'agent_b'): FileLock[] {
    return Array.from(this.locks.values()).filter(l => l.agentId === agentId);
  }

  async extend(file: string, taskId: string, agentId: 'agent_a' | 'agent_b', ttlMs = 3600000): Promise<ResultOrError<FileLock>> {
    const existing = this.locks.get(file);
    if (!existing) return err(new TaskError(`No lock to extend`, taskId));
    if (existing.taskId !== taskId || existing.agentId !== agentId) {
      return err(new TaskError(`Cannot extend lock owned by ${existing.agentId}`, taskId));
    }

    existing.expiresAt = new Date(Date.now() + ttlMs);
    await this.persistLock(existing);
    return ok(existing);
  }

  private async persistLock(lock: FileLock): Promise<void> {
    await writeFile(this.getLockFile(lock.file), JSON.stringify(lock, null, 2), 'utf-8');
  }

  private async removeLockFile(file: string): Promise<void> {
    try {
      await rm(this.getLockFile(file), { force: true });
    } catch {
      // Ignore
    }
  }

  async cleanup(): Promise<number> {
    let cleaned = 0;
    const now = new Date();
    for (const [file, lock] of this.locks) {
      if (lock.expiresAt && lock.expiresAt < now) {
        this.locks.delete(file);
        await this.removeLockFile(file);
        cleaned++;
      }
    }
    return cleaned;
  }
}

export const fileLockManager = new FileLockManager();