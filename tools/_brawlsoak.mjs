import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '/Users/reidcoleman/ApexGP/tools/chrome.mjs';
const arenas = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
await page.goto('http://localhost:5196/brawl.html?manual', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
for (const arena of arenas) {
  const r = await page.evaluate(async (arena) => {
    const g = window.__brawl;
    await g.startMatch(g.cpuSeats(6), arena, 3);
    g.state = 'fight';
    const out = [];
    const stats = { hang: 0, climb: 0, head: 0, drop: 0 };
    const t0 = performance.now();
    for (let k = 0; k < 40 * 60; k++) {
      g.tick(1 / 60);
      for (const f of g.fighters) { if (!f.alive) continue; if (f.hanging()) stats.hang++; if (f.headT > 0.3) stats.head++; if (f.dropT > 0.55) stats.drop++; if (f.popT > 0.65) stats.climb++; }
      if (k % 300 === 0) out.push(g.fighters.filter((f) => f.alive && !f.out).length);
      if (g.state !== 'fight') { out.push('end@' + (k / 60).toFixed(1)); break; }
    }
    return { arena, alive: out.join(','), stats, ms: Math.round(performance.now() - t0), kos: g.fighters.reduce((s, f) => s + f.koCount, 0) };
  }, arena);
  console.log(JSON.stringify(r));
}
await browser.close();
