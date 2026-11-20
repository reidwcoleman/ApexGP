// What a view costs in triangles and draw calls (all passes of one frame), at a few places:  node tools/lastframe/load.mjs PORT MAP
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.autoInput = true; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(6000);
const stops = map === 'store'
  ? [['front', 30, 0, -1.5, 0], ['aisle', 22, 0, -10.4, 0], ['tills', 14.8, 0, -9.2, -1.57], ['stock', 32, 0, -31.5, -0.9], ['catwalk', 1, 3.6, -17, -1.3]]
  : [['lobby', 26, 0, -4.9, 0], ['scor', 48, 0, -7.3, 1.57], ['atrium', 17.2, 0, -10.6, -0.95], ['warda', 16.5, 0, -4.6, 1.4], ['gallery', 22, 3.6, -9.4, -0.25]];
const out = [];
for (const [n, x, y, z, yaw] of stops) {
  const r = await p.evaluate(async ([x, y, z, yaw]) => {
    const g = __lf.g, info = __lf.r.info;
    Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = 0;
    await new Promise((r) => setTimeout(r, 900));
    g.halt = true;
    info.autoReset = false; info.reset();
    g.tick(0.016);
    const o = { tris: info.render.triangles, calls: info.render.calls };
    info.autoReset = true; g.halt = false;
    return o;
  }, [x, y, z, yaw]);
  out.push(`${n} ${(r.tris / 1000).toFixed(0)}k tris ${r.calls} calls`);
}
console.log(map + ': ' + out.join(' | '));
await b.close();
