import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [vue()],
  css: { postcss: { plugins: [] } },
  build: { outDir: fileURLToPath(new URL('../../deliverables/cms-studio-prototype/', import.meta.url)), emptyOutDir: true },
});
