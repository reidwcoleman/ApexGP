// The scout's scope through a barricade, as the attacker sees it.  node tools/lastframe/scopeshot.mjs PORT map OUT.png
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', out = 'scope.png'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
await p.evaluate(() => {
  const g = __lf.g;
  g.kits = ['scout', 'medic'];
  g.startSolo({ mode: 'siege', bots: 5, skill: 0.5, time: 8, limit: 4, seed: 4 }, 'Tester', 0, 'carbine');
  const m = g.match;
  g.halt = true;
  for (let k = 0; k < 30 * 60 && m.phase !== 'live'; k++) m.update(1 / 30);
  // outside a boarded doorway of the room
  const d = m.obj.doors.find((q) => m.bars[q] === 63) ?? m.obj.doors[0];
  const o = m.openings[d];
  const inw = Math.sign((o.alongX ? (m.obj.box[2] + m.obj.box[5]) / 2 - o.z : (m.obj.box[0] + m.obj.box[3]) / 2 - o.x)) || 1;
  Object.assign(g.me.m, { x: o.x - (o.alongX ? 0 : inw * 1.1), y: o.y, z: o.z - (o.alongX ? inw * 1.1 : 0), vx: 0, vz: 0 });
  g.me.yaw = Math.atan2(-(o.x - g.me.m.x), -(o.z - g.me.m.z));
  g.halt = false;
});
await p.waitForTimeout(600);
await p.evaluate(() => __lf.g.input.pressed.add('KeyX'));
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => { const g = __lf.g; return { scope: g.scopeView, label: g.viewLabel(), spots: g.spots.length, intel: g.match.intel[0].size }; })));
await p.screenshot({ path: out });
console.log('page errors:', errs);
await b.close();
