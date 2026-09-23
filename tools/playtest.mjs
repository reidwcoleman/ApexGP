// Scripted keyboard playthrough of the real game in headless Chrome.
//   node tools/playtest.mjs
// Menu → setup → race start (revving on the grid) → launch → a few seconds of
// driving with simple steering from the game's own track data → pause → resume.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()));
await page.goto('http://localhost:5190/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const state = () => page.evaluate(() => {
  const g = window.__game;
  const c = g.race.player.car;
  return { state: g.state, phase: g.race.phase, kmh: Math.round(c.vx * 3.6), gear: c.gear, rpm: Math.round(c.rpm), lat: +c.lateral.toFixed(2), s: Math.round(c.s), pos: g.race.player.position, fps: window.__fps, menu: g.menu.screen };
});
const shot = async (name) => page.screenshot({ path: `shots/play_${name}.png` });

await page.mouse.click(1200, 200);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
console.log('after enter 1', JSON.stringify(await state()));
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
console.log('after enter 2', JSON.stringify(await state()));
await page.waitForTimeout(3000);
await page.keyboard.down('ArrowUp');
await shot('grid');
// wait for lights out
for (let i = 0; i < 40; i++) {
  const st = await state();
  if (st.phase === 'racing') break;
  await page.waitForTimeout(250);
}
console.log('lights out', JSON.stringify(await state()));
// drive: steer with a simple controller toward the racing line using the page's own track
const drive = async (ms) => {
  const t0 = Date.now();
  let lastKey = null;
  while (Date.now() - t0 < ms) {
    const want = await page.evaluate(() => {
      const g = window.__game;
      const c = g.race.player.car;
      const tr = g.track;
      const target = tr.racingLineAt(c.s + 25);
      const err = Math.max(-1.5, Math.min(1.5, target - c.lateral)); // + → target is to the right
      const yawErr = c.relYaw; // pointing left of the track (+) → steer right (+)
      const k = Math.abs(tr.kappaAt(c.s + 40));
      const v = c.vx;
      const brake = v > g.race.profile.at(c.s + 30) + 3;
      return { steer: err * 0.2 + yawErr * 2.2, brake };
    });
    const key = want.steer > 0.25 ? 'ArrowRight' : want.steer < -0.25 ? 'ArrowLeft' : null;
    if (key !== lastKey) {
      if (lastKey) await page.keyboard.up(lastKey);
      if (key) await page.keyboard.down(key);
      lastKey = key;
    }
    if (want.brake) {
      await page.keyboard.up('ArrowUp');
      await page.keyboard.down('ArrowDown');
    } else {
      await page.keyboard.up('ArrowDown');
      await page.keyboard.down('ArrowUp');
    }
    await page.waitForTimeout(60);
  }
  if (lastKey) await page.keyboard.up(lastKey);
};
await drive(5000);
console.log('5 s in', JSON.stringify(await state()));
await shot('launch');
await drive(25000);
console.log('30 s in', JSON.stringify(await state()));
await shot('t1');
// flashback: press R, scrub back a bit, resume
const before = await state();
await page.keyboard.press('KeyR');
await page.waitForTimeout(1200);
const during = await page.evaluate(() => ({ state: window.__game.state, t: window.__game.fbT, entry: window.__game.fbEntry }));
await shot('flashback');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const after = await state();
console.log('flashback', JSON.stringify({ before: before.s, during, after: after.s, state: after.state, used: await page.evaluate(() => window.__game.flashbacksUsed) }));
await drive(4000);
await page.keyboard.press('KeyC');
await page.waitForTimeout(800);
await shot('cam2');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
console.log('paused', JSON.stringify(await state()));
await shot('pause');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('resumed', JSON.stringify(await state()));
for (const e of errors.slice(0, 20)) console.log(e);
await browser.close();
