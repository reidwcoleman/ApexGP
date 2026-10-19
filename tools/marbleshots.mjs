// Marble Mania: several screenshots in one session. Each view: [name, s along the course, lateral, height, look-ahead, wait ms]
//   node tools/marbleshots.mjs "/marbles.html?round=0&auto=1" outdir --port 5197 [--views json] [--play 1]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const url = `http://localhost:${opt('port', '5190')}${args[0]}`;
const out = args[1];
fs.mkdirSync(out, { recursive: true });
const views = JSON.parse(opt('views', '[["start",10,6,8,30,500]]'));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(opt('w', 1280)), height: Number(opt('h', 720)) } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); if (m.text().startsWith('[mm]')) console.log(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
for (const [name, s, lat, up, ahead, wait, js] of views) {
  if (js) await page.evaluate(js);
  if (s !== null) await page.evaluate(([s, lat, up, ahead]) => {
    const g = window.__marbles, P = g.course.path;
    if (!P) { const c = g.course.plate.center; window.__cam = { p: [c.x + lat, c.y + up, c.z + s], l: [c.x, c.y, c.z] }; return; }
    const a = P.at(s + ahead, 0, 0), b = P.at(s, lat, up);
    window.__cam = { p: [b.x, b.y, b.z], l: [a.x, a.y, a.z] };
  }, [s, lat, up, ahead]);
  else await page.evaluate(() => { delete window.__cam; });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
const info = await page.evaluate(() => window.__mmInfo?.() ?? null);
if (info) console.log('info', JSON.stringify(info));
for (const e of errs.slice(0, 20)) console.log('ERR', e);
await browser.close();
