// control feel: a human seat on a flat arena; measures speed ramp, turn time, jump height, punch/grab latency
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5196/brawl.html?manual`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const out = await page.evaluate(async (arena) => {
  const g = window.__brawl;
  const seats = g.cpuSeats(1);
  seats[0].dev = 'kb1'; seats[0].cpu = false;
  await g.startMatch(seats, arena, 3);
  g.state = 'fight';
  const f = g.fighters[0], F = g.input.forced;
  const T = (n, set) => { if (set) F.set('kb1', set); else F.delete('kb1'); for (let k = 0; k < n; k++) g.tick(1 / 60); };
  const v = () => { const l = f.bodies[0].linvel(); return Math.hypot(l.x, l.z); };
  const yaw = () => { const d = f.pos[2].clone().sub(f.pos[0]); return 0; };
  T(90);
  const res = {};
  // speed ramp walking right
  const ramp = [];
  for (let k = 0; k < 6; k++) { T(10, { lx: 1 }); ramp.push(+v().toFixed(2)); }
  res.walkRamp = ramp;
  const run = [];
  for (let k = 0; k < 6; k++) { T(10, { lx: 1, run: true }); run.push(+v().toFixed(2)); }
  res.runRamp = run;
  // reverse: frames until moving left
  let n = 0; while (f.bodies[0].linvel().x > 0 && n < 120) { T(1, { lx: -1 }); n++; }
  res.reverseFrames = n;
  // stop: frames until speed < 0.3
  n = 0; while (v() > 0.3 && n < 120) { T(1, {}); n++; }
  res.stopFrames = n;
  T(60);
  const y0 = f.pos[0].y; let ymax = y0;
  T(1, { jump: true }); for (let k = 0; k < 60; k++) { T(1, {}); ymax = Math.max(ymax, f.pos[0].y); }
  res.jumpH = +(ymax - y0).toFixed(2);
  res.facing = Object.keys(f).filter((k) => /face|yaw|head/i.test(k));
  return res;
}, process.argv[2] ?? 'cake');
console.log(JSON.stringify(out));
await browser.close();
