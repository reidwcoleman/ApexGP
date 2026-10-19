// Drive Apex Lawn (lawn.html) in headless Chrome and take screenshots.
//
//   node tools/lawnshot.mjs <outdir> "<query>" step step ...
//
// steps:  until:<js expr>   wait:<ms>   click:<selector>   shot:<name>   eval:<js>   drag:<x1>,<y1>,<x2>,<y2>,<ms>
//         down:<x>,<y>  move:<x>,<y>  up:   (hold the pointer)
//         size:<w>x<h>   (before the first step; default 1280x800)
// The page must be served: npx vite --config vite.stable.config.mjs   (port 5191)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';

const [outdir, query = '', ...steps] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
let W = 1280;
let H = 800;
const sz = steps.find((s) => s.startsWith('size:'));
if (sz) [W, H] = sz.slice(5).split('x').map(Number);
const port = process.env.PORT ?? '5191';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[lawn]')) logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + (process.env.STACK ? e.stack : e.message)));
await page.goto(`http://localhost:${port}/lawn.html?${query}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
} catch {
  logs.push('[lawnshot] timed out waiting for __ready');
}
await page.waitForTimeout(600);
for (const s of steps) {
  const i = s.indexOf(':');
  const cmd = s.slice(0, i);
  const arg = s.slice(i + 1);
  if (cmd === 'wait') await page.waitForTimeout(Number(arg));
  else if (cmd === 'until') await page.waitForFunction(arg, null, { timeout: 90000 });
  else if (cmd === 'click') await page.click(arg);
  else if (cmd === 'shot') {
    await page.screenshot({ path: `${outdir}/${arg}.png` });
    console.log('shot', arg);
  } else if (cmd === 'eval') {
    const r = await page.evaluate(arg);
    if (r !== undefined) console.log('eval', JSON.stringify(r));
  } else if (cmd === 'down') {
    const [x, y] = arg.split(',').map(Number);
    await page.mouse.move(x, y);
    await page.mouse.down();
  } else if (cmd === 'move') {
    const [x, y] = arg.split(',').map(Number);
    await page.mouse.move(x, y, { steps: 8 });
  } else if (cmd === 'up') {
    await page.mouse.up();
  } else if (cmd === 'drag') {
    const [x1, y1, x2, y2, ms] = arg.split(',').map(Number);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    const n = Math.max(2, Math.round(ms / 16));
    for (let k = 1; k <= n; k++) {
      await page.mouse.move(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
}
for (const l of logs.slice(0, 30)) console.log(l);
await browser.close();
