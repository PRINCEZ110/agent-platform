import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { resolve } from 'path';
import { ToolPermission } from '@tools/tool.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { generateId } from '@core/utils.js';
import { SafetyError } from '@core/errors.js';

const APPROVALS_DIR = resolve(process.cwd(), '.ai', 'approvals');

export interface ApprovalRequest {
  id: string;
  agentId: string;
  permission: ToolPermission;
  tool: string;
  context: Record<string, unknown>;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'denied';
  decidedAt?: Date;
  decidedBy?: string;
  reason?: string;
}

export class ApprovalGate {
  private requests = new Map<string, ApprovalRequest>();

  async initialize(): Promise<ResultOrError<void>> {
    try {
      await mkdir(APPROVALS_DIR, { recursive: true });
      await this.loadRequests();
      return ok(undefined);
    } catch (e) {
      return err(new SafetyError(`Failed to initialize approval gate: ${e instanceof Error ? e.message : 'Unknown error'}`, 'initialize', e instanceof Error ? e : undefined));
    }
  }

  private async loadRequests(): Promise<void> {
    try {
      const files = await readdir(APPROVALS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(resolve(APPROVALS_DIR, file), 'utf-8');
          const request = JSON.parse(content) as ApprovalRequest;
          request.requestedAt = new Date(request.requestedAt);
          request.decidedAt = request.decidedAt ? new Date(request.decidedAt) : undefined;
          this.requests.set(request.id, request);
        }
      }
    } catch {
      // Ignore
    }
  }

  async request(agentId: string, permission: ToolPermission, tool: string, context: Record<string, unknown>): Promise<ResultOrError<ApprovalRequest>> {
    try {
      const request: ApprovalRequest = {
        id: generateId('approval'),
        agentId,
        permission,
        tool,
        context,
        requestedAt: new Date(),
        status: 'pending'
      };

      this.requests.set(request.id, request);
      await this.persist(request);
      return ok(request);
    } catch (e) {
      return err(new SafetyError(`Failed to request approval: ${e instanceof Error ? e.message : 'Unknown error'}`, 'request', e instanceof Error ? e : undefined));
    }
  }

  async approve(requestId: string, decidedBy: string, reason?: string): Promise<ResultOrError<ApprovalRequest>> {
    const request = this.requests.get(requestId);
    if (!request) return err(new SafetyError(`Approval request not found: ${requestId}`, 'approve'));
    if (request.status !== 'pending') return err(new SafetyError(`Request already decided: ${request.status}`, 'approve'));

    request.status = 'approved';
    request.decidedAt = new Date();
    request.decidedBy = decidedBy;
    request.reason = reason;

    await this.persist(request);
    return ok(request);
  }

  async deny(requestId: string, decidedBy: string, reason?: string): Promise<ResultOrError<ApprovalRequest>> {
    const request = this.requests.get(requestId);
    if (!request) return err(new SafetyError(`Approval request not found: ${requestId}`, 'deny'));
    if (request.status !== 'pending') return err(new SafetyError(`Request already decided: ${request.status}`, 'deny'));

    request.status = 'denied';
    request.decidedAt = new Date();
    request.decidedBy = decidedBy;
    request.reason = reason;

    await this.persist(request);
    return ok(request);
  }

  async get(requestId: string): Promise<ApprovalRequest | undefined> {
    return this.requests.get(requestId);
  }

  async getPending(agentId?: string): Promise<ApprovalRequest[]> {
    return Array.from(this.requests.values())
      .filter(r => r.status === 'pending' && (!agentId || r.agentId === agentId))
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  }

  async waitForDecision(requestId: string, timeoutMs = 300000): Promise<ApprovalRequest> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const request = this.requests.get(requestId);
      if (request && request.status !== 'pending') return request;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Approval timeout for ${requestId}`);
  }

  private async persist(request: ApprovalRequest): Promise<void> {
    await writeFile(resolve(APPROVALS_DIR, `${request.id}.json`), JSON.stringify(request, null, 2), 'utf-8');
  }
}

export const approvalGate = new ApprovalGate();