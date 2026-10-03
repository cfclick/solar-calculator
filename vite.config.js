import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'client',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.PORT || 3080}` },
    // The client imports shared geometry from server/engine.
    fs: { allow: [projectRoot] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
