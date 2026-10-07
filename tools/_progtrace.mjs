// Per-frame trace of the boot: shader program count, world progress and frame time. Finds frames that
// compile programs synchronously (a big program jump in one long frame).
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.env.PORT ?? 5218;
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(() => {
  window.__trace = [];
  let last = performance.now();
  const f = (t) => {
    const g = window.__game;
    const n = g?.gfx?.renderer?.info?.programs?.length ?? 0;
    window.__trace.push([Math.round(t), Math.round(t - last), n, g ? +g.worldProgress.toFixed(3) : -1]);
    last = t;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
await p.goto(`http://localhost:${port}/?track=${process.env.TRACK ?? 'monza'}`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await p.waitForTimeout(1000);
const tr = await p.evaluate(() => window.__trace);
let prev = 0;
for (const [t, dt, n, wp] of tr) {
  if (n !== prev || dt > 50) console.log(`t=${t} dt=${dt} programs=${n} (+${n - prev}) world=${wp}`);
  prev = n;
}
console.log(JSON.stringify(await p.evaluate(() => window.__game.worldTimes)));
await b.close();
