// dump camera + fighter positions over time for an arena
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const arena = process.argv[2] ?? 'clock';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5196/brawl.html?manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const out = await page.evaluate(async (arena) => {
  const g = window.__brawl;
  await g.startMatch(g.cpuSeats(6), arena, 3);
  g.state = 'fight';
  const rows = [];
  for (let k = 0; k < 60 * 8; k++) {
    g.tick(1 / 60); g.draw(1 / 60);
    if (k % 60 === 0) rows.push({ t: k / 60, cam: g.camera.position.toArray().map((v) => +v.toFixed(1)), f: g.fighters.map((f) => (f.out ? 'OUT' : f.alive ? f.pos[1].toArray().map((v) => +v.toFixed(1)).join(',') : 'dead')) });
  }
  return { rows, bounds: g.arena.bounds };
}, arena);
console.log(JSON.stringify(out.bounds));
for (const r of out.rows) console.log(r.t, r.cam.join(','), r.f.join(' | '));
await browser.close();
