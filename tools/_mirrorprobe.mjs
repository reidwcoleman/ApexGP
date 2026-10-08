// Mirror check: a live race in the cockpit view, the lens swung onto each rear-view mirror and
// zoomed (a 14° lens from the driver's eye), plus the T-cam. Shots in <out>.
//   PORT=5803 node tools/_mirrorprobe.mjs <out> [weather] [time]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const [out = 'shots/mirror', weather = 'clear', time = 'afternoon'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5803}/?track=monza&demo=race&cam=cockpit&skip=${process.env.SKIP ?? 30}&weather=${weather}&time=${time}`);
await page.waitForFunction(() => window.__game && window.__ready === true, null, { timeout: 300000 });
await page.evaluate(() => {
  document.getElementById('ui').style.visibility = 'hidden';
  const g = window.__game;
  g.adaptQuality = () => {};
  const cams = g.cams;
  const orig = cams.update.bind(cams);
  window.__aim = null;
  cams.update = (...a) => {
    orig(...a);
    if (!window.__aim) return;
    const rig = g.rigs.get(g.race.player.entry);
    const p = rig.body.localToWorld(new rig.root.position.constructor(window.__aim, 0.715, 0.53));
    cams.camera.up.set(0, 1, 0);
    cams.camera.lookAt(p);
    cams.camera.fov = 14;
    cams.camera.updateProjectionMatrix();
  };
});
for (let k = 0; k < Number(process.env.N ?? 1); k++) {
  for (const [name, aim] of [['left', 0.515], ['right', -0.515]]) {
    await page.evaluate((a) => (window.__aim = a), aim);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/mirror_${name}${k}.png` });
  }
  // where the cars behind are, in the player's car frame (x left, z forward)
  console.log(await page.evaluate(() => {
    const g = window.__game;
    const own = g.rigs.get(g.race.player.entry).root;
    const inv = own.matrixWorld.clone().invert();
    const out = [];
    for (const r of g.rigs.values()) {
      if (r.root === own) continue;
      const p = r.root.position.clone().applyMatrix4(inv);
      if (p.z < 2 && p.length() < 60) out.push(`(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    return out.join(' ');
  }));
}
const n = await page.evaluate(() => {
  let s = '';
  window.__game.scene.traverse((o) => {
    if (o.material?.name === 'car-mirror' && o.material.userData.mirror.uMirOn.value) s += o.material.userData.mirror.uMirN.value + ' ';
  });
  return s;
});
console.log('mirror cars fed:', n);
await browser.close();
