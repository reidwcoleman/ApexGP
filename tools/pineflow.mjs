// Real input through a first playthrough: title click, letter, walk, cut with SPACE, unload, mouse-driving,
// drawing a block with the mouse, placing a building, buying land, opening every window with its hotkey.
//   node tools/pineflow.mjs <outdir> [port]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [dir, port = '5311'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/pine.html`); await page.waitForFunction(() => window.__ready === true); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(500);
const st = () => page.evaluate(() => { const a = __pine, s = a.sim.s; return { mode: a.mode, win: a.win, act: a.act, m: s?.month, d: s?.day, money: Math.round(s?.money ?? 0), hop: s?.p.hop.n, x: +(s?.p.x ?? 0).toFixed(1), y: +(s?.p.y ?? 0).toFixed(1), goal: s?.goal, stock: s?.stockN, tick: s?.tickets.length, blocks: s?.blocks.length, parcels: a.sim.s ? a.sim.parcels : 0, blds: s?.blds.length, tut: s?.tut, z: a.r.z }; });
const px = async () => page.evaluate(() => ({ S: 1440 / __pine.W, W: __pine.W, H: __pine.H }));
const P = await px(); const at = (x, y) => [x * P.S, y * P.S];
const log = async (l) => console.log(l.padEnd(22), JSON.stringify(await st()));
const hold = async (ks, ms) => { for (const k of ks) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of ks) await page.keyboard.up(k); };
const click = async (x, y) => { const [a, b] = at(x, y); await page.mouse.move(a, b); await page.waitForTimeout(60); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(90); };
await page.waitForTimeout(300);
await click(P.W / 2 + 14, Math.round(P.H * 0.6) + 8); await page.waitForTimeout(1100); await log('new farm');
await page.keyboard.press('Space'); await page.waitForTimeout(250); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); await log('entered');
await hold(['KeyD'], 1000); await log('walked right');
await hold(['KeyD', 'Space'], 800); await log('cut with space');
await hold(['KeyA'], 1300); await hold(['KeyW'], 300); await log('walked to barn');
await page.waitForTimeout(400); await log('after unload');
// mouse driving: hold the button on the grove and it drives and cuts
{ const [a, b] = at(P.W * 0.72, P.H * 0.5); await page.mouse.move(a, b); await page.mouse.down(); await page.waitForTimeout(1700); await page.mouse.up(); await log('mouse drive+cut'); }
await page.screenshot({ path: `${dir}/flow_field.png` });
for (const k of ['KeyR', 'KeyC', 'KeyT', 'KeyK', 'KeyN', 'KeyG']) { await page.keyboard.press(k); await page.waitForTimeout(120); const s = await st(); console.log(' window', k, s.win); await page.keyboard.press('Escape'); await page.waitForTimeout(80); }
// draw a block with the mouse
await page.keyboard.press('KeyB'); await page.waitForTimeout(120);
{ const [a, b] = at(P.W * 0.42, P.H * 0.3), [c, d] = at(P.W * 0.62, P.H * 0.62); await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps: 6 }); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(200); await log('drew block'); }
await page.screenshot({ path: `${dir}/flow_block.png` });
await page.evaluate(() => { __pine.sim.s.money = 3000; }); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
// build a depot: pick it from the window, then place it
await page.keyboard.press('KeyG'); await page.waitForTimeout(200);
{ const x = (P.W - 380) / 2 + 40, y = Math.max(20, (P.H - 232) / 2 - 6) + 34; await click(x, y); await log('picked depot'); }
{ const s = await page.evaluate(() => { const a = __pine, r = a.r; return { x: (135 * r.z - r.camX()), y: (62 * r.z - r.camY()) }; }); console.log(' place at', s); }
await page.screenshot({ path: `${dir}/flow_ghost.png` });
await page.evaluate(() => { const a = __pine; a.r.free = true; a.r.cx = 136; a.r.cy = 70; });
await page.waitForTimeout(100);
{ const s = await page.evaluate(() => { const r = __pine.r; return { x: 137.5 * r.z - r.camX(), y: 77 * r.z - r.camY() }; }); await click(s.x, s.y); await log('placed depot'); }
await page.keyboard.press('KeyL'); await page.waitForTimeout(400);
await page.evaluate(() => { __pine.sim.s.money = 5000; });
{ const s = await page.evaluate(() => { const a = __pine, r = a.r; return { x: (152) * r.z - r.camX(), y: (72) * r.z - r.camY() }; }); const b = (await st()).parcels; await click(s.x, s.y); await page.waitForTimeout(200); const after = (await st()).parcels; console.log(' land', b, '->', after); }
await page.screenshot({ path: `${dir}/flow_land.png` });
await page.keyboard.press('Escape'); await page.waitForTimeout(200); await log('left land');
console.log(errs.slice(0, 10).join('\n') || 'no errors');
await browser.close();
