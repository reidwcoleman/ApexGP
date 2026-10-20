// Shader programs made AFTER the race is under way (each one a stalled frame): boots a demo race,
// then cycles every camera and runs on, and lists the programs that appeared.
//   node tools/_midcompile.mjs [track] [weather] [time] [port]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', wx = 'clear', time = 'afternoon', port = '5191'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/?track=${track}&demo=race&cam=chase&skip=${process.env.SKIP ?? 5}&weather=${wx}&time=${time}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.waitForTimeout(500);
const r = await page.evaluate(async () => {
  const g = window.__game;
  const r = g.gfx.renderer;
  const name = (p) => p.name || p.cacheKey?.slice(0, 60);
  const before = new Set(r.info.programs);
  // (made earlier but never drawn yet: the first draw asks the driver for its uniforms, a blocking round trip if it is still linking)
  const slow = [];
  const wrap = (p) => { if (p.__mcWrapped) return; p.__mcWrapped = true; const f = p.getUniforms; p.getUniforms = function () { const t = performance.now(); const u = f.call(this); const d = performance.now() - t; if (d > 2) slow.push(`${name(p)} ${d.toFixed(0)} ms`); return u; }; };
  r.info.programs.forEach(wrap);
  const unused = new Set();
  const log = [];
  const seen = new Set();
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (what) => {
    for (const p of r.info.programs) {
      wrap(p);
      if (!before.has(p) && !seen.has(p)) { seen.add(p); log.push(`${what}: NEW ${name(p)}`); }
      else if (unused.has(p) && p.cachedUniforms !== undefined && !seen.has(p)) { seen.add(p); log.push(`${what}: first use ${name(p)}`); }
    }
    while (slow.length) log.push(`${what}: slow first use ${slow.shift()}`);
  };
  // frames of plain racing first
  for (let i = 0; i < 6; i++) { await wait(500); check('race'); }
  const modes = ['tcam', 'tcamoff', 'halo', 'cockpit', 'helmet', 'bonnet', 'nose', 'bumper', 'fwing', 'sidepod', 'wheel', 'wheelr', 'sideback', 'tcamrev', 'rwing', 'chase', 'far', 'lowchase', 'gtchase', 'drone', 'cine', 'tv', 'tower', 'longlens', 'kerb', 'pitwall', 'grandstand', 'gantry', 'heli', 'blimp', 'topdown', 'director'];
  for (const m of modes) { try { g.cams.set(m); } catch { continue; } await wait(700); check('cam ' + m); }
  g.cams.set('chase');
  for (let i = 0; i < 10; i++) { await wait(1000); check('race2'); }
  return { log, total: r.info.programs.length };
});
console.log(`programs ${r.total}, made or first used mid-race ${r.log.length}`);
for (const l of r.log) console.log('  ', l);
await browser.close();
