// Front close-ups of pit-crew helmets during the player's stop: node tools/helmetshot.mjs [out=shots/helmet] [n=3]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/helmet', n = '3'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5191/?track=monza&weather=clear&time=afternoon');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  g.debugStart({ autopilot: true, skip: 62, laps: 10, camera: 'cine', weather: 'clear', time: 'afternoon' });
  g.race.playerPitRequest = true;
  const tEnd = performance.now() + 120000;
  while (performance.now() < tEnd && g.race.player.pit.phase !== 'stop') await sleep(100);
  document.getElementById('ui').style.visibility = 'hidden';
});
for (let i = 0; i < Number(n); i++) {
  const ok = await page.evaluate((i) => {
    const g = window.__game;
    const hs = [];
    g.scene.traverse((o) => {
      if (o.name !== 'crew-helmet') return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      hs.push(o);
    });
    const cam = g.camera.position;
    const V = (o) => o.getWorldPosition(o.position.clone().set(0, 0, 0));
    const bone = (h) => h.skeleton.bones.find((b) => /Head$/.test(b.name)) ?? h.skeleton.bones[0];
    hs.sort((a, b) => V(bone(a)).distanceTo(cam) - V(bone(b)).distanceTo(cam));
    const h = hs[i];
    if (!h) return false;
    let root = h;
    while (root.parent && root.parent.name !== 'pit_crews') root = root.parent;
    // the helmet's centre from its skinned vertices (bone matrices as last rendered)
    const head = h.position.clone().set(0, 0, 0), v = head.clone();
    const N = h.geometry.getAttribute('position').count;
    for (let k = 0; k < N; k += 97) head.add(h.localToWorld(h.getVertexPosition(k, v)));
    head.multiplyScalar(1 / Math.ceil(N / 97));
    const q = root.getWorldQuaternion(root.quaternion.clone());
    const f = { x: 2 * (q.x * q.z + q.w * q.y), z: 1 - 2 * (q.x * q.x + q.y * q.y) };
    const yaw = Math.atan2(f.x, f.z) + 0.45;
    g.freeCam = { pos: [head.x + Math.sin(yaw) * 0.85, head.y + 0.08, head.z + Math.cos(yaw) * 0.85], look: [head.x, head.y + 0.05, head.z], fov: 40 };
    g.race.paused = true;
    return true;
  }, i);
  if (!ok) break;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}_${i}.png` });
  console.log(`${out}_${i}.png`);
}
await browser.close();
