import { ResultOrError, ok } from '@core/types.js';

export interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
  critical: boolean;
  interval?: number;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, HealthCheckResult>;
  timestamp: Date;
  uptime: number;
}

export class HealthMonitor {
  private checks = new Map<string, HealthCheck>();
  private results = new Map<string, HealthCheckResult>();
  private startTime = Date.now();
  private intervals = new Map<string, NodeJS.Timeout>();

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
    if (check.interval) {
      this.intervals.set(check.name, setInterval(() => this.runCheck(check.name), check.interval));
    }
  }

  unregister(name: string): boolean {
    const interval = this.intervals.get(name);
    if (interval) clearInterval(interval);
    this.intervals.delete(name);
    return this.checks.delete(name);
  }

  async runCheck(name: string): Promise<HealthCheckResult | undefined> {
    const check = this.checks.get(name);
    if (!check) return undefined;

    try {
      const result = await check.check();
      result.timestamp = new Date();
      this.results.set(name, result);
      return result;
    } catch (e) {
      const result: HealthCheckResult = {
        status: 'unhealthy',
        message: e instanceof Error ? e.message : 'Check failed',
        timestamp: new Date()
      };
      this.results.set(name, result);
      return result;
    }
  }

  async runAllChecks(): Promise<HealthStatus> {
    const results = await Promise.all(
      Array.from(this.checks.keys()).map(name => this.runCheck(name))
    );

    const checkResults: Record<string, HealthCheckResult> = {};
    let overallStatus: HealthStatus['status'] = 'healthy';

    for (const [name, check] of this.checks) {
      const result = this.results.get(name);
      if (result) {
        checkResults[name] = result;
        if (result.status === 'unhealthy') {
          overallStatus = check.critical ? 'unhealthy' : 'degraded';
        } else if (result.status === 'degraded' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }
    }

    return {
      status: overallStatus,
      checks: checkResults,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime
    };
  }

  getLastResult(name: string): HealthCheckResult | undefined {
    return this.results.get(name);
  }

  getAllResults(): Record<string, HealthCheckResult> {
    return Object.fromEntries(this.results);
  }

  async getHealth(): Promise<HealthStatus> {
    return this.runAllChecks();
  }

  shutdown(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}

export function createHealthMonitor(): HealthMonitor {
  return new HealthMonitor();
}

export const healthMonitor = createHealthMonitor();

// Built-in checks
export function createDatabaseHealthCheck(name: string, check: () => Promise<boolean>): HealthCheck {
  return {
    name,
    critical: true,
    check: async () => ({
      status: await check() ? 'healthy' : 'unhealthy',
      timestamp: new Date()
    })
  };
}

export function createProviderHealthCheck(name: string, check: () => Promise<boolean>): HealthCheck {
  return {
    name,
    critical: false,
    check: async () => ({
      status: await check() ? 'healthy' : 'degraded',
      timestamp: new Date()
    })
  };
}

export function createDiskSpaceHealthCheck(thresholdPercent = 90): HealthCheck {
  return {
    name: 'disk_space',
    critical: true,
    check: async () => {
      // Simplified - in practice would check actual disk space
      return { status: 'healthy', timestamp: new Date() };
    }
  };
}

export function createMemoryHealthCheck(thresholdPercent = 90): HealthCheck {
  return {
    name: 'memory',
    critical: true,
    check: async () => {
      const usage = process.memoryUsage();
      const used = usage.heapUsed / (usage.heapTotal || 1);
      return {
        status: used > thresholdPercent / 100 ? 'degraded' : 'healthy',
        details: { heapUsedPercent: Math.round(used * 100) },
        timestamp: new Date()
      };
    }
  };
}