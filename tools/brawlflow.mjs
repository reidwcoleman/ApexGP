// Plush Panic menu flow: title -> lobby -> start -> countdown -> fight, real key presses, screenshots.
//   node tools/brawlflow.mjs <outdir>
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const dir = process.argv[2] ?? 'shots';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/brawl.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/f1_title.png` });
await page.keyboard.press('Space');
await page.waitForTimeout(800);
await page.keyboard.press('KeyE');
await page.waitForTimeout(300);
await page.screenshot({ path: `${dir}/f2_lobby.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/f3_count.png` });
// walk and punch for a while
await page.keyboard.down('KeyW');
for (let i = 0; i < 12; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${dir}/f4_fight.png` });
const st = await page.evaluate(() => { const g = window.__brawl; return { state: g.state, arena: g.arenaId, alive: g.fighters.filter((f) => f.alive && !f.out).length, p1: g.seats[0]?.name, fps: 0 }; });
// frame rate over 2 s
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log(JSON.stringify({ ...st, fps }));
for (const e of errs.slice(0, 10)) console.log(e);
await browser.close();
