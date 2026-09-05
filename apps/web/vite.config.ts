import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Two entry points: the application and the sandbox frame.
 *
 * In development the app is opened on http://localhost and the frame is served
 * from http://127.0.0.1 — the same server, but a different origin, so the
 * boundary the security model depends on is exercised locally rather than only
 * in production.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    headers: {
      // Isolation is a progressive enhancement, not a requirement: the runtime
      // negotiates its tier at boot. Enabled here so the editor gets the
      // isolated tier and the degraded path stays a deliberate test, not the
      // accidental default.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        frame: resolve(import.meta.dirname, 'frame.html'),
        embed: resolve(import.meta.dirname, 'embed.html'),
        sw: resolve(import.meta.dirname, 'src/sw.ts'),
      },
      output: {
        // A service worker must live at a stable URL: the browser looks for
        // the same path on every visit to decide whether it has changed. Every
        // other chunk keeps its content hash.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  worker: { format: 'es' },
});
