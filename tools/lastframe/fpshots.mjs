// The view the player has of their own hands and gun, large: from the hip, down the sights, through a reload, running.
//   node tools/lastframe/fpshots.mjs PORT OUT [weapons, comma separated] [map]     (TIER=0..3, default 2; AT=x,y,z,yaw)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, list = 'carbine,pistol', map = 'ward'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
const at = (process.env.AT ?? (map === 'ward' ? '30,0,-5,1.5' : '30,0,-8,1.5')).split(',').map(Number);
await p.evaluate((tier) => { localStorage.setItem('lastframe.played', '9'); const g = __lf.g; g.gfx = tier; g.setTier(tier); g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); }, +(process.env.TIER ?? 2));
await p.waitForTimeout(6500);
// PRE='js' runs in the page first (to switch something off for a comparison); ONLY=hip|down keeps one frame a weapon
if (process.env.PRE) await p.evaluate(process.env.PRE);
const put = (w, extra = {}) => p.evaluate(([w, at, extra]) => { const g = __lf.g, m = g.me; m.slots = [w, 'pistol']; m.cur = 0; m.ammo.set(w, { mag: 5, res: 60 }); Object.assign(m.m, { x: at[0], y: at[1], z: at[2], vx: 0, vz: 0 }); m.yaw = at[3]; m.pitch = extra.pitch ?? 0.02; m.light = extra.light ?? true; g.input.ads = false; g.input.keys.clear(); document.querySelector('.banner')?.remove(); }, [w, at, extra]);
for (const w of list.split(',')) {
  await put(w);
  await p.waitForTimeout(1100);
  await p.screenshot({ path: `${out}/${w}_1hip.png` });
  await put(w, { pitch: -0.45 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/${w}_2down.png` });
  if (process.env.ONLY) continue;
  await put(w);
  await p.evaluate(() => { __lf.g.input.ads = true; });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${w}_3ads.png` });
  await p.evaluate(() => { __lf.g.input.ads = false; __lf.g.input.pressed.add('KeyR'); });
  for (let k = 0; k < 6; k++) {
    await p.waitForTimeout(380);
    await p.screenshot({ path: `${out}/${w}_4reload${k}.png` });
  }
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const g = __lf.g; g.input.fire = true; g.input.firePressed = true; });
  await p.waitForTimeout(90);
  await p.screenshot({ path: `${out}/${w}_5fire.png` });
  await p.evaluate(() => { __lf.g.input.fire = false; });
  await p.waitForTimeout(600);
}
await b.close();
