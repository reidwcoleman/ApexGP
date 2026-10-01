// Mean / std of the procedural asphalt texture's packed channels (tools/build_asphalt.py matches the scan to them).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();

await page.goto('http://localhost:5191/package.json');
console.log(await page.evaluate(async () => {
  const m = await import('http://localhost:5191/src/world/trackside/textures.ts');
  const t0 = performance.now();
  const g = m.makeGroundTextures(8);
  const dt = performance.now() - t0;
  const d = g.asphalt.image.data, N = d.length / 4;
  const st = (c) => { let s = 0, s2 = 0; for (let i = 0; i < N; i++) { const v = d[i * 4 + c] / 255; s += v; s2 += v * v; } const mu = s / N; return [+mu.toFixed(4), +Math.sqrt(s2 / N - mu * mu).toFixed(4)]; };
  return JSON.stringify({ ms: Math.round(dt), R: st(0), G: st(1), B: st(2), A: st(3) });
}));
await browser.close();
