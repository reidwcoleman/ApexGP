// Screenshots at camera poses:  node tools/lastframe/shot.mjs PORT OUTDIR "name:x,y,z,yaw,pitch" ...
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, ...views] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/GPU stall|GL Driver/.test(m.text()) && console.log(m.type(), m.text().slice(0, 400)));
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1${process.env.Q ?? ''}`);
await p.waitForFunction(() => window.__frames > 3, null, { timeout: 120000 });
for (const v of views) {
  const [name, c] = v.split(':');
  const n = c.split(',').map(Number);
  await p.evaluate((n) => {
    const { cam, post } = window.__lf;
    window.__pose?.(n);
    cam.position.set(n[0], n[1], n[2]);
    cam.rotation.set(n[4] ?? 0, n[3] ?? 0, 0, 'YXZ');
    post.cutExposure = true;
  }, n);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/${name}.png` });
}
await b.close();
