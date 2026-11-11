// Bots only, for a while: is anyone standing on a stair or in a doorway going nowhere?  node tools/lastframe/botwatch.mjs PORT [map] [seconds]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', secs = '60'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.autoInput = true; g.startSolo({ mode: 'tdm', bots: 8, skill: 0.5, time: 8, limit: 200, seed: 5 }, 'Tester', 0, 'carbine'); });
await p.waitForTimeout(6000);
// the human out of the way, so it's only them
await p.evaluate(() => { const g = __lf.g; Object.assign(g.me.m, { x: -12, y: 0, z: 14 }); });
const still = new Map();
const floors = new Map();
const worst = [];
for (let t = 0; t < +secs; t += 2) {
  await p.waitForTimeout(2000);
  const bots = await p.evaluate(() => { const m = __lf.g.match; return [...m.bots.values()].map((q) => ({ s: q.slot, x: q.m.x, y: q.m.y, z: q.m.z, alive: m.players.find((pl) => pl.slot === q.slot).alive, target: q.target })); });
  for (const q of bots) {
    const k = still.get(q.s);
    const fl = q.y < -2 ? 'under' : q.y > 2.5 ? 'up' : 'ground';
    if (q.alive) floors.set(fl, (floors.get(fl) ?? 0) + 1);
    if (!q.alive || q.target >= 0 || !k || Math.hypot(k.x - q.x, k.z - q.z, k.y - q.y) > 0.4) still.set(q.s, { x: q.x, y: q.y, z: q.z, n: 0 });
    else if (++k.n === 5) worst.push(`${q.s} at ${q.x.toFixed(1)},${q.y.toFixed(1)},${q.z.toFixed(1)}`);
  }
}
console.log('time on each floor (bot samples):', JSON.stringify(Object.fromEntries(floors)));
console.log('stood still 10 s with no target:', worst.length ? worst.join(' | ') : 'nobody');
console.log('lamps shot out by bots:', await p.evaluate(() => __lf.g.L.flicks.filter((q) => q.dead).length));
console.log('score', await p.evaluate(() => JSON.stringify(__lf.g.score)));
await b.close();
