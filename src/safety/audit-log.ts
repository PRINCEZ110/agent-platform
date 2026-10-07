import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { resolve } from 'path';
import { ToolPermission } from '@tools/tool.js';
import { ResultOrError, ok, err } from '@core/types.js';
import { generateId } from '@core/utils.js';
import { SafetyError } from '@core/errors.js';

const AUDIT_DIR = resolve(process.cwd(), '.ai', 'audit');

export interface AuditEntry {
  id: string;
  timestamp: Date;
  agentId: string;
  action: string;
  resource: string;
  permissions: ToolPermission[];
  outcome: 'success' | 'denied' | 'approved' | 'error';
  details: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries = 10000;

  async initialize(): Promise<ResultOrError<void>> {
    try {
      await mkdir(AUDIT_DIR, { recursive: true });
      await this.loadEntries();
      return ok(undefined);
    } catch (e) {
      return err(new SafetyError(`Failed to initialize audit log: ${e instanceof Error ? e.message : 'Unknown error'}`, 'initialize', e instanceof Error ? e : undefined));
    }
  }

  private async loadEntries(): Promise<void> {
    try {
      const files = await readdir(AUDIT_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(resolve(AUDIT_DIR, file), 'utf-8');
          const entry = JSON.parse(content) as AuditEntry;
          entry.timestamp = new Date(entry.timestamp);
          this.entries.push(entry);
        }
      }
      this.entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch {
      // Ignore
    }
  }

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<ResultOrError<void>> {
    try {
      const auditEntry: AuditEntry = {
        ...entry,
        id: generateId('audit'),
        timestamp: new Date()
      };

      this.entries.push(auditEntry);
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }

      await this.persist(auditEntry);
      return ok(undefined);
    } catch (e) {
      return err(new SafetyError(`Failed to log audit entry: ${e instanceof Error ? e.message : 'Unknown error'}`, 'log', e instanceof Error ? e : undefined));
    }
  }

  async query(filters?: {
    agentId?: string;
    action?: string;
    resource?: string;
    outcome?: AuditEntry['outcome'];
    riskLevel?: AuditEntry['riskLevel'];
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<AuditEntry[]> {
    let results = this.entries;

    if (filters) {
      if (filters.agentId) results = results.filter(e => e.agentId === filters.agentId);
      if (filters.action) results = results.filter(e => e.action === filters.action);
      if (filters.resource) results = results.filter(e => e.resource === filters.resource);
      if (filters.outcome) results = results.filter(e => e.outcome === filters.outcome);
      if (filters.riskLevel) results = results.filter(e => e.riskLevel === filters.riskLevel);
      if (filters.since) results = results.filter(e => e.timestamp >= (filters.since as Date));
      if (filters.until) results = results.filter(e => e.timestamp <= (filters.until as Date));
    }

    return results
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, filters?.limit ?? 100);
  }

  async getRiskSummary(agentId?: string, since?: Date): Promise<Record<AuditEntry['riskLevel'], number>> {
    const entries = await this.query({ agentId, since });
    const summary: Record<AuditEntry['riskLevel'], number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const entry of entries) {
      summary[entry.riskLevel]++;
    }
    return summary;
  }

  async getTopActions(agentId?: string, limit = 10): Promise<Array<{ action: string; count: number }>> {
    const entries = await this.query({ agentId });
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      counts[entry.action] = (counts[entry.action] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private async persist(entry: AuditEntry): Promise<void> {
    const dateParts = entry.timestamp.toISOString().split('T');
    const date = dateParts[0] ?? new Date().toISOString().split('T')[0] ?? '';
    const dir = resolve(AUDIT_DIR, date);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2), 'utf-8');
  }
}

export const auditLog = new AuditLog();