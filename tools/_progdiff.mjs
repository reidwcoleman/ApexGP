// Shader programs in a live race, by material family, for two servers side by side.
//   node tools/_progdiff.mjs <portA> <portB>
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [A, B] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
async function fam(port) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(`http://localhost:${port}/?track=monza&demo=race&cam=chase&skip=5`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  const r = await p.evaluate(() => {
    const out = {};
    for (const q of window.__game.gfx.renderer.info.programs) { const k = q.name || (q.cacheKey.split(',')[0] || '?').slice(0, 40); out[k] = (out[k] ?? 0) + 1; }
    return { total: window.__game.gfx.renderer.info.programs.length, out };
  });
  await p.close();
  return r;
}
const ra = await fam(A), rb = await fam(B);
console.log('total', A, ra.total, B, rb.total);
const keys = new Set([...Object.keys(ra.out), ...Object.keys(rb.out)]);
for (const k of [...keys].sort((x, y) => (rb.out[y] ?? 0) - (ra.out[y] ?? 0) - ((rb.out[x] ?? 0) - (ra.out[x] ?? 0)))) if ((ra.out[k] ?? 0) !== (rb.out[k] ?? 0)) console.log(String((rb.out[k] ?? 0) - (ra.out[k] ?? 0)).padStart(4), k, ra.out[k] ?? 0, '->', rb.out[k] ?? 0);
await b.close();
