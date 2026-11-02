// watch one arena's CPU brawl: log each fighter going out with where it was and what it was doing
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [arena, secs = '20'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5196/brawl.html?manual', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const r = await page.evaluate(async ({ arena, secs }) => {
  const g = window.__brawl;
  await g.startMatch(g.cpuSeats(6), arena, 3);
  g.state = 'fight';
  const log = [], hist = new Map();
  for (let k = 0; k < secs * 60; k++) {
    g.tick(1 / 60);
    for (const f of g.fighters) {
      if (!f.alive) continue;
      const h = hist.get(f) ?? [];
      h.push(`${(k / 60).toFixed(1)}s (${f.pos[0].x.toFixed(1)},${f.pos[0].y.toFixed(1)},${f.pos[0].z.toFixed(1)}) ko=${f.ko.toFixed(1)} daze=${f.daze.toFixed(0)} gr=${f.grounded ? 1 : 0}${f.grabbedBy.size ? ' HELD' : ''}${f.lastHitBy ? ' hitby=' + f.lastHitBy.name + '@' + f.lastHitT.toFixed(1) : ''}`);
      if (h.length > 120) h.shift();
      hist.set(f, h);
      if (f.out && !f._logged) { f._logged = true; log.push(`OUT ${f.name} at ${(k / 60).toFixed(1)}s:\n   ` + h.filter((_, i) => i % 20 === 0 || i === h.length - 1).join('\n   ')); }
    }
    if (g.state !== 'fight') break;
  }
  return log;
}, { arena, secs: Number(secs) });
console.log(r.join('\n'));
await browser.close();
