// Frame cost round the cove:  node tools/lastframe/coveperf.mjs PORT [w h] [bots]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, w = '1600', h = '900', bots = '6'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=cove`);
await p.waitForFunction(() => window.__lf, null, { timeout: 240000 });
await p.evaluate((n) => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: n, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); }, +bots);
await p.waitForTimeout(5000);
await p.evaluate(() => { const g = __lf.g; for (const b of g.match.bots.values()) b.update = () => {}; g.match.players.find((q) => q.slot === g.mySlot).hp = 1e6; });
const bench = (label, x, yn, yaw, pitch, setup) => p.evaluate(async ([label, x, yn, yaw, pitch, setup]) => {
  const g = __lf.g, gl = __lf.r.getContext(), w = g.L.world, z = -yn;
  Object.assign(g.me.m, { x, y: w.floorAt(x, 60, z, 0.2, 0), z, vx: 0, vz: 0, vy: 0 });
  g.me.yaw = yaw; g.me.pitch = pitch;
  g.halt = true;
  if (setup) (new Function('g', setup))(g);
  const px = new Uint8Array(4);
  for (let i = 0; i < 8; i++) { g.tick(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
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
  const i = __lf.r.info.render;
  return `${label}: frame ${ts[12].toFixed(1)} ms, cpu ${cpu[12].toFixed(1)}, calls ${i.calls}, tris ${(i.triangles / 1000).toFixed(0)}k`;
}, [label, x, yn, yaw, pitch, setup]).then(console.log);
await bench('lane', 30, 86, -0.2, 0.05);
await bench('square', 22, 50, 0.3, 0.05);
await bench('headland (all of it in view)', -80, 30, -2.0, -0.08);
await bench('field', 120, 80, 1.8, -0.12);
await bench('lane, no veg', 30, 86, -0.2, 0.05, "g.L.vegCells.length=0; g.L.group.traverse(o=>{ if(o.name==='veg') o.visible=false; });");
await bench('+no grass', 30, 86, -0.2, 0.05, "g.L.grass.group.visible=false; g.L.grass.update=function(){};");
await bench('+no sea', 30, 86, -0.2, 0.05, "g.scene.getObjectByName('sea').visible=false;");
await bench('+no units', 30, 86, -0.2, 0.05, "g.L.group.traverse(o=>{ if(o.isInstancedMesh) o.visible=false; });");
await bench('+no sun map update', 30, 86, -0.2, 0.05, "g.sun.update=function(){};");
await bench('+no people', 30, 86, -0.2, 0.05, "for (const a of g.actors.values()) if (a.soldier) a.soldier.root.visible=false;");
await bench('+post lite', 30, 86, -0.2, 0.05, "g.post.lite=true; g.liteK=9;");
await b.close();
