// screenshots of the lobby, help and the match-end podium (with awards)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const out = process.argv[2] ?? 'shots';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5196/brawl.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.click('[data-act="play"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/ui_lobby.png` });
await page.click('[data-act="lobbyback"]');
await page.click('[data-act="help"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ui_help.png` });
await page.evaluate(() => {
  const g = window.__brawl;
  g.ui.act('helpback');
  g.ui.act('play');
  g.ui.act('start');
});
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/ui_fight.png` });
await page.evaluate(() => {
  const g = window.__brawl;
  g.seats.forEach((s, i) => { s.wins = [3, 1, 2, 0][i] ?? 0; s.kos = [4, 2, 6, 1][i] ?? 0; s.outs = [3, 1, 0, 2][i] ?? 0; });
  g.ui.roundResult(g.seats[0], g.seats, true);
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/ui_final.png` });
await browser.close();
console.log('ok');
