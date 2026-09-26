// Interlagos in-game views (pit complex, cars): free camera at track.point(s, lat, h) looking at
// track.point(s + ahead, llat, lh), after a debug race start.
//   node tools/_ilgame.mjs "name:s,lat,h,ahead,llat,lh" ...
import { chromium } from 'playwright-core';
const views = process.argv.slice(2).map((a) => { const [n, v] = a.split(':'); return { n, v: v.split(',').map(Number) }; });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${process.env.TRACK ?? 'interlagos'}`, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 }).catch(() => console.log('no __ready'));
await page.evaluate(`window.__game.debugStart({autopilot:true, skip:${process.env.SKIP ?? 3}, camera:'chase'})`);
await page.waitForTimeout(4000);
for (const { n, v } of views) {
  const [s, lat, h, ahead, llat, lh] = v;
  await page.evaluate(`(()=>{const g=window.__game; const c=g.cams; c.update=()=>{}; const t=g.track; const p=t.point(${s},${lat},${h}); const q=t.point(${s + ahead},${llat},${lh}); c.camera.position.copy(p); c.camera.lookAt(q); c.camera.updateMatrixWorld(); document.querySelectorAll('.hud, #hud').forEach(e=>e.style.display='none');})()`);
  await page.waitForTimeout(2500);
  try { await page.screenshot({ path: `shots/ilg_${n}.png`, timeout: 180000 }); console.log('saved', n); } catch (e) { console.log(n, 'failed', e.message.slice(0, 80)); }
}
await browser.close();
