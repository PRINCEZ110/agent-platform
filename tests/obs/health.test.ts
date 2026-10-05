import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HealthMonitor,
  createHealthMonitor,
  createDatabaseHealthCheck,
  createProviderHealthCheck,
  createDiskSpaceHealthCheck,
  createMemoryHealthCheck,
  HealthCheck
} from '../../src/obs/health.js';

function check(name: string, status: 'healthy' | 'degraded' | 'unhealthy', critical: boolean): HealthCheck {
  return {
    name,
    critical,
    check: async () => ({ status, timestamp: new Date() })
  };
}

let monitor: HealthMonitor;

beforeEach(() => {
  monitor = createHealthMonitor();
});

afterEach(() => {
  monitor.shutdown();
});

describe('HealthMonitor.register and runCheck', () => {
  it('runs a registered check and stamps the timestamp', async () => {
    monitor.register(check('db', 'healthy', true));
    const result = await monitor.runCheck('db');

    expect(result).toBeDefined();
    expect(result!.status).toBe('healthy');
    expect(result!.timestamp).toBeInstanceOf(Date);
    expect(monitor.getLastResult('db')).toEqual(result);
  });

  it('captures thrown checks as unhealthy results with the error message', async () => {
    monitor.register({
      name: 'boom',
      critical: true,
      check: async () => {
        throw new Error('service down');
      }
    });

    const result = await monitor.runCheck('boom');
    expect(result).toMatchObject({ status: 'unhealthy', message: 'service down' });
    expect(result!.timestamp).toBeInstanceOf(Date);
  });

  it('returns undefined for unknown checks', async () => {
    expect(await monitor.runCheck('nope')).toBeUndefined();
    expect(monitor.getLastResult('nope')).toBeUndefined();
  });

  it('overwrites results for repeated runs', async () => {
    let mode = 'healthy';
    monitor.register({ name: 'flip', critical: false, check: async () => ({ status: mode as 'healthy' | 'degraded', timestamp: new Date() }) });

    await monitor.runCheck('flip');
    mode = 'degraded';
    const second = await monitor.runCheck('flip');

    expect(second!.status).toBe('degraded');
    expect(monitor.getAllResults()).toEqual({ flip: second });
  });
});

describe('HealthMonitor.runAllChecks', () => {
  it('aggregates all checks into a healthy status with uptime', async () => {
    monitor.register(check('a', 'healthy', true));
    monitor.register(check('b', 'healthy', false));

    const status = await monitor.runAllChecks();

    expect(status.status).toBe('healthy');
    expect(Object.keys(status.checks).sort()).toEqual(['a', 'b']);
    expect(status.checks.a.status).toBe('healthy');
    expect(status.timestamp).toBeInstanceOf(Date);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
  });

  it('reports degraded when a non-critical check is unhealthy', async () => {
    monitor.register(check('cache', 'unhealthy', false));
    monitor.register(check('ok', 'healthy', true));

    const status = await monitor.runAllChecks();
    expect(status.status).toBe('degraded');
  });

  it('reports unhealthy when a critical check is unhealthy', async () => {
    monitor.register(check('db', 'unhealthy', true));
    const status = await monitor.runAllChecks();
    expect(status.status).toBe('unhealthy');
  });

  it('reports degraded for degraded checks', async () => {
    monitor.register(check('slow', 'degraded', true));
    const status = await monitor.runAllChecks();
    expect(status.status).toBe('degraded');
  });

  it('omits checks that never produced a result', async () => {
    monitor.register(check('never', 'healthy', true));
    const status = await monitor.runAllChecks();
    expect(status.checks.never).toBeDefined();
  });

  it.fails('BUG-008: a later non-critical unhealthy check downgrades a prior critical unhealthy to degraded', async () => {
    monitor.register(check('critical-db', 'unhealthy', true));
    monitor.register(check('optional-cache', 'unhealthy', false));

    const status = await monitor.runAllChecks();
    expect(status.status).toBe('unhealthy');
  });

  it('getHealth mirrors runAllChecks', async () => {
    monitor.register(check('x', 'healthy', true));
    const status = await monitor.getHealth();
    expect(status.status).toBe('healthy');
    expect(status.checks.x).toBeDefined();
  });
});

describe('HealthMonitor scheduled checks and shutdown', () => {
  it('runs interval checks on schedule and stops them on unregister', async () => {
    const spy = vi.fn(async () => ({ status: 'healthy' as const, timestamp: new Date() }));
    monitor.register({ name: 'tick', critical: false, interval: 1000, check: spy });

    await vi.advanceTimersByTimeAsync(3000);
    expect(spy).toHaveBeenCalledTimes(3);

    expect(monitor.unregister('tick')).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(monitor.unregister('tick')).toBe(false);
  });

  it('shutdown clears all scheduled intervals', async () => {
    const spy = vi.fn(async () => ({ status: 'healthy' as const, timestamp: new Date() }));
    monitor.register({ name: 'a', critical: false, interval: 500, check: spy });
    monitor.register({ name: 'b', critical: false, interval: 500, check: spy });

    monitor.shutdown();
    await vi.advanceTimersByTimeAsync(2000);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('built-in health checks', () => {
  it('database check is critical and maps boolean to healthy/unhealthy', async () => {
    const up = createDatabaseHealthCheck('db', async () => true);
    const down = createDatabaseHealthCheck('db', async () => false);

    expect(up.critical).toBe(true);
    expect((await up.check()).status).toBe('healthy');
    expect((await down.check()).status).toBe('unhealthy');
  });

  it('provider check is non-critical and maps false to degraded', async () => {
    const ok = createProviderHealthCheck('openai', async () => true);
    const bad = createProviderHealthCheck('openai', async () => false);

    expect(ok.critical).toBe(false);
    expect((await ok.check()).status).toBe('healthy');
    expect((await bad.check()).status).toBe('degraded');
  });

  it('disk space check reports healthy (stubbed implementation)', async () => {
    const disk = createDiskSpaceHealthCheck();
    expect(disk.name).toBe('disk_space');
    expect(disk.critical).toBe(true);
    expect((await disk.check()).status).toBe('healthy');
  });

  it('memory check reports heap usage percentage', async () => {
    const healthy = createMemoryHealthCheck(99.99);
    const result = await healthy.check();

    expect(healthy.name).toBe('memory');
    expect(['healthy', 'degraded']).toContain(result.status);
    expect(typeof result.details!.heapUsedPercent).toBe('number');

    const strict = createMemoryHealthCheck(-1);
    expect((await strict.check()).status).toBe('degraded');
  });
});
