// Linear mean / std of the procedural grass albedo (tools/build_grass.py matches the scan to them).
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:5191/package.json');
console.log(await page.evaluate(async () => {
  const m = await import('http://localhost:5191/src/world/trackside/textures.ts');
  const g = m.makeGroundTextures(8);
  const d = g.grassAlbedo.image.data, N = d.length / 4;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const out = [];
  for (let c = 0; c < 3; c++) { let s = 0, s2 = 0; for (let i = 0; i < N; i++) { const v = lin(d[i * 4 + c]); s += v; s2 += v * v; } const mu = s / N; out.push([+mu.toFixed(4), +Math.sqrt(s2 / N - mu * mu).toFixed(4)]); }
  return JSON.stringify(out);
}));
await browser.close();
