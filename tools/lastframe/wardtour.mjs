// Round Ashgrove Ward, first person, nobody about:  node tools/lastframe/wardtour.mjs PORT OUT [stop names]
// Stops are in game axes: x east, y up, z = -north
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, ...only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=ward`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
const stops = [
  ['carpark', 36, 0, -6, 0, 0.05], ['lobby', 36, 0, -16, 0, 0.1], ['scor_w', 26, 0, -21.2, 1.57, 0], ['scor_e', 46, 0, -21.2, -1.57, 0],
  ['warda', 14, 0, -17, 1.57, -0.05], ['records', 26, 0, -17, 1.57, 0], ['pharm', 46, 0, -17, -1.57, 0], ['xray', 22, 0, -26, 1.57, 0],
  ['dayroom', 50, 0, -26, -1.57, 0], ['cells', 63, 0, -32, 0, 0], ['ncor', 36, 0, -36.8, 1.57, 0], ['theatre', 22, 0, -41, 0, -0.1],
  ['chapel', 36, 0, -39, 0, 0], ['morgue', 51, 0, -41, 0, -0.1], ['court', 36, 0, -29, 3.14, 0.1], ['scor2', 26, 3.6, -21.2, 1.57, 0],
  ['ward_up', 20, 3.6, -17, 1.57, 0], ['balcony', 36, 3.6, -19, 3.14, -0.3], ['ncor2', 40, 3.6, -36.8, -1.57, 0],
  ['tunnel', 30, -3.4, -21.2, -1.57, 0], ['boiler', 18, -3.4, -17, 0, 0], ['cold', 40, -3.4, -17, 0, 0], ['flood', 52, -3.4, -17, 0, 0],
  ['yard_w', 0, 0, -28, -1.57, 0.05], ['yard_e', 72, 0, -28, 1.57, 0.05],
];
for (const [n, x, y, z, yaw, pitch] of stops) {
  if (only.length && !only.includes(n)) continue;
  await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${n}.png` });
}
console.log(await p.evaluate(() => JSON.stringify({ ms: __lf.g.frameMs ?? null })));
await b.close();
