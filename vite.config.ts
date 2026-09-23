import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  // relative asset URLs in the build so it works from any sub-path (GitHub Pages serves it at /ApexGP/)
  base: command === 'build' ? './' : '/',
  server: { port: 5190, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html') },
    },
  },
}));
