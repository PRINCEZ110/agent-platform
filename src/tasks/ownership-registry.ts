import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { ResultOrError, ok, err } from '@core/types.js';
import { TaskError } from '@core/errors.js';
import { minimatch } from 'minimatch';

export interface OwnershipConfig {
  agent_a: { description: string; files: string[] };
  agent_b: { description: string; files: string[] };
  shared: { description: string; files: string[] };
}

const OWNERSHIP_PATH = resolve(process.cwd(), '.ai', 'ownership.json');

export class OwnershipRegistry {
  private config: OwnershipConfig | null = null;

  async load(): Promise<ResultOrError<OwnershipConfig>> {
    try {
      const content = await readFile(OWNERSHIP_PATH, 'utf-8');
      this.config = JSON.parse(content);
      return ok(this.config!);
    } catch (e) {
      return err(new TaskError(`Failed to load ownership config: ${e instanceof Error ? e.message : 'Unknown error'}`, 'ownership'));
    }
  }

  getConfig(): OwnershipConfig | null {
    return this.config;
  }

  getOwner(filePath: string): 'agent_a' | 'agent_b' | 'shared' | 'unknown' {
    if (!this.config) return 'unknown';

    for (const pattern of this.config.agent_a.files) {
      if (minimatch(filePath, pattern, { dot: true })) return 'agent_a';
    }
    for (const pattern of this.config.agent_b.files) {
      if (minimatch(filePath, pattern, { dot: true })) return 'agent_b';
    }
    for (const pattern of this.config.shared.files) {
      if (minimatch(filePath, pattern, { dot: true })) return 'shared';
    }
    return 'unknown';
  }

  canModify(agentId: 'agent_a' | 'agent_b', filePath: string): boolean {
    const owner = this.getOwner(filePath);
    if (owner === agentId) return true;
    if (owner === 'shared') return false; // Requires coordination
    if (owner === 'unknown') return false; // Default deny
    return false;
  }

  getOwnedFiles(agentId: 'agent_a' | 'agent_b'): string[] {
    if (!this.config) return [];
    return this.config[agentId].files;
  }

  getSharedFiles(): string[] {
    if (!this.config) return [];
    return this.config.shared.files;
  }

  async updateConfig(config: OwnershipConfig): Promise<ResultOrError<void>> {
    try {
      await writeFile(OWNERSHIP_PATH, JSON.stringify(config, null, 2), 'utf-8');
      this.config = config;
      return ok(undefined);
    } catch (e) {
      return err(new TaskError(`Failed to update ownership config: ${e instanceof Error ? e.message : 'Unknown error'}`, 'ownership'));
    }
  }

  validateFileAccess(agentId: 'agent_a' | 'agent_b', files: string[]): { allowed: string[]; denied: string[] } {
    const allowed: string[] = [];
    const denied: string[] = [];
    for (const file of files) {
      if (this.canModify(agentId, file)) {
        allowed.push(file);
      } else {
        denied.push(file);
      }
    }
    return { allowed, denied };
  }
}

export const ownershipRegistry = new OwnershipRegistry();