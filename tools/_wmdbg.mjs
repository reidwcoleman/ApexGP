// Wobble Mania: load a page, wait for ready, evaluate JS (argv[3]) and print the result.
//   node tools/_wmdbg.mjs "/marbles.html?round=2&auto=1&go=1" "window.__marbles.ff(80); ..." [--port 5241]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5241';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}${args[0]}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const r = await page.evaluate(args[1]);
console.log(JSON.stringify(r, null, 1));
if (args.includes('--shot')) await page.screenshot({ path: args[args.indexOf('--shot') + 1] });
await browser.close();
