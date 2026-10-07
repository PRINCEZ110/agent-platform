import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { ToolPermission } from '@tools/tool.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { SafetyError } from '@core/errors.js';

const PERMISSIONS_DIR = resolve(process.cwd(), '.ai', 'permissions');

export interface PermissionSet {
  agentId: string;
  permissions: ToolPermission[];
  resourceLimits: {
    maxFileSize: number;
    maxConcurrentTools: number;
    maxExecutionTime: number;
    allowedPaths: string[];
    deniedPaths: string[];
    allowedCommands: string[];
    deniedCommands: string[];
    allowedDomains: string[];
    deniedDomains: string[];
  };
  approvalRequired: ToolPermission[];
}

export const DEFAULT_PERMISSIONS: Record<'agent_a' | 'agent_b', PermissionSet> = {
  agent_a: {
    agentId: 'agent_a',
    permissions: [
      'fs.read', 'fs.write', 'fs.delete', 'fs.execute',
      'terminal.exec', 'terminal.read',
      'git.read', 'git.write', 'git.push',
      'network.http', 'network.websocket',
      'process.spawn'
    ],
    resourceLimits: {
      maxFileSize: 10 * 1024 * 1024,
      maxConcurrentTools: 5,
      maxExecutionTime: 300000,
      allowedPaths: ['**'],
      deniedPaths: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      allowedCommands: ['*'],
      deniedCommands: ['rm -rf /', 'mkfs', 'dd', 'shutdown', 'reboot'],
      allowedDomains: ['*'],
      deniedDomains: []
    },
    approvalRequired: ['fs.delete', 'git.push', 'process.spawn']
  },
  agent_b: {
    agentId: 'agent_b',
    permissions: [
      'fs.read', 'fs.write',
      'terminal.exec', 'terminal.read',
      'git.read', 'git.write',
      'network.http',
      'process.spawn'
    ],
    resourceLimits: {
      maxFileSize: 5 * 1024 * 1024,
      maxConcurrentTools: 3,
      maxExecutionTime: 120000,
      allowedPaths: ['src/agents/specialist/**', 'tests/**', 'docs/**', 'examples/**', 'scripts/**'],
      deniedPaths: ['**/node_modules/**', '**/.git/**', '**/dist/**', 'src/core/**', 'src/providers/**', 'src/tools/**', 'src/git/**', 'src/comm/**', 'src/memory/**', 'src/tasks/**', 'src/safety/**', 'src/obs/**', 'src/agents/lead/**'],
      allowedCommands: ['npm', 'npx', 'git', 'tsc', 'vitest', 'eslint'],
      deniedCommands: ['rm -rf', 'sudo', 'chmod', 'chown', 'kill', 'pkill'],
      allowedDomains: ['api.github.com', 'registry.npmjs.org'],
      deniedDomains: []
    },
    approvalRequired: ['fs.delete', 'git.push', 'process.spawn']
  }
};

export class PermissionsManager {
  private permissions = new Map<string, PermissionSet>();

  async initialize(): Promise<ResultOrError<void>> {
    try {
      await mkdir(PERMISSIONS_DIR, { recursive: true });
      await this.loadPermissions();
      return ok(undefined);
    } catch (e) {
      return err(new SafetyError(`Failed to initialize permissions: ${e instanceof Error ? e.message : 'Unknown error'}`, 'initialize', e instanceof Error ? e : undefined));
    }
  }

  private async loadPermissions(): Promise<void> {
    for (const agentId of ['agent_a', 'agent_b'] as const) {
      try {
        const content = await readFile(resolve(PERMISSIONS_DIR, `${agentId}.json`), 'utf-8');
        this.permissions.set(agentId, JSON.parse(content));
      } catch {
        this.permissions.set(agentId, DEFAULT_PERMISSIONS[agentId]);
        await this.savePermissions(agentId);
      }
    }
  }

  async savePermissions(agentId: string): Promise<ResultOrError<void>> {
    try {
      const perms = this.permissions.get(agentId);
      if (!perms) return err(new SafetyError(`Permissions not found for ${agentId}`, 'savePermissions'));
      await writeFile(resolve(PERMISSIONS_DIR, `${agentId}.json`), JSON.stringify(perms, null, 2), 'utf-8');
      return ok(undefined);
    } catch (e) {
      return err(new SafetyError(`Failed to save permissions: ${e instanceof Error ? e.message : 'Unknown error'}`, 'savePermissions', e instanceof Error ? e : undefined));
    }
  }

  getPermissions(agentId: string): PermissionSet | undefined {
    return this.permissions.get(agentId);
  }

  hasPermission(agentId: string, permission: ToolPermission): boolean {
    const perms = this.permissions.get(agentId);
    if (!perms) return false;
    return perms.permissions.includes(permission);
  }

  requiresApproval(agentId: string, permission: ToolPermission): boolean {
    const perms = this.permissions.get(agentId);
    if (!perms) return true;
    return perms.approvalRequired.includes(permission);
  }

  checkResourceLimits(agentId: string, resource: keyof PermissionSet['resourceLimits'], value: unknown): boolean {
    const perms = this.permissions.get(agentId);
    if (!perms) return false;
    const limit = perms.resourceLimits[resource];
    if (Array.isArray(limit)) {
      return limit.includes(value as string);
    }
    if (typeof limit === 'number' && typeof value === 'number') {
      return value <= limit;
    }
    return true;
  }

  async grantPermission(agentId: string, permission: ToolPermission): Promise<ResultOrError<void>> {
    const perms = this.permissions.get(agentId);
    if (!perms) return err(new SafetyError(`Agent not found: ${agentId}`, 'grantPermission'));
    if (!perms.permissions.includes(permission)) {
      perms.permissions.push(permission);
      return this.savePermissions(agentId);
    }
    return ok(undefined);
  }

  async revokePermission(agentId: string, permission: ToolPermission): Promise<ResultOrError<void>> {
    const perms = this.permissions.get(agentId);
    if (!perms) return err(new SafetyError(`Agent not found: ${agentId}`, 'revokePermission'));
    perms.permissions = perms.permissions.filter(p => p !== permission);
    return this.savePermissions(agentId);
  }

  async setResourceLimit(agentId: string, resource: keyof PermissionSet['resourceLimits'], value: unknown): Promise<ResultOrError<void>> {
    const perms = this.permissions.get(agentId);
    if (!perms) return err(new SafetyError(`Agent not found: ${agentId}`, 'setResourceLimit'));
    (perms.resourceLimits as any)[resource] = value;
    return this.savePermissions(agentId);
  }
}

export const permissionsManager = new PermissionsManager();