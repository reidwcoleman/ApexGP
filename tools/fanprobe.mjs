// Fans (stand/bank crowd instances, concourse walkers, trackside people) standing on the
// track or its run-off, per circuit.   node tools/fanprobe.mjs [ids...]
import { chromium } from 'playwright-core';
const ids = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${ids[0] ?? 'monza'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
for (const id of ids) {
  const r = await page.evaluate(async (id) => {
    const g = window.__game;
    if (g.track.def.id !== id) await g.travelAsync(id);
    const T = g.track;
    const bad = [];
    const m = new (g.camera.matrix.constructor)();
    const check = (x, z, what) => {
      const pr = T.project(x, z);
      const side = pr.lateral < 0 ? -1 : 1;
      const edge = T.halfWidthAt(pr.s) + 1.5;
      const bar = T.barrierAt(pr.s, side);
      const lat = Math.abs(pr.lateral);
      // on the road, or inside the barriers (run-off) on a non-pit stretch
      if (lat < edge || (lat < bar - 0.3 && !T.inPit(pr.s))) bad.push({ what, s: Math.round(pr.s), lat: +pr.lateral.toFixed(1), edge: +edge.toFixed(1), bar: +bar.toFixed(1) });
    };
    let n = 0;
    g.scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const nm = o.name || o.parent?.name || '';
      if (!/crowd|people|fans|extras|spectat/i.test(nm)) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const e = m.elements;
        const x = e[12], z = e[14];
        // world space
        const v = { x, y: e[13], z };
        o.updateWorldMatrix(true, false);
        const w = o.matrixWorld.elements;
        const wx = w[0] * v.x + w[4] * v.y + w[8] * v.z + w[12];
        const wz = w[2] * v.x + w[6] * v.y + w[10] * v.z + w[14];
        n++;
        check(wx, wz, nm);
      }
    });
    // the instanced people are drawn only near the camera: check their places instead
    g.scene.traverse((o) => {
      const P = o.userData?.people;
      if (!P) return;
      for (const mm of P.marshals ?? []) { n++; check(mm.pos.x, mm.pos.z, 'marshal'); }
      for (const ph of P.photographers ?? []) { n++; check(ph.pos.x, ph.pos.z, 'photographer'); }
      for (const w of P.walkers ?? []) for (const q of w.path) { n++; check(q.x, q.z, o.name + ':walker'); }
      const ex = P.extras;
      for (const sp of ex?.specs ?? []) { n++; check(sp.x, sp.z, o.name + ':spec'); }
    });
    const byWhat = {};
    for (const b of bad) byWhat[b.what] = (byWhat[b.what] ?? 0) + 1;
    return { id, checked: n, bad: bad.length, byWhat, sample: bad.slice(0, 8) };
  }, id);
  console.log(JSON.stringify(r));
}
await browser.close();
