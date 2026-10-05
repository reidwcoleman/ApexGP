// Is anything standing on the racing surface? Boots each circuit and checks every scenery vertex
// (instanced meshes: each instance's box) against the asphalt: a point inside the track edges and
// 0.12–4.5 m above the surface is reported (overhead bridges and gantries are higher; kerbs, lines
// and the road itself are skipped by name).
//   node tools/trackclear.mjs [track,...]      (PORT env = dev server, default 5196)
import { chromium } from 'playwright-core';
const ALL = ['monza', 'spa', 'silverstone', 'suzuka', 'montreal', 'melbourne', 'spielberg', 'zandvoort', 'austin', 'interlagos', 'hungaroring', 'sakhir', 'mexico', 'yasmarina'];
const tracks = process.argv[2] ? process.argv[2].split(',') : ALL;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
for (const track of tracks) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=3`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
  const hits = await page.evaluate(() => {
    const g = window.__game;
    const map = window.__park.map;
    const t = g.track;
    const THREE_V = g.camera.position.constructor;
    const v = new THREE_V();
    // things that belong on (or are) the road, or move: the cars, the sky, the particles
    const SKIP = /^(terrain|grass|skidmarks|ts_asphalt|ts_line|ts_kerb|ts_paint|ts_decal|ts_rubber|ts_marbles|track|road|kerb|line|horizon|sky|rain|spray|smoke|spark|particles|dust|marbles|clouds|sun|moon|headlight|L0|L1|L2|shadow-proxy|crew|garage|helmet|driver|wheel|tyre|halo|car|debris|flag_marshal|fx-)/i;
    const inRig = new Set();
    for (const rig of g.rigs.values()) rig.root.traverse((o) => inRig.add(o));
    const found = new Map();
    const test = (name, x, y, z) => {
      const pr = map.projectNear(x, z);
      if (!pr) return;
      // (the pit lane's own surface, bollards and wall ends where it merges are the pit's)
      if (/^pit_/.test(name) && map.inPitZone(x, z, 0)) return;
      const hw = t.halfWidthAt(pr.s);
      if (Math.abs(pr.lat) > hw - 0.3) return;
      // (the pit lane runs beside the track; where they merge, the pit side is the pit's)
      const p = g.trackPoint(pr.s, pr.lat, 0);
      const dy = y - p[1];
      if (dy < 0.12 || dy > 4.5) return;
      const k = `${name}@${Math.round(pr.s / 10) * 10}`;
      if (!found.has(k)) found.set(k, { name, s: Math.round(pr.s), lat: +pr.lat.toFixed(1), dy: +dy.toFixed(2), x: Math.round(x), z: Math.round(z) });
    };
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.geometry || inRig.has(o) || !o.visible) return;
      let vis = true;
      for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      const name = o.name || o.parent?.name || '?';
      if (SKIP.test(name)) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      if (o.isBatchedMesh) {
        // (a BatchedMesh's buffers hold its prototypes at the origin: test each instance's box)
        const m = new o.matrixWorld.constructor();
        if (!o.boundingBox) o.computeBoundingBox();
        const box = o.boundingBox.clone();
        for (let i = 0; i < (o.instanceCount ?? o._instanceInfo?.length ?? 0); i++) {
          try {
            if (o.getVisibleAt && !o.getVisibleAt(i)) continue;
            o.getMatrixAt(i, m);
            const b = o.getBoundingBoxAt(o.getGeometryIdAt(i), box);
            if (!b) continue;
            m.premultiply(o.matrixWorld);
            for (const [fx, fy, fz] of [[0.5, 0.5, 0.5], [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0.5, 1, 0.5]]) {
              v.set(b.min.x + (b.max.x - b.min.x) * fx, b.min.y + (b.max.y - b.min.y) * fy, b.min.z + (b.max.z - b.min.z) * fz).applyMatrix4(m);
              test(name, v.x, v.y, v.z);
            }
          } catch {}
        }
      } else if (o.isInstancedMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        const m = new o.matrixWorld.constructor();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          m.premultiply(o.matrixWorld);
          for (const [fx, fy, fz] of [[0.5, 0.5, 0.5], [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0.5, 1, 0.5]]) {
            v.set(b.min.x + (b.max.x - b.min.x) * fx, b.min.y + (b.max.y - b.min.y) * fy, b.min.z + (b.max.z - b.min.z) * fz).applyMatrix4(m);
            test(name, v.x, v.y, v.z);
          }
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          test(name, v.x, v.y, v.z);
        }
      }
    });
    return [...found.values()];
  });
  bad += hits.length;
  console.log(`== ${track}: ${hits.length ? hits.length + ' spots' : 'clear'}`);
  for (const h of hits.slice(0, 40)) console.log('  ', JSON.stringify(h));
  await page.close();
}
console.log(bad ? `${bad} spots` : 'all clear');
await browser.close();
