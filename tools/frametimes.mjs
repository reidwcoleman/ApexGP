// Frame-time distribution (rAF deltas) in a live race over N seconds, per server.
//   node tools/frametimes.mjs <ports> [track] [cam] [secs]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [portsArg = '5218', track = 'monza', cam = 'chase', secs = '15'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
for (const port of portsArg.split(',')) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://localhost:${port}/?track=${track}&demo=race&cam=${cam}&skip=20&weather=clear&time=afternoon`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.evaluate(() => { const g = window.__game; const o = g.adaptQuality.bind(g); g.adaptQuality = (dt) => { o(dt); g.gfx.setDynamicScale(1); }; g.gfx.setDynamicScale(1); });
  await page.waitForTimeout(2000);
  const r = await page.evaluate((ms) => new Promise((res) => {
    const d = []; let last = performance.now(); const t0 = last;
    const f = (t) => { d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res(d); };
    requestAnimationFrame(f);
  }), Number(secs) * 1000);
  r.sort((a, b) => a - b);
  const q = (p) => r[Math.min(r.length - 1, Math.floor(p * r.length))].toFixed(1);
  console.log(port, `frames ${r.length} fps ${(r.length / Number(secs)).toFixed(1)} p50 ${q(0.5)} p95 ${q(0.95)} p99 ${q(0.99)} max ${r[r.length - 1].toFixed(1)} >33ms ${r.filter((x) => x > 33).length}`);
  await page.close();
}
await browser.close();
