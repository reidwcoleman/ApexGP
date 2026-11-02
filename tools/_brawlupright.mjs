// how much of the time are fighters on their feet? (CPU match, 30 s)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const arenas = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5196/brawl.html?manual', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
for (const arena of arenas) {
  const r = await page.evaluate(async (arena) => {
    const g = window.__brawl;
    await g.startMatch(g.cpuSeats(4), arena, 3);
    g.state = 'fight';
    const s = { up: 0, fallen: 0, ko: 0, dazed: 0, hang: 0, n: 0, kos: 0 };
    for (let k = 0; k < 30 * 60; k++) {
      g.tick(1 / 60);
      for (const f of g.fighters) {
        if (!f.alive || f.out) continue;
        s.n++;
        if (f.ko > 0) s.ko++;
        else if (f.fallenT > 0 || f.getup > 0) s.fallen++;
        else s.up++;
        if (f.daze > 40) s.dazed++;
      }
      if (g.state !== 'fight') break;
    }
    s.kos = g.fighters.reduce((a, f) => a + (f.koCount ?? 0), 0);
    const p = (x) => Math.round((100 * x) / s.n) + '%';
    return { arena, up: p(s.up), fallen: p(s.fallen), ko: p(s.ko), dazed: p(s.dazed), kos: s.kos };
  }, arena);
  console.log(JSON.stringify(r));
}
await browser.close();
