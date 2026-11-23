// One round of the attack-and-defend game with only bots, drawn from above: every bot's track (attackers blue, defenders
// amber), a tick every half second for where it was looking, a dot where it fired, a cross where it fell. For judging by
// eye how they move: do they cut corners, where do they look, do they use the corners they fight from.
//   node tools/lastframe/bottrace.mjs PORT map OUT.png [rounds to skip]      (SEED, BOTS, SKILL as siegesim)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, map = 'ward', out = 'trace.png', skip = '0'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&nodraw=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
await p.evaluate(([seed, bots, skill]) => {
  const g = __lf.g;
  g.startSolo({ mode: 'siege', bots, skill, time: 8, limit: 99, seed }, 'Tester', 0, 'carbine');
  g.halt = true;
}, [+(process.env.SEED ?? 5), +(process.env.BOTS ?? 5), +(process.env.SKILL ?? 0.5)]);
const round = () => p.evaluate(() => {
  const g = __lf.g, m = g.match, dt = 1 / 30;
  const tr = new Map(), shots = [], falls = [];
  const on = g.onEv.bind(g);
  g.onEv = (e) => { if (e.t === 'shot') shots.push([e.o[0], e.o[2], e.s]); if (e.t === 'die' || e.t === 'down') { const bd = m.bodies[e.s]; falls.push([bd.x, bd.z, e.t === 'die' ? 1 : 0]); } on(e); };
  let n = 0, live = 0;
  for (let guard = 0; guard < 30 * 400; guard++) {
    const me = m.players.find((q) => !q.bot);
    if (me?.alive && (m.phase === 'prep' || m.phase === 'live')) m.damage(me.slot, me.slot, 999, 1, 0, [0, 0, 1], 0);
    const ph = m.phase;
    m.update(dt);
    if (m.phase === 'live') {
      live += dt;
      n++;
      for (const q of m.players) {
        if (!q.bot || !q.alive) continue;
        const bt = m.bots.get(q.slot);
        if (!tr.has(q.slot)) tr.set(q.slot, { team: q.team, pts: [] });
        if (n % 3 === 0) tr.get(q.slot).pts.push([bt.m.x, bt.m.z, bt.yaw, bt.m.y, q.down ? 1 : 0, bt.target >= 0 ? 1 : 0]);
      }
    }
    if ((ph === 'live' || ph === 'prep') && m.phase === 'between') break;
  }
  g.onEv = on;
  const o = m.obj;
  const y0 = o.box[1];
  const walls = g.L.world.boxes.filter((bx) => !bx.off && !bx.slab && (bx.tag === 'int' || bx.tag === 'ext' || bx.tag === 'wall') && bx.max[1] > y0 + 1.5 && bx.min[1] < y0 + 0.6).map((bx) => [bx.min[0], bx.min[2], bx.max[0], bx.max[2]]);
  return { tracks: [...tr.values()], shots, falls, walls, obj: o.box, atk: m.atk, room: o.name, live, y0 };
});
for (let k = 0; k < +skip; k++) await round();
const R = await round();
// drawn in the page: a canvas is to hand there
const png = await p.evaluate((R) => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const t of R.tracks) for (const q of t.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
  x0 = Math.min(x0, R.obj[0]) - 3; x1 = Math.max(x1, R.obj[3]) + 3; z0 = Math.min(z0, R.obj[2]) - 3; z1 = Math.max(z1, R.obj[5]) + 3;
  if (R.zoom) { const cx = (R.obj[0] + R.obj[3]) / 2, cz = (R.obj[2] + R.obj[5]) / 2; x0 = cx - R.zoom * 1.5; x1 = cx + R.zoom * 1.5; z0 = cz - R.zoom; z1 = cz + R.zoom; }
  const k = Math.min(1700 / (x1 - x0), 1100 / (z1 - z0));
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0) * k);
  c.height = Math.ceil((z1 - z0) * k);
  const d = c.getContext('2d');
  const X = (x) => (x - x0) * k, Z = (z) => (z - z0) * k;
  d.fillStyle = '#101214'; d.fillRect(0, 0, c.width, c.height);
  d.fillStyle = 'rgba(231,165,91,.13)'; d.fillRect(X(R.obj[0]), Z(R.obj[2]), (R.obj[3] - R.obj[0]) * k, (R.obj[5] - R.obj[2]) * k);
  d.fillStyle = '#5b6066';
  for (const w of R.walls) d.fillRect(X(w[0]), Z(w[1]), Math.max(1.5, (w[2] - w[0]) * k), Math.max(1.5, (w[3] - w[1]) * k));
  for (const t of R.tracks) {
    const col = t.team === R.atk ? '#7fb2ff' : '#f0b060';
    d.strokeStyle = col; d.lineWidth = 1.6; d.beginPath();
    let pen = false;
    t.pts.forEach((q) => { if (Math.abs(q[3] - R.y0) > 2.2) { pen = false; return; } if (pen) d.lineTo(X(q[0]), Z(q[1])); else d.moveTo(X(q[0]), Z(q[1])); pen = true; });
    d.stroke();
    // where it was looking, every half second: red while someone was in its sights
    t.pts.forEach((q, i) => {
      if (i % 5 || Math.abs(q[3] - R.y0) > 2.2) return;
      d.strokeStyle = q[5] ? 'rgba(255,90,70,.9)' : 'rgba(255,255,255,.45)'; d.lineWidth = 1;
      d.beginPath(); d.moveTo(X(q[0]), Z(q[1])); d.lineTo(X(q[0] - Math.sin(q[2]) * 1.1), Z(q[1] - Math.cos(q[2]) * 1.1)); d.stroke();
    });
    const s = t.pts[0];
    if (s) { d.fillStyle = col; d.beginPath(); d.arc(X(s[0]), Z(s[1]), 4, 0, 6.3); d.fill(); }
  }
  d.fillStyle = 'rgba(255,230,120,.8)';
  for (const s of R.shots) d.fillRect(X(s[0]) - 1, Z(s[1]) - 1, 2.5, 2.5);
  d.strokeStyle = '#ff4030'; d.lineWidth = 2;
  for (const f of R.falls) { const x = X(f[0]), z = Z(f[1]); d.beginPath(); d.moveTo(x - 5, z - 5); d.lineTo(x + 5, z + 5); d.moveTo(x + 5, z - 5); d.lineTo(x - 5, z + 5); d.stroke(); }
  d.fillStyle = '#fff'; d.font = '14px sans-serif';
  d.fillText(`${R.room}  ${R.live.toFixed(0)} s  attackers blue, defenders amber; ticks: where they look (red: someone in the sights); yellow: shots; crosses: falls`, 10, 18);
  return c.toDataURL('image/png').split(',')[1];
}, { ...R, zoom: +(process.env.ZOOM ?? 0) });
fs.writeFileSync(out, Buffer.from(png, 'base64'));
console.log('wrote', out, R.room, R.live.toFixed(0) + ' s');
await b.close();
