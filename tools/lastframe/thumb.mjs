// A still of a location for its card:  node tools/lastframe/thumb.mjs PORT MAP X Y Z YAW PITCH [light]
// First person from that spot (game axes), the wearer's body and the interface hidden. Writes public/lastframe/thumbs/MAP.webp at 640 x 360.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import { execFileSync } from 'node:child_process';
const [port, map, x, y, z, yaw, pitch, light = '1'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.autoInput = true; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(6500);
await p.evaluate(([x, y, z, yaw, pitch, light]) => {
  const g = __lf.g;
  Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 });
  g.me.yaw = yaw;
  g.me.pitch = pitch;
  g.me.light = light > 0;
  g.me.freeAim = false;
  g.post.cutExposure = true;
  document.getElementById('ui').style.display = 'none';
}, [+x, +y, +z, +yaw, +pitch, +light]);
await p.waitForTimeout(1500);
const tmp = `/tmp/lf_thumb_${map}.png`;
await p.screenshot({ path: tmp });
await b.close();
execFileSync('python3', ['-c', `from PIL import Image; Image.open('${tmp}').convert('RGB').resize((640, 360), Image.LANCZOS).save('public/lastframe/thumbs/${map}.webp', quality=82, method=6)`]);
console.log('wrote', `public/lastframe/thumbs/${map}.webp`);
