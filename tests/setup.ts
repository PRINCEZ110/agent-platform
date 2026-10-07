import { beforeAll, afterAll, vi } from 'vitest';

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';