import { defineConfig } from 'vite'

// Orchestrator-owned (docs/OWNERSHIP.md). Blocks must not edit this file.
// Kept deliberately plain: tools/ssr.mjs boots this same config in middleware mode so the
// GL-free numeric channel (`npm run score`) loads the very TypeScript the browser runs.
export default defineConfig({
  // `host: true` binds every interface instead of loopback, which is what lets a phone on the
  // Tailscale mesh reach this at http://100.x.x.x:5178 — Vite's default is localhost-only, so the
  // connection was refused before it ever reached the app.
  //
  // `allowedHosts` is separate and also needed: Vite rejects a request whose Host header it does
  // not recognise (DNS-rebinding protection). A bare IP passes, but a Tailscale MagicDNS name like
  // `machine.tailXXXX.ts.net` does not, and fails with a blocked-host error rather than a refusal —
  // a different symptom for the same trip.
  //
  // This binds the LAN too, not only Tailscale. On a home network that is the usual trade for
  // testing on a phone; it is a dev server and should not be run on a network you do not trust.
  server: {
    port: 5178,
    strictPort: true,
    host: true,
    allowedHosts: ['.ts.net'],
  },
  preview: { port: 5178, strictPort: true, host: true, allowedHosts: ['.ts.net'] },
  build: {
    target: 'es2022',
    sourcemap: true,
    // A single figure + dojo: one chunk beats waterfall requests on first paint.
    chunkSizeWarningLimit: 1500,
  },
  // Deterministic asset URLs keep captured-frame paths stable across runs.
  assetsInclude: ['**/*.ktx2'],
})
