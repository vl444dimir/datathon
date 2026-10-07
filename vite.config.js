import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
    fs: { strict: true, allow: ['web'] },
  },
  preview: { strictPort: true },
});
