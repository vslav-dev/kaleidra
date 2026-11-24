import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 4214: next free port after Glimmerfall's 4213.
  server: { port: 4214, strictPort: true, host: true },
  preview: { port: 4214, strictPort: true, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
