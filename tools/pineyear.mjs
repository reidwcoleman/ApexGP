// A whole year in a real browser with real input: fast-forward to Christmas Eve, click through the flight,
// the books and the almanac, into January. Then reload and check the save came back identical.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [dir, port = '5311'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message + (e.stack ?? '').split('\n')[1])); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/pine.html?skip&seed=9`); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(400);
const st = () => page.evaluate(() => { const a = __pine, s = a.sim.s; return { mode: a.mode, phase: s.phase, y: s.year, m: s.month, d: s.day, money: Math.round(s.money), sold: s.yr.sold, standing: a.sim.standing, goal: s.goal, perks: Object.keys(s.perks).length }; });
await page.evaluate(() => { const s = __pine.sim.s; s.tut = false; s.goal = 2; s.month = 11; s.day = 20; __pine.sim.speed = 5; });
await page.keyboard.down('Space'); await page.keyboard.down('KeyD');
await page.waitForFunction(() => __pine.mode === 'fly', null, { timeout: 40000 }); await page.keyboard.up('Space'); await page.keyboard.up('KeyD');
console.log('reached flight ', JSON.stringify(await st()));
await page.waitForTimeout(1800); await page.screenshot({ path: `${dir}/y_fly.png` });
await page.mouse.click(700, 450); await page.waitForFunction(() => __pine.mode === 'report', null, { timeout: 8000 }); await page.waitForTimeout(1900); console.log('books          ', JSON.stringify(await st())); await page.screenshot({ path: `${dir}/y_books.png` });
await page.keyboard.press('Enter'); await page.waitForTimeout(350);
console.log('after next    ', (await st()).mode);
if ((await st()).mode === 'buck') { await page.screenshot({ path: `${dir}/y_buck.png` }); await page.keyboard.press('Enter'); await page.waitForTimeout(250); }
console.log('almanac       ', (await st()).mode); await page.screenshot({ path: `${dir}/y_perk.png` });
await page.keyboard.press('Digit2'); await page.waitForFunction(() => __pine.mode === 'play', null, { timeout: 5000 }); await page.waitForTimeout(500);
console.log('new year      ', JSON.stringify(await st()));
// save round trip: run a bit, save, reload through the real title menu
await page.evaluate(() => { __pine.sim.speed = 5; }); await page.waitForTimeout(1500);
const before = await page.evaluate(() => { const a = __pine; a.save(); let h = 0; for (let i = 0; i < a.sim.N; i++) h = (h * 31 + a.sim.sp[i] + Math.round(a.sim.h[i] * 100)) | 0; return { h, money: a.sim.s.money, y: a.sim.s.year, m: a.sim.s.month, standing: a.sim.standing, kb: Math.round(localStorage.getItem('pine.save.v1').length / 1024) }; });
await page.goto(`http://localhost:${port}/pine.html`); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(500);
await page.keyboard.press('Enter'); await page.waitForFunction(() => __pine.mode === 'play', null, { timeout: 5000 });
const after = await page.evaluate(() => { const a = __pine; let h = 0; for (let i = 0; i < a.sim.N; i++) h = (h * 31 + a.sim.sp[i] + Math.round(a.sim.h[i] * 100)) | 0; return { h, money: a.sim.s.money, y: a.sim.s.year, m: a.sim.s.month, standing: a.sim.standing }; });
console.log('save', JSON.stringify(before)); console.log('load', JSON.stringify(after)); console.log(before.h === after.h && before.money === after.money ? 'SAVE ROUND TRIP OK' : 'SAVE MISMATCH');
console.log(errs.slice(0, 10).join('\n') || 'no errors'); await browser.close();
