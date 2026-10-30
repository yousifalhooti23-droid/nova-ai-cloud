import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * The browser only ever talks to same-origin `/api/*`; Vite proxies those to the
 * Worker. That keeps API keys out of the frontend bundle by construction — there
 * is no backend URL to leak, and no CORS configuration needed in development.
 */
const WORKER_URL = process.env.NOVA_WORKER_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@nova/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The preview host is dynamic (*.e2b.app); allow any host header in dev.
    allowedHosts: true,
    strictPort: false,
    proxy: {
      '/api': { target: WORKER_URL, changeOrigin: false, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          editor: ['@codemirror/state', '@codemirror/view', '@codemirror/language'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
});
