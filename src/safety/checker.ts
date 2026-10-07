import { ToolPermission } from '@tools/tool.js';
import { permissionsManager } from './permissions.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { SafetyError } from '@core/errors.js';

export class PermissionChecker {
  async check(agentId: string, permissions: ToolPermission[]): Promise<ResultOrError<void>> {
    await permissionsManager.initialize();

    for (const permission of permissions) {
      if (!permissionsManager.hasPermission(agentId, permission)) {
        return err(new SafetyError(`Permission denied: ${permission}`, permission));
      }
    }

    return ok(undefined);
  }

  async checkAndRequireApproval(agentId: string, permissions: ToolPermission[]): Promise<ResultOrError<ToolPermission[]>> {
    await permissionsManager.initialize();

    const missing: ToolPermission[] = [];
    const needsApproval: ToolPermission[] = [];

    for (const permission of permissions) {
      if (!permissionsManager.hasPermission(agentId, permission)) {
        missing.push(permission);
      } else if (permissionsManager.requiresApproval(agentId, permission)) {
        needsApproval.push(permission);
      }
    }

    if (missing.length > 0) {
      return err(new SafetyError(`Missing permissions: ${missing.join(', ')}`, missing[0] as ToolPermission));
    }

    return ok(needsApproval);
  }

  async checkResourceLimit(agentId: string, resource: string, value: number): Promise<ResultOrError<void>> {
    await permissionsManager.initialize();

    const allowed = permissionsManager.checkResourceLimits(agentId, resource as any, value);
    if (!allowed) {
      return err(new SafetyError(`Resource limit exceeded: ${resource}`, resource));
    }

    return ok(undefined);
  }
}

export const permissionChecker = new PermissionChecker();