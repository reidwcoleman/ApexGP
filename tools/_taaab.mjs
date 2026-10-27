// chase cam with the TAA on and off (motion blur off): node tools/_taaab.mjs <out> [track]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'silverstone', cam = 'chase'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=${cam}&skip=40&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g.menu.settings.motionBlur = 'off'; });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${track}_taa_on.jpg`, quality: 88 });
await page.evaluate(() => { window.__game.gfx['taa'].enabled = false; });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/${track}_taa_off.jpg`, quality: 88 });
await browser.close();
