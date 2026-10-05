import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateId, sleep, retry, timeout, sanitizePath, truncate, deepClone, isRecord } from '../../src/core/utils.js';

beforeEach(() => {
  vi.useRealTimers();
});

describe('generateId', () => {
  it('builds prefixed ids of the form prefix-timestamp-random', () => {
    const id = generateId('msg');
    expect(id.startsWith('msg-')).toBe(true);
    expect(id.length).toBeGreaterThan('msg-'.length + 8);
  });

  it('omits the dash when no prefix is given', () => {
    expect(generateId()).not.toContain('-msg');
    expect(generateId().startsWith('-')).toBe(false);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateId('t')));
    expect(ids.size).toBe(500);
  });
});

describe('sleep', () => {
  it('resolves after the requested delay', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});

describe('retry', () => {
  it('returns immediately when the function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('yes');
    expect(await retry(fn, { retries: 3, delay: 1 })).toBe('yes');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error('flaky');
      return 'recovered';
    });
    expect(await retry(fn, { retries: 5, delay: 1 })).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the original error once retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retry(fn, { retries: 2, delay: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('timeout', () => {
  it('resolves when the promise settles in time', async () => {
    expect(await timeout(Promise.resolve('fast'), 1000)).toBe('fast');
  });

  it('rejects when the promise takes too long', async () => {
    const slow = new Promise(resolve => setTimeout(() => resolve('late'), 500));
    await expect(timeout(slow, 20)).rejects.toThrow('Operation timed out after 20ms');
  });
});

describe('sanitizePath', () => {
  it('returns a normalized path inside the root', () => {
    expect(sanitizePath('root/src/app.ts', 'root')).toBe('root/src/app.ts');
  });

  it('normalizes windows separators', () => {
    expect(sanitizePath('root\\src\\app.ts', 'root')).toBe('root/src/app.ts');
  });

  it('throws on path traversal outside the root', () => {
    expect(() => sanitizePath('../etc/passwd', 'root')).toThrow('Path traversal attempt');
    expect(() => sanitizePath('other/src.ts', 'root')).toThrow('Path traversal attempt');
  });
});

describe('truncate', () => {
  it('leaves short strings untouched', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('cuts long strings to maxLength with an ellipsis', () => {
    const out = truncate('a'.repeat(50), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('deepClone', () => {
  it('produces an equal but independent copy', () => {
    const original = { a: 1, nested: { b: [1, 2, 3] } };
    const clone = deepClone(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.nested).not.toBe(original.nested);
    clone.nested.b.push(4);
    expect(original.nested.b).toHaveLength(3);
  });

  it('drops non-JSON values (documented JSON semantics)', () => {
    const clone = deepClone({ fn: () => 1, d: new Date('2026-01-01T00:00:00.000Z') });
    expect(clone.fn).toBeUndefined();
    expect(clone.d).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('str')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});
