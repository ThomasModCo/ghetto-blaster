import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html', catalog: 'asset-catalog/index.html' } },
  },
  server: { port: 5173 },
});
