export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}${prefix ? '-' : ''}${timestamp}-${random}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function retry<T>(
  fn: () => Promise<T>,
  options: { retries: number; delay: number; backoff?: number } = { retries: 3, delay: 1000 }
): Promise<T> {
  const { retries, delay, backoff = 2 } = options;
  return fn().catch(async error => {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, { retries: retries - 1, delay: delay * backoff, backoff });
  });
}

export function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    )
  ]);
}

export function sanitizePath(path: string, root: string): string {
  const resolved = path.replace(/\\/g, '/');
  const rootResolved = root.replace(/\\/g, '/');
  if (!resolved.startsWith(rootResolved)) {
    throw new Error(`Path traversal attempt: ${path}`);
  }
  return resolved;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}