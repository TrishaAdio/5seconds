import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    // three.js is large by nature; raise the limit so the build stays warning-free.
    chunkSizeWarningLimit: 1500,
  },
});
