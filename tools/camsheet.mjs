// One screenshot per camera mode in a live race (HUD hidden). node tools/camsheet.mjs <track> <modes,...> [outdir]
import { chromium } from 'playwright-core';
const [track = 'monza', modes = 'chase,far,tcam,cockpit,nose,wheel', out = 'shots/cams'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=chase&skip=${process.env.SKIP ?? 40}&weather=clear&time=${process.env.TIME ?? "afternoon"}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; window.__game.gfx.setDynamicScale(1); });
for (const m of modes.split(',')) {
  await page.evaluate((m) => window.__game.cams.set(m), m);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${track}_${m}.png` });
  console.log('saved', m);
}
await browser.close();
