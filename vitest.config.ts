import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Scope test discovery to our own source trees. Without this, vitest
    // walks every sibling .claude/worktrees/*/node_modules and tries to
    // execute third-party package test files (pino, thread-stream,
    // pdfme/pdf-lib…), which all fail because their devDependencies
    // aren't installed in our tree.
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
      'server/**/*.test.ts',
      'server/**/*.spec.ts',
      'client/src/**/*.test.ts',
      'client/src/**/*.spec.ts',
      'shared/**/*.test.ts',
      'shared/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'backend', 'frontend', '.claude/**'],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', 'server/vite.ts'],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
});
