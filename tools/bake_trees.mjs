// The game's trees from scanned CC0 trees (Poly Haven; tools/trees_fetch.py → assets-src/trees/).
// Runs the bake page (src/dev/treebake.ts) in headless Chrome against a dev server and writes
// public/trees/: trees.json (manifest), trees.bin (near LOD geometry), imp_c/imp_n.webp (impostor
// frames), leaf_c/leaf_n.webp (real leaf sprays for the near cards), bark.webp.
//
//   python3 tools/trees_fetch.py
//   npx vite --config vite.stable.config.mjs &   (port 5191)
//   node tools/bake_trees.mjs [--port 5191] [--preview id,id] [--only id,id]
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'trees');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5191');

/**
 * The prototypes: id, source asset + root node, the game species they stand in for, target height,
 * a base cut (the island trees grow out of a lump of rock), stretch, leaf sprays (cards) per LOD
 * (LOD2 also casts every near tree's shadow), trunk + limb triangle budgets per LOD, and how far the cards turn toward the camera (bb).
 */
export const SPECS = [
  { id: 'jacaranda', asset: 'jacaranda_tree', node: 0, species: 'broad', H: 21, cut: 0.35, K: [460, 160, 56], wood: [2000, 560, 220], bb: 0.6 },
  { id: 'dome', asset: 'island_tree_02', node: 0, species: 'broad', H: 17, sink: 0.25, cut: 0.4, K: [430, 150, 52], wood: [1900, 520, 200], bb: 0.6, leafScale: 0.6 },
  { id: 'gnarl', asset: 'island_tree_01', node: 0, species: 'broad', H: 18, sink: 0.3, cut: 0.4, K: [430, 150, 52], wood: [1900, 520, 200], bb: 0.6, leafScale: 0.6 },
  { id: 'umbrella', asset: 'tree_small_02', node: 0, species: 'umbrella', H: 11, cut: 0.4, K: [340, 120, 44], wood: [1500, 420, 170], bb: 0.6, leafScale: 0.75 },
  { id: 'poplar', asset: 'island_tree_02', node: 0, species: 'poplar', H: 26, sink: 0.25, cut: 0.35, stretch: [0.3, 1, 0.3], K: [420, 140, 50], wood: [1200, 320, 130], bb: 0.6 },
  // (the firs' twig cards are thin at a distance: a low alpha cut keeps the dense dark spruce look;
  // their sprays are stretches of bough lying in the bough's own drooping plane — mostly fixed
  // planes, so the crown reads as layered boughs from below)
  { id: 'spruce_a', asset: 'fir_sapling_medium', node: 0, species: 'spruce', H: 24, cut: 0.12, alphaGain: 1.8, stretch: [0.8, 1, 0.8], K: [400, 125, 46], wood: [1100, 300, 120], bb: 0.3, cardScale: 1.08 },
  { id: 'fir_a', asset: 'fir_tree_01', node: 0, species: 'spruce', H: 28, cut: 0.14, alphaGain: 1.8, K: [410, 130, 46], wood: [1400, 380, 150], bb: 0.3, cardScale: 1.08 },
  { id: 'fir_b', asset: 'fir_tree_01', node: 1, species: 'spruce', H: 25, cut: 0.14, alphaGain: 1.8, K: [400, 125, 45], wood: [1300, 360, 140], bb: 0.3, cardScale: 1.08 },
  { id: 'fir_c', asset: 'fir_tree_01', node: 2, species: 'spruce', H: 22, cut: 0.14, alphaGain: 1.8, K: [370, 115, 42], wood: [1200, 340, 130], bb: 0.3, cardScale: 1.08 },
  { id: 'shrub_a', asset: 'searsia_lucida', node: 0, species: 'shrub', H: 3.4, K: [48, 18, 9], wood: [260, 80, 36], bb: 0.6 },
  { id: 'shrub_b', asset: 'searsia_lucida', node: 1, species: 'shrub', H: 2.9, K: [42, 16, 8], wood: [230, 70, 32], bb: 0.6 },
  { id: 'shrub_c', asset: 'searsia_lucida', node: 2, species: 'shrub', H: 2.5, K: [38, 14, 8], wood: [200, 64, 30], bb: 0.6 },
];

