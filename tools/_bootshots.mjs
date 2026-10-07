// Screenshots of a cold boot: the loading screen, the garage the moment it is up (apex:garage), a few
// seconds into it, and the complete circuit — to see that what the boot shows first is right.
//   PORT=5410 node tools/_bootshots.mjs <outDir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.env.PORT ?? 5410;
const out = process.argv[2] ?? 'shots/boot';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 300)));
await p.goto(`http://localhost:${port}/?track=${process.env.TRACK ?? 'monza'}&settle=0`);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/0-loading.png` });
await p.waitForFunction(() => performance.getEntriesByName('apex:garage').length > 0, null, { timeout: 600000, polling: 50 });
await p.screenshot({ path: `${out}/1-garage.png` });
// (SEQ=1: the 3D alone, menus hidden, a shot every 0.7 s for 7 s — the garage's animated pieces: the
// wall's sheen, the crew)
if (process.env.SEQ) {
  await p.addStyleTag({ content: '* { visibility: hidden !important } #gl { visibility: visible !important }' }).then((h) => h.evaluate((s) => s.setAttribute('id', 'shot-hide')));
  for (let i = 0; i < 10; i++) {
    await p.screenshot({ path: `${out}/1-garage-${i}.png` });
    await p.waitForTimeout(700);
  }
  await p.evaluate(() => document.getElementById('shot-hide')?.remove());
}
await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}/2-garage-3s.png` });
await p.waitForFunction(() => performance.getEntriesByName('apex:world').length > 0, null, { timeout: 600000, polling: 250 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/3-world.png` });
if (process.env.SEQ) {
  await p.addStyleTag({ content: '* { visibility: hidden !important } #gl { visibility: visible !important }' });
  for (let i = 0; i < 3; i++) {
    await p.screenshot({ path: `${out}/4-world-3d-${i}.png` });
    await p.waitForTimeout(2500);
  }
}
console.log('garage', await p.evaluate(() => Math.round(performance.getEntriesByName('apex:garage')[0].startTime)), 'errors', JSON.stringify(errs));
await b.close();
