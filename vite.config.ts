import { defineConfig } from 'vite'

// Orchestrator-owned (docs/OWNERSHIP.md). Blocks must not edit this file.
// Kept deliberately plain: tools/ssr.mjs boots this same config in middleware mode so the
// GL-free numeric channel (`npm run score`) loads the very TypeScript the browser runs.
export default defineConfig({
  server: { port: 5178, strictPort: true },
  preview: { port: 5178, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // A single figure + dojo: one chunk beats waterfall requests on first paint.
    chunkSizeWarningLimit: 1500,
  },
  // Deterministic asset URLs keep captured-frame paths stable across runs.
  assetsInclude: ['**/*.ktx2'],
})