/**
 * PNG → WebP. Colour maps lossy at full size; the normal maps at half size (lighting detail, not
 * silhouette: a quarter of the bytes). -exact keeps the dilated colour under transparent texels
 * (mip / bilinear bleed); alpha is lossless (cut-out / AO).
 */
async function encode(f, src) {
  const dst = path.join(OUT, f.replace('.png', '.webp'));
  const nrm = f.startsWith('imp_n') || f.startsWith('leaf_n');
  // (the leaf atlas a little lower: it is seen minified on small cards, never full size)
  const a = ['-quiet', '-q', f.startsWith('leaf_n') ? '78' : nrm ? '85' : f.startsWith('leaf') ? '80' : '88', '-alpha_q', '100', '-exact', '-m', '6'];
  if (nrm) {
    const m = JSON.parse(fs.readFileSync(path.join(OUT, 'trees.json'), 'utf8'));
    const [w, h] = f.startsWith('imp') ? [m.impostor.frames * m.impostor.cell, m.impostor.rows * m.impostor.cell] : [m.leaf.cols * m.leaf.cell, m.leaf.rows * m.leaf.cell];
    a.push('-resize', String(w / 2), String(h / 2));
  }
  await promisify(execFile)('cwebp', [...a, src, '-o', dst]);
  console.log(f, '→', path.basename(dst), (fs.statSync(dst).size / 1024).toFixed(0), 'KB');
}

if (args.includes('--encode')) {
  // re-encode the last bake's PNGs (assets-src/trees/*.png) without baking again
  await Promise.all(['imp_c.png', 'imp_n.png', 'leaf_c.png', 'leaf_n.png', 'bark.png'].map((f) => encode(f, path.join(ROOT, 'assets-src', 'trees', f))));
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=8192'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text().slice(0, 400)}`));
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.setDefaultTimeout(1800000);
await page.goto(`http://localhost:${port}/src/dev/treebake.html`, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });

const only = opt('only', null)?.split(',');
const specs = only ? SPECS.filter((s) => only.includes(s.id)) : SPECS;
const prev = opt('preview', null);
if (prev) {
  const dir = opt('out', path.join(ROOT, 'assets-src', 'trees', 'preview'));
  fs.mkdirSync(dir, { recursive: true });
  for (const id of prev.split(',')) {
    const spec = SPECS.find((s) => s.id === id);
    const b64 = await page.evaluate((s) => window.__treePreview(s), spec);
    fs.writeFileSync(path.join(dir, `${id}.png`), Buffer.from(b64, 'base64'));
    console.log('preview', path.join(dir, `${id}.png`));
  }
} else {
  const t0 = Date.now();
  const r = await page.evaluate((s) => window.__treeBake(s), specs);
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync('/tmp/treebake-');
  fs.writeFileSync(path.join(OUT, 'trees.json'), JSON.stringify(r.manifest, null, 1));
  for (const l of r.log) console.log('  ', l);
  await Promise.all(
    Object.entries(r.files).map(async ([f, b64]) => {
      const buf = Buffer.from(b64, 'base64');
      if (!f.endsWith('.png')) {
        fs.writeFileSync(path.join(OUT, f), buf);
        console.log(f, (buf.length / 1024).toFixed(0), 'KB');
        return;
      }
      const src = path.join(tmp, f);
      fs.writeFileSync(src, buf);
      fs.copyFileSync(src, path.join(ROOT, 'assets-src', 'trees', f));
      await encode(f, src);
    }),
  );
  console.log(`baked ${specs.length} trees in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
