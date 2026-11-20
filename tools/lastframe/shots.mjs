// Clean stills of a location, the wearer's body and the interface hidden:
//   node tools/lastframe/shots.mjs PORT MAP OUT name:x,y,z,yaw,pitch [...]        (game axes: x east, y up, z = -north)
// LIGHT=0 turns the weapon light off, BODY=1 keeps the arms and gun in.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, map, out, ...specs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.autoInput = true; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(6000);
await p.evaluate(([light, body]) => {
  const g = __lf.g;
  g.me.light = light;
  g.me.freeAim = false;
  document.getElementById('ui').style.display = 'none';
  if (!body) { const hide = () => { if (g.mySoldier) g.mySoldier.root.visible = false; requestAnimationFrame(hide); }; hide(); }
}, [process.env.LIGHT !== '0', process.env.BODY === '1']);
for (const s of specs) {
  const [n, rest] = s.split(':');
  const [x, y, z, yaw, pitch] = rest.split(',').map(Number);
  await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(1100);
  await p.screenshot({ path: `${out}/${n}.png` });
}
console.log(await p.evaluate(() => JSON.stringify({ tris: __lf.r.info.render.triangles, calls: __lf.r.info.render.calls })));
await b.close();
