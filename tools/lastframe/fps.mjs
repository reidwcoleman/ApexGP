// What a laptop really gets: frames drawn in free running over a few seconds, at a Retina MacBook's size (1440 x 900 @2x),
// at a few places in a location, graphics on Auto.   node tools/lastframe/fps.mjs PORT MAP [seconds]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', secs = '4'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.autoInput = true; g.startSolo({ mode: 'tdm', bots: 5, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); });
await p.waitForTimeout(7000);
const stops = map === 'store'
  ? [['front', 30, 0, -1.5, 0], ['aisle', 22, 0, -10.4, 0], ['tills', 14.8, 0, -9.2, -1.57], ['stock', 32, 0, -31.5, -0.9], ['catwalk', 1, 3.6, -17, -1.3]]
  : [['lobby', 26, 0, -4.9, 0], ['scor', 48, 0, -7.3, 1.57], ['atrium', 17.2, 0, -10.6, -0.95], ['warda', 16.5, 0, -4.6, 1.4], ['gallery', 22, 3.6, -9.4, -0.25]];
const out = [];
for (const [n, x, y, z, yaw] of stops) {
  const r = await p.evaluate(async ([x, y, z, yaw, secs]) => {
    const g = __lf.g;
    const me = g.match.players.find((q) => q.slot === g.mySlot); if (me) me.hp = 1e6;
    const hold = () => { Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = 0; };
    hold();
    await new Promise((r) => setTimeout(r, 1200));
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { hold(); n++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else res(0); }; requestAnimationFrame(f); });
    const info = __lf.r.info;
    return { fps: n / ((performance.now() - t0) / 1000), tris: info.render.triangles, calls: info.render.calls, scale: g.scale ?? null, gfx: g.gfx ?? null };
  }, [x, y, z, yaw, +secs]);
  out.push(`${n} ${r.fps.toFixed(1)} fps`);
}
console.log(map + ': ' + out.join(' | '));
await b.close();
