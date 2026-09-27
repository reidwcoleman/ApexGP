import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  // relative asset URLs in the build so it works from any sub-path (GitHub Pages serves it at /ApexGP/)
  base: command === 'build' ? './' : '/',
  // keys the generated-image cache (src/core/pixelCache.ts): every build repaints once
  define: { __BUILD__: JSON.stringify(command === 'build' ? Date.now().toString(36) : 'dev') },
  server: { port: 5190, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html') },
    },
  },
}));
