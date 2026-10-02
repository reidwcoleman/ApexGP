// One frozen frame, post effects toggled one at a time. V='{"name":"js"}' node tools/_ablate.mjs <out> <track> <weather> <time> <cam>
import { chromium } from 'playwright-core';
const [out, track, weather, time, cam] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=${cam}&skip=${process.env.SKIP ?? 40}&weather=${weather}&time=${time}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate((cam) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g.cams.set(cam); }, cam);
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__game.worldBusy = true; });
const V = JSON.parse(process.env.V);
for (const [k, js] of Object.entries(V)) {
  await page.evaluate((js) => { const g = window.__game; new Function('g', js)(g); g.gfx.render(1 / 60); }, js);
  await page.screenshot({ path: `${out}/${k}.png` });
}
await browser.close();
