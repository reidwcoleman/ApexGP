// In-process circuit switching, end to end: one page load, travel through circuits, race on each,
// screenshots of the menu garage and of the race on every circuit, GPU memory after each step.
//   node tools/traveltest.mjs [--route spa,silverstone,monza] [--out shots/travel] [--race 1]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const route = opt('route', 'spa,silverstone,monza').split(',');
const out = opt('out', 'shots/travel');
const race = opt('race', '1') === '1';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[error] ' + m.text());
  if (m.text().includes('[travel]')) console.log(m.text().replace('[shot] ', ''));
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
const t0 = Date.now();
await page.goto('http://localhost:5191/?track=monza&settle=300', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
console.log('boot', Date.now() - t0, 'ms');
const mem = () =>
  page.evaluate(() => {
    window.gc?.();
    const g = window.__game;
    return { ...g.gfx.renderer.info.memory, programs: g.gfx.renderer.info.programs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, track: g.track.def.id };
  });
const settle = (ms) => page.waitForTimeout(ms);
const shoot = async (name) => {
  await page.screenshot({ path: `${out}_${name}.png` });
};
const raceHere = async (id) => {
  await page.evaluate(() => window.__game.debugStart({ autopilot: true, skip: 25, camera: 'chase' }));
  await settle(2500);
  await shoot(`${id}_race`);
  const fps = await page.evaluate(() => ({ fps: window.__fps, gpu: window.__gpuMs, pos: window.__game.race.player.position, s: Math.round(window.__game.race.player.car.s), kmh: Math.round(window.__game.race.player.car.vx * 3.6) }));
  console.log(`  race at ${id}:`, JSON.stringify(fps));
  await page.evaluate(() => window.__game.toMenu());
  await settle(800);
};
console.log('monza', JSON.stringify(await mem()));
await settle(1200);
await shoot('monza_menu');
if (race) await raceHere('monza0');
for (const id of route) {
  const t = Date.now();
  await page.evaluate((id) => window.__game.travelAsync(id), id);
  const ms = Date.now() - t;
  await settle(1200);
  console.log(id, `${ms} ms`, JSON.stringify(await mem()));
  await shoot(`${id}_menu`);
  if (race) await raceHere(id);
}
console.log('after', JSON.stringify(await mem()));
for (const e of errors.slice(0, 20)) console.log(e);
await browser.close();
