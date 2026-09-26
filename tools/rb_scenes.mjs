// People scenes: screenshot + draw calls / triangles (total, and the people's share) + frame time.
//   node tools/rb_scenes.mjs <garage|podium|grid|race|pit> shots/prefix [--track monza] [--port 5191] [--cam tv]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const scene = args[0] ?? 'garage';
const prefix = args[1] ?? 'shots/rb';
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5191');
const track = opt('track', 'monza');
const cam = opt('cam', 'tv');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.text().startsWith('[rb]')) console.log('[' + m.type() + '] ' + m.text().slice(0, 400));
});
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?track=${track}&settle=500`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
console.log('ready in', Date.now() - t0, 'ms');
const setup = await page.evaluate(
  async ([scene, cam]) => {
    const g = window.__game;
    g.adaptQuality = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (scene === 'garage') {
      g.menu.setTab('race');
      await sleep(7000);
    } else if (scene === 'podium') {
      g.debugStart({ autopilot: true, skip: 20, camera: 'chase' });
      await sleep(1500);
      g.startCelebration();
      await sleep(12000);
    } else if (scene === 'grid') {
      g.debugStart({ autopilot: true, camera: cam });
      await sleep(5000);
    } else if (scene === 'race') {
      g.debugStart({ autopilot: true, skip: 8, camera: cam });
      await sleep(4000);
    } else if (scene === 'pit') {
      g.debugStart({ autopilot: true, skip: 62, laps: 10, camera: 'cine' });
      g.race.playerPitRequest = true;
      const tEnd = performance.now() + 120000;
      while (performance.now() < tEnd && g.race.player.pit.phase !== 'stop') await sleep(100);
      await sleep(600);
      return { pit: g.race.player.pit.phase };
    }
    return {};
  },
  [scene, cam],
);
console.log('setup', JSON.stringify(setup));
// --close i[,dist[,height]]: pin the camera on the i-th visible person (nearest first), in front of their face
const close = opt('close', null);
if (close !== null) {
  const [idx, dist, dh] = close.split(',').map(Number);
  const r = await page.evaluate(([idx, dist, dh]) => {
    const g = window.__game;
    const cam = g.camera;
    const people = [];
    g.scene.traverse((o) => {
      if (o.name === 'person' && o.visible) {
        let vis = true;
        for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
        if (vis) people.push(o);
      }
    });
    const cp = cam.position.clone();
    people.sort((a, b) => a.getWorldPosition(cp.clone()).distanceTo(cam.position) - b.getWorldPosition(cp.clone()).distanceTo(cam.position));
    const p = people[idx];
    if (!p) return { n: people.length };
    let head = null;
    p.traverse((b) => { if (b.name === 'Bip01_Head' || (b.name === 'Head' && !head)) head = b; });
    const V = cam.position.constructor;
    const hp = head.getWorldPosition(new V());
    const fwd = new V(0, 0, 1).applyQuaternion(p.getWorldQuaternion(cam.quaternion.clone()));
    const eye = hp.clone().addScaledVector(fwd, dist || 1.4);
    eye.y += dh || 0;
    const target = hp.clone();
    target.y -= (dist || 1.4) > 2 ? 0.5 : 0.05;
    const orig = cam.updateMatrixWorld.bind(cam);
    cam.updateMatrixWorld = (f) => {
      cam.position.copy(eye);
      cam.lookAt(target);
      if (cam.fov !== 30) { cam.fov = 30; cam.updateProjectionMatrix(); }
      orig(f);
    };
    return { n: people.length, at: hp.toArray().map((x) => +x.toFixed(2)) };
  }, [idx, dist, dh]);
  console.log('close', JSON.stringify(r));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${prefix}_${scene}_close${idx}.png` });
  console.log('saved', `${prefix}_${scene}_close${idx}.png`);
}
// --pin dx,dy,dz,yawDeg,pitchDeg,fov: the camera pinned relative to the player's car (x right, z ahead, yaw left of ahead)
const pin = opt('pin', null);
if (pin !== null) {
  const v = pin.split(',').map(Number);
  await page.evaluate((v) => {
    const g = window.__game;
    const cam = g.camera;
    const car = g.rigs.get(g.race.player.entry).root;
    car.updateMatrixWorld(true);
    const V = cam.position.constructor;
    const eye = new V(v[0], v[1], v[2]).applyMatrix4(car.matrixWorld);
    const q = car.getWorldQuaternion(cam.quaternion.clone());
    const yaw = (v[3] * Math.PI) / 180, pitch = (v[4] * Math.PI) / 180;
    const dir = new V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(q);
    const target = eye.clone().add(dir);
    const orig = cam.updateMatrixWorld.bind(cam);
    cam.updateMatrixWorld = (f) => {
      cam.position.copy(eye);
      cam.lookAt(target);
      if (cam.fov !== v[5]) { cam.fov = v[5]; cam.updateProjectionMatrix(); }
      orig(f);
    };
  }, v);
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: `${prefix}_${scene}.png` });
console.log('saved', `${prefix}_${scene}.png`);
const stats = await page.evaluate(async () => {
  const g = window.__game;
  const r = g.gfx.renderer;
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
  const PEOPLE = /^(person|fan-crowd|pit_crews)$/;
  const acc = { all: { calls: 0, tris: 0 }, people: { calls: 0, tris: 0 }, peopleShadow: { calls: 0, tris: 0 } };
  let on = false;
  const orig = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = (camera, sc, geo, mat, obj, group) => {
    if (on) {
      let n = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
      if (group) n = Math.min(n, group.count);
      n = Math.min(n, geo.drawRange.count);
      const inst = obj.isInstancedMesh ? obj.count : geo.isInstancedBufferGeometry ? geo.instanceCount : 1;
      const tris = (n / 3) * (isFinite(inst) ? inst : 1);
      acc.all.calls++;
      acc.all.tris += tris;
      let ppl = false;
      for (let p = obj; p; p = p.parent) if (PEOPLE.test(p.name)) { ppl = true; break; }
      if (ppl) {
        const shadow = camera !== g.camera && camera.isOrthographicCamera;
        const k = shadow ? acc.peopleShadow : acc.people;
        k.calls++;
        k.tris += tris;
      }
    }
    return orig(camera, sc, geo, mat, obj, group);
  };
  on = true;
  await frames(2);
  on = false;
  r.renderBufferDirect = orig;
  const f = (x) => ({ calls: x.calls / 2, ktris: Math.round(x.tris / 2000) });
  // frame time over 90 frames
  const ts = [];
  await new Promise((res) => { let last = performance.now(); let k = 0; const step = () => { const now = performance.now(); ts.push(now - last); last = now; if (++k < 90) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  ts.sort((a, b) => a - b);
  const mem = r.info.memory;
  return { all: f(acc.all), people: f(acc.people), peopleShadow: f(acc.peopleShadow), frameMs: { median: +ts[45].toFixed(1), p90: +ts[81].toFixed(1) }, geometries: mem.geometries, textures: mem.textures, programs: r.info.programs?.length };
});
console.log(scene, 'stats', JSON.stringify(stats));
await browser.close();
