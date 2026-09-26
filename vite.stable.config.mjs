// A second dev server for headless tests while files are being edited: no HMR, no reloads.
// npx vite --config vite.stable.config.mjs   → http://localhost:5191
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5191, strictPort: true, open: false, hmr: false },
});
