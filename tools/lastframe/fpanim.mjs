// The player's own hands and gun in motion, frame by frame: the game is stopped and stepped by hand, so each picture is an
// exact moment. One sheet a sequence: firing, a reload, walking, running, changing weapon.
//   node tools/lastframe/fpanim.mjs PORT OUT [weapon] [sequences: fire,reload,walk,run,swap,ads]      (TIER, AT as fpshots)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, weapon = 'carbine', seqs = 'fire,reload,walk'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=ward`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
const at = (process.env.AT ?? '30,0,-5,1.5').split(',').map(Number);
await p.evaluate(([tier, w, at, mag]) => {
  localStorage.setItem('lastframe.played', '9');
  const g = __lf.g; g.gfx = tier; g.setTier(tier);
  g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear();
  window.__set = () => { const m = g.me; m.slots = [w, 'pistol']; m.cur = 0; m.ammo.set(w, { mag, res: 90 }); Object.assign(m.m, { x: at[0], y: at[1], z: at[2], vx: 0, vz: 0 }); m.yaw = at[3]; m.pitch = -0.12; m.light = true; g.input.ads = false; g.input.fire = false; g.input.keys.clear(); document.querySelector('.banner')?.remove(); };
  window.__step = (n) => { for (let k = 0; k < n; k++) { g.time += 1 / 60; g.tick(1 / 60, 1 / 60); } };
}, [+(process.env.TIER ?? 2), weapon, at, +(process.env.MAG ?? 9)]);
await p.waitForTimeout(7000);
await p.evaluate(() => { __lf.g.halt = true; window.__set(); window.__step(90); });
const SEQ = {
  // [what to do first, frames to step before each picture]
  fire: [() => { const g = __lf.g; g.input.fire = true; g.input.firePressed = true; }, [1, 1, 1, 1, 2, 2, 3, 4, 6, 10, 14, 20], () => { __lf.g.input.fire = false; }, 2],
  reload: [() => { __lf.g.input.pressed.add('KeyR'); }, [2, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], null, 0],
  walk: [() => { __lf.g.input.keys.add('KeyW'); }, [20, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], null, 0],
  run: [() => { __lf.g.input.keys.add('KeyW'); __lf.g.input.keys.add('ShiftLeft'); }, [30, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], null, 0],
  swap: [() => { __lf.g.input.pressed.add('Digit2'); }, [2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], null, 0],
  ads: [() => { __lf.g.input.ads = true; }, [1, 2, 2, 2, 2, 3, 3, 4, 6, 8, 10, 12], null, 0],
  // held down, a picture every frame; one shot and the whole of what follows it; the same down the sights
  burst: [() => { const g = __lf.g; g.input.fire = true; g.input.firePressed = true; }, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], null, 0],
  shot: [() => { const g = __lf.g; g.input.fire = true; g.input.firePressed = true; }, [1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 8, 8, 8, 8], () => { __lf.g.input.fire = false; }, 1],
  adsburst: [() => { const g = __lf.g; g.input.ads = true; window.__step(40); g.input.fire = true; g.input.firePressed = true; }, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], null, 0],
};
for (const name of seqs.split(',')) {
  const [start, steps, stop, stopAfter] = SEQ[name];
  await p.evaluate(() => { window.__set(); window.__step(40); });
  await p.evaluate(start);
  const shots = [];
  for (let k = 0; k < steps.length; k++) {
    if (stop && k === stopAfter) await p.evaluate(stop);
    await p.evaluate((n) => window.__step(n), steps[k]);
    await p.waitForTimeout(60);
    shots.push(await p.screenshot({ clip: { x: 300, y: 150, width: 660, height: 390 } }));
  }
  // one sheet: four across
  const sheet = await p.evaluate(async (list) => {
    const ims = await Promise.all(list.map((d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d; })));
    const cols = 4, rows = Math.ceil(ims.length / cols), w = 495, h = 292;
    const c = document.createElement('canvas'); c.width = cols * w; c.height = rows * h;
    const x = c.getContext('2d');
    ims.forEach((im, i) => x.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h, w, h));
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, shots.map((s) => s.toString('base64')));
  fs.writeFileSync(`${out}/${weapon}_${name}.jpg`, Buffer.from(sheet, 'base64'));
  await p.evaluate(() => { __lf.g.input.keys.clear(); __lf.g.input.ads = false; __lf.g.input.fire = false; window.__step(150); });
}
await b.close();
