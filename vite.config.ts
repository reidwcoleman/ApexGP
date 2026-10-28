import { defineConfig } from 'vite';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

/**
 * The generated-image cache's key (src/core/pixelCache.ts): a hash of what makes those images — the
 * painters (liveries, the fan atlas, the ground scans, the sight-line grid) with everything they
 * import, the avatars and ground textures they read, the three.js they draw with — not the build
 * time: a deploy that doesn't touch them no longer repaints everything (~2–4 s) for returning players.
 */
function pixelBuild(): string {
  const h = createHash('sha1');
  const seen = new Set<string>();
  const walk = (f: string) => {
    if (seen.has(f) || !fs.existsSync(f)) return;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    h.update(relative(__dirname, f)).update(src);
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) walk(resolve(dirname(f), m[1] ?? m[2]));
  };
  for (const e of ['src/car/Livery.ts', 'src/people/Crowd.ts', 'src/world/trackside/textures.ts', 'src/game/Sightlines.ts', 'index.html']) walk(resolve(__dirname, e));
  for (const d of ['public/models/rocketbox', 'public/textures'])
    for (const f of fs.readdirSync(resolve(__dirname, d)).sort()) h.update(f).update(fs.readFileSync(resolve(__dirname, d, f)));
  h.update(JSON.parse(fs.readFileSync(resolve(__dirname, 'node_modules/three/package.json'), 'utf8')).version);
  return h.digest('hex').slice(0, 10);
}

export default defineConfig(({ command }) => ({
  // relative asset URLs in the build so it works from any sub-path (GitHub Pages serves it at /ApexGP/)
  base: command === 'build' ? './' : '/',
  // keys the generated-image cache (src/core/pixelCache.ts): repainted once when what paints it changes
  define: { __BUILD__: JSON.stringify(command === 'build' ? pixelBuild() : 'dev') },
  server: { port: 5190, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), miami: resolve(__dirname, 'miami.html'), marbles: resolve(__dirname, 'marbles.html'), boost: resolve(__dirname, 'boost.html') },
    },
  },
}));
