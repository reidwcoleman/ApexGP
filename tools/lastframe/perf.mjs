// Frame cost at a size:  node tools/lastframe/perf.mjs PORT [w h]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, w = '1920', h = '1080'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
await p.goto(`http://localhost:${port}/lastframe.html?dev=1${process.env.MAP ? "&map=" + process.env.MAP : ""}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 5, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.me.light = true; });
await p.waitForTimeout(6000);
const bench = (label, setup) => p.evaluate(async ([label, setup]) => {
  const g = __lf.g, gl = __lf.r.getContext();
  g.halt = true;
  if (setup) (new Function('g', setup))(g);
  const px = new Uint8Array(4);
  for (let i = 0; i < 6; i++) { g.tick(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const ts = [], cpu = [];
  for (let i = 0; i < 24; i++) {
    const t0 = performance.now();
    g.tick(0.016);
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    cpu.push(t1 - t0);
    ts.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 4));
  }
  ts.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
  g.halt = false;
  return label + ': frame ' + ts[12].toFixed(1) + ' ms, cpu ' + cpu[12].toFixed(1);
}, [label, setup]).then(console.log);
await p.evaluate(() => { const g = __lf.g; for (const b of g.match.bots.values()) b.update = () => {}; Object.assign(g.me.m, { x: 30, y: 0, z: -6, vx: 0, vz: 0 }); g.me.yaw = -1.57; g.me.light = true; g.match.players.find((q) => q.slot === g.mySlot).hp = 1e6; });
await p.waitForTimeout(400);
await bench('street all on');
await bench('no msaa', "g.scale = 0.94; g.resize();");
await bench('+no planar', "g.planar.render = function(){}; ");
await bench('+no blur', "g.post.motionBlur = false;");
await bench('+no shadow', "g.r.shadowMap.autoUpdate = false;");
await bench('+others off', "for (const o of g.others) o.visible = false; g.flashPoint.visible = false;");
await b.close();
