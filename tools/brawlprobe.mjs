// Plush Panic physics probe: loads brawl.html?manual, runs scripted scenarios with game.tick and
// prints what the fighters did (upright, height, KOs, outs). Optional screenshots.
//   node tools/brawlprobe.mjs <scenario> [--port 5196] [--shot out.png] [--secs 6]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const scen = args[0] ?? 'stand';
const port = opt('port', '5196');
const shot = opt('shot', null);
const secs = Number(opt('secs', 6));
const arena = opt('arena', 'tilt');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/brawl.html?manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const out = await page.evaluate(async ({ scen, secs, arena }) => {
  const g = window.__brawl;
  if (g.arenaId !== arena) await g.loadArena(arena);
  const log = [];
  const seat = (i, cpu) => ({ id: i, dev: null, cpu, name: 'F' + i, color: [0xff5a6e, 0x3b9cff, 0xffc93a, 0x42c86a][i % 4], hat: 'party', level: 1, wins: 0 });
  const n = { stand: 1, walk: 1, duel: 2, brawl: 4, jump: 1, grab: 2 }[scen] ?? 2;
  g.seats = Array.from({ length: n }, (_, i) => seat(i, scen === 'brawl' || (scen === 'duel' && i === 1)));
  g.state = 'free';
  g.attract = true;
  g.spawnAll();
  const f0 = g.fighters[0];
  // place fighters near the middle for the 1-2 fighter tests
  const dt = 1 / 60;
  const forced = (I) => { g.brains.delete(f0); Object.assign(g.intents.get(f0), I); };
  const origFeed = f0.feed.bind(f0);
  let script = () => ({});
  f0.feed = (I) => origFeed(Object.assign(I, script(g.time)));
  if (scen === 'walk') script = (t) => ({ mx: t < 2 ? 1 : t < 4 ? 0 : -1, mz: 0, run: t > 4 });
  if (scen === 'jump') script = (t) => ({ jump: Math.abs(t - 1) < 0.02 || Math.abs(t - 3) < 0.02 });
  if (scen === 'duel' || scen === 'grab') {
    const f1 = g.fighters[1];
    const p = f0.pos[0];
    f1.teleport(p.x + 1.2 - f1.pos[0].x, 0, p.z - f1.pos[0].z);
    g.brains.delete(f1);
    script = (t) => {
      const d = f1.pos[1].clone().sub(f0.pos[1]); d.y = 0; const l = d.length();
      if (scen === 'duel') return { mx: l > 1.1 ? d.x / l : 0, mz: l > 1.1 ? d.z / l : 0, punch: Math.floor(t * 3) !== Math.floor((t - dt) * 3) };
      return { mx: l > 0.8 ? d.x / l : 0, mz: l > 0.8 ? d.z / l : 0, grabL: t > 1, grabR: t > 1, lift: t > 2.5 && t < 4, };
    };
  }
  const t0 = g.time;
  for (let k = 0; k < secs * 60; k++) {
    g.tick(dt);
    if (k % 30 === 0) {
      log.push(g.fighters.map((f) => {
        const up = new f.rot[1].constructor(); // quaternion
        const cu = { x: 0, y: 1, z: 0 };
        const q = f.rot[1];
        // chest up.y
        const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
        return `${f.name} x=${f.pos[0].x.toFixed(2)} z=${f.pos[0].z.toFixed(2)} yaw=${f.yaw.toFixed(2)}${f.out ? ' OUT' : ''} t=${(g.time - t0).toFixed(1)} up=${uy.toFixed(2)} h=${f.pos[0].y.toFixed(2)} gr=${f.grounded ? 1 : 0} sp=${f.speed.toFixed(1)} daze=${f.daze.toFixed(0)} ko=${f.ko.toFixed(1)} hold=${f.holding() ? 1 : 0}`;
      }).join(' | '));
    }
  }
  return log;
}, { scen, secs, arena });
console.log(out.join('\n'));
if (shot) {
  await page.evaluate(() => { const g = window.__brawl; g.draw(1 / 60); });
  await page.screenshot({ path: shot });
}
await browser.close();
