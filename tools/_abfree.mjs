// Frozen free-camera frame with effects toggled. V='{"k":"js"}' node tools/_abfree.mjs <out> <track> <s> <lat> <h> [lookAhead]
import { chromium } from 'playwright-core';
const [out, track, s0, lat, h, ahead = '60'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5196/?track=${track}&demo=race&skip=20&weather=${process.env.WX ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(([s, lat, h, ah]) => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g.freeCam = { pos: g.trackPoint(s, lat, h), look: g.trackPoint(s + ah, 0, 1), fov: 62 }; }, [Number(s0), Number(lat), Number(h), Number(ahead)]);
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__game.worldBusy = true; });
const V = JSON.parse(process.env.V ?? '{"base":""}');
for (const [k, js] of Object.entries(V)) {
  await page.evaluate((js) => { const g = window.__game; new Function('g', js)(g); g.gfx.render(1 / 60); }, js);
  await page.screenshot({ path: `${out}/${k}.png` });
}
await browser.close();
