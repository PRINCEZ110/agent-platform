import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/', '**/*.d.ts', '**/*.config.*', 'src/_excluded/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    },
    globals: true,
    setupFiles: ['./tests/setup.ts']
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@providers': path.resolve(__dirname, 'src/providers'),
      '@tools': path.resolve(__dirname, 'src/tools'),
      '@git': path.resolve(__dirname, 'src/git'),
      '@comm': path.resolve(__dirname, 'src/comm'),
      '@memory': path.resolve(__dirname, 'src/memory'),
      '@tasks': path.resolve(__dirname, 'src/tasks'),
      '@safety': path.resolve(__dirname, 'src/safety'),
      '@obs': path.resolve(__dirname, 'src/obs'),
      '@agents': path.resolve(__dirname, 'src/agents'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@app': path.resolve(__dirname, 'src/app')
    }
  }
});