// Presses C through the in-race camera cycle and lists the cameras it visits.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=monza&demo=race&cam=chase&skip=10`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const seen = [];
for (let i = 0; i < 14; i++) {
  await p.keyboard.press('c');
  await p.waitForTimeout(250);
  seen.push(await p.evaluate(() => window.__game.cams.mode));
}
console.log('state', await p.evaluate(() => window.__game.state), 'cycle:', seen.join(' → '));
await b.close();
