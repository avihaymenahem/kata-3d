import { defineConfig } from 'vitest/config'

// Orchestrator-owned (docs/OWNERSHIP.md). Blocks must not edit this file.
// Node environment on purpose: the whole pose/metric path is GL-free and must stay unit-testable
// without a browser. Playwright specs under tests/e2e are excluded — they run via `npm run shots`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    testTimeout: 30_000,
    reporters: ['default'],
  },
})
