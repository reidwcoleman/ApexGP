// Hash every team's painted livery (map + mask) — proves a Livery.ts refactor is pixel-identical.
// node tools/liveryhash.mjs [port]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '5191';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://localhost:${port}/?track=melbourne`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const out = await page.evaluate(async () => {
  const L = await import('/src/car/Livery.ts');
  const T = await import('/src/race/Teams.ts');
  await document.fonts.ready;
  const h = (img) => {
    const c = img.getContext('2d', { willReadFrequently: true });
    const d = c.getImageData(0, 0, img.width, img.height).data;
    let a = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i += 3) a = Math.imul(a ^ d[i], 16777619) >>> 0;
    return a.toString(16);
  };
  const r = {};
  for (const t of T.TEAMS) {
    const s = L.acquireLivery(t);
    r[t.id] = h(s.map.image) + ' ' + h(s.mask.image);
  }
  return r;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
