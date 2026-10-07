// Evaluate a JS expression in a booted circuit and print the JSON result.
//   node tools/_probe.mjs <track> '<expr using g = window.__game>'
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track, expr] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=5`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
const r = await page.evaluate((e) => { const g = window.__game; return JSON.stringify(new Function('g', `return (${e})`)(g)); }, expr);
console.log(r);
await browser.close();
