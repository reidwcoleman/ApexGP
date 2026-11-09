// Bluebird Peak: boot, the orbit camera (and a cinematic tour), the night snowcat fleet, bonus drops
// you can click, labels over lifts and trails, celebrations, Marta's first tips, saving, the frame loop.
import * as THREE from 'three';
import { Mountain, RUNS, LIFTS, RUN_BY, LIFT_BY, BUILD_SPOTS, HALF } from './mountain.ts';
import { Sim, money, type SaveState } from './sim.ts';
import { World } from './world.ts';
import { Village } from './village.ts';
import { Lifts } from './lifts.ts';
import { Crowd } from './crowd.ts';
import { Snowcat } from './actors.ts';
import { Fx } from './fx.ts';
import { Audio } from './audio.ts';
import { UI, icon, num, type Label } from './ui.ts';
import { WEATHER, ITEM_BY, ITEMS, tierOf, CHAIR_TIERS, GONDOLA_TIERS, CARPET_TIERS } from './data.ts';

const SAVE_KEY = 'bluebird.v2';
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const step = (t: string, p: number) => { const l = $('#loading .lstep'); if (l) l.textContent = t; const b = $('#loading .lbar b'); if (b) b.style.width = p * 100 + '%'; };
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function readSave(): SaveState | null {
  if (new URLSearchParams(location.search).has('fresh')) return null;
  try { const r = localStorage.getItem(SAVE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

async function boot() {
  step('Shaping the mountain', 0.1);
  await frame();
  const m = new Mountain();
  step('Laying the snow', 0.35);
  await frame();
  const save = readSave();
  const sim = new Sim(m, save);
  const offlineEarned = save ? sim.offline() : 0;
  const world = new World($('#gl') as HTMLCanvasElement, m);
  world.resize();
  addEventListener('resize', () => world.resize());
  step('Planting the forest', 0.6);
  await frame();
  const village = new Village(world, m);
  const lifts = new Lifts(m, world);
  const crowd = new Crowd(world, m, sim, lifts);
  const fx = new Fx(world.scene);
  const audio = new Audio();
  const ui = new UI($('#ui'), sim, m);
  step('Starting the lifts', 0.9);
  await frame();

  let soundOn = localStorage.getItem('bluebird.sound') !== '0';
  audio.musicOn = soundOn;
  ui.setSound(soundOn);
  const unlockAudio = () => { audio.start(); audio.setMusic(soundOn); audio.setSfx(soundOn); };
  addEventListener('pointerdown', unlockAudio, { once: true });
  addEventListener('keydown', unlockAudio, { once: true });

  // ------------------------------------------------------------------ the snowcat fleet
  const [shx, shz] = BUILD_SPOTS.shed;
  const cats: Snowcat[] = [];
  const catFor = (i: number) => {
    while (cats.length <= i) { const c = new Snowcat(world, m, sim); c.place(shx - 10 + cats.length * 7, shz - 32, Math.PI); cats.push(c); }
    return cats[i];
  };
  function syncLevels() {
    for (const l of lifts.list) {
      const lv = sim.lv('lift.' + l.def.id);
      l.setLevel(lv ? tierOf(lv, l.def.kind === 'chair' ? 5 : 3) : 0);
    }
    const fleet = Math.max(1, sim.lv('fleet'));
    for (let i = 0; i < fleet; i++) catFor(i).setLevel(Math.min(4, 1 + Math.floor(sim.lv('catpower') / 25)));
    village.update(sim);
  }
  syncLevels();

  // ------------------------------------------------------------------ camera
  const cam = world.camera;
  const orbit = { target: new THREE.Vector3(30, 0, 400), yaw: 0.22, pitch: 0.36, dist: 470 };
  let flyTo: { target: THREE.Vector3; dist: number } | null = null;
  const canvas = $('#gl') as HTMLCanvasElement;
  let drag: { x: number; y: number; btn: number; moved: number } | null = null;
  let tour = false, tourT = 0, tourIdx = 0, idleT = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, btn: e.button === 0 && !e.shiftKey ? 0 : 2, moved: 0 }; canvas.setPointerCapture(e.pointerId); idleT = 0; if (tour) setTour(false); });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    flyTo = null;
    if (drag.btn === 0) { orbit.yaw -= dx * 0.005; orbit.pitch = Math.min(1.4, Math.max(0.1, orbit.pitch + dy * 0.004)); }
    else {
      const s = orbit.dist * 0.0016;
      const fx2 = Math.sin(orbit.yaw), fz2 = Math.cos(orbit.yaw);
      orbit.target.x += (-fz2 * dx - fx2 * dy) * s;
      orbit.target.z += (fx2 * dx - fz2 * dy) * s;
    }
  });
  canvas.addEventListener('wheel', (e) => { flyTo = null; idleT = 0; if (tour) setTour(false); orbit.dist = Math.min(1500, Math.max(30, orbit.dist * Math.exp(e.deltaY * 0.0012))); e.preventDefault(); }, { passive: false });
  const keys = new Set<string>();
  addEventListener('keydown', (e) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; keys.add(e.code); idleT = 0; if (e.code === 'Space') { e.preventDefault(); ui.onSpeed(0); } });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const TOUR_SPOTS = () => {
    const spots: { t: THREE.Vector3; dist: number; pitch: number }[] = [{ t: new THREE.Vector3(30, 0, 470), dist: 240, pitch: 0.3 }];
    for (const l of lifts.list) if (l.lv) { const mid = l.towers[Math.floor(l.towers.length / 2)]; spots.push({ t: mid.clone(), dist: 160, pitch: 0.35 }); }
    for (const r of RUNS) if (sim.runBuilt(r.id)) { const p = m.runOf[r.id]; const i = Math.floor(p.x.length * 0.5); spots.push({ t: new THREE.Vector3(p.x[i], p.h[i], p.z[i]), dist: 140, pitch: 0.28 }); }
    spots.push({ t: new THREE.Vector3(60, 200, 0), dist: 900, pitch: 0.38 });
    return spots;
  };
  function setTour(on: boolean) { tour = on; ui.setTour(on); tourT = 0; }
  ui.onTour = () => setTour(!tour);

  const camPos = new THREE.Vector3(), smoothPos = new THREE.Vector3(), smoothLook = new THREE.Vector3();
  let camInit = false;
  function updateCamera(dt: number) {
    if (tour) {
      tourT -= dt;
      if (tourT <= 0) { const spots = TOUR_SPOTS(); tourIdx = (tourIdx + 1) % spots.length; const s = spots[tourIdx]; flyTo = { target: s.t, dist: s.dist }; orbit.pitch = s.pitch; tourT = 14; }
      orbit.yaw += dt * 0.06;
    }
    if (flyTo) {
      orbit.target.lerp(flyTo.target, Math.min(1, dt * (tour ? 0.5 : 2.5)));
      orbit.dist += (flyTo.dist - orbit.dist) * Math.min(1, dt * (tour ? 0.5 : 2.5));
      if (!tour && orbit.target.distanceTo(flyTo.target) < 1 && Math.abs(orbit.dist - flyTo.dist) < 2) flyTo = null;
    }
    const pan = orbit.dist * 0.9 * dt;
    const fx2 = Math.sin(orbit.yaw), fz2 = Math.cos(orbit.yaw);
    const mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const mz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (mx || mz) { flyTo = null; if (tour) setTour(false); orbit.target.x += (mx * fz2 + mz * fx2) * pan; orbit.target.z += (-mx * fx2 + mz * fz2) * pan; }
    if (keys.has('KeyQ')) orbit.yaw += dt * 1.2;
    if (keys.has('KeyE')) orbit.yaw -= dt * 1.2;
    orbit.target.x = Math.max(-HALF + 50, Math.min(HALF - 50, orbit.target.x));
    orbit.target.z = Math.max(-HALF + 50, Math.min(HALF + 60, orbit.target.z));
    orbit.target.y += (m.at(orbit.target.x, Math.min(HALF - 1, orbit.target.z)) - orbit.target.y) * Math.min(1, dt * 4);
    camPos.set(orbit.target.x + fx2 * Math.cos(orbit.pitch) * orbit.dist, orbit.target.y + Math.sin(orbit.pitch) * orbit.dist, orbit.target.z + fz2 * Math.cos(orbit.pitch) * orbit.dist);
    const gy = m.at(Math.max(-799, Math.min(799, camPos.x)), Math.max(-799, Math.min(799, camPos.z))) + 8;
    if (camPos.y < gy) camPos.y = gy;
    smoothPos.lerp(camPos, camInit ? Math.min(1, dt * 8) : 1);
    smoothLook.lerp(orbit.target, camInit ? Math.min(1, dt * 8) : 1);
    camInit = true;
    cam.position.copy(smoothPos);
    cam.lookAt(smoothLook);
    cam.near = 1;
    cam.updateProjectionMatrix();
    world.focus.copy(orbit.target);
  }
  ui.onFocus = (x, z) => { flyTo = { target: new THREE.Vector3(x, m.at(x, z), z), dist: Math.min(orbit.dist, 380) }; };
  const focusItem = (id: string) => {
    if (id.startsWith('lift.')) { const l = lifts.by[id.slice(5)]; const p = l.towers[Math.floor(l.towers.length / 2)]; flyTo = { target: p.clone(), dist: 260 }; }
    else if (id.startsWith('run.')) { const p = m.runOf[id.slice(4)]; const i = Math.floor(p.x.length / 2); flyTo = { target: new THREE.Vector3(p.x[i], p.h[i], p.z[i]), dist: 260 }; }
  };

  // ------------------------------------------------------------------ buying, claiming, speed
  ui.onBuy = (id, n) => {
    const before = sim.lv(id);
    if (!sim.buy(id, n)) { audio.bad(); return; }
    audio.buy();
    if (before === 0 && (id.startsWith('lift.') || id.startsWith('run.'))) { focusItem(id); ui.toast(`${ITEM_BY[id].name} is open!`, 'good'); }
  };
  ui.onClaim = (id, x, y) => { const r = sim.claim(id); if (r) { audio.cash(); audio.buy(); ui.coins(x, y, 22); ui.floatCash(x, y - 20, r, true); } };
  ui.onSpeed = (n) => { audio.click(); if (n === 0) sim.paused = !sim.paused; else { sim.paused = false; sim.speed = n; } };
  ui.onSound = () => { soundOn = !soundOn; localStorage.setItem('bluebird.sound', soundOn ? '1' : '0'); ui.setSound(soundOn); audio.start(); audio.setMusic(soundOn); audio.setSfx(soundOn); };

  // ------------------------------------------------------------------ bonus drops
  type DropKind = 'cash' | 'film' | 'cocoa';
  interface Drop { id: number; kind: DropKind; x: number; z: number; y: number; ground: number; t: number; mesh: THREE.Group }
  const drops: Drop[] = [];
  let dropT = 25, dropId = 1;
  const crateM = new THREE.MeshStandardMaterial({ color: 0xc8873e, roughness: 0.7 });
  const chuteMs: Record<DropKind, THREE.MeshStandardMaterial> = {
    cash: new THREE.MeshStandardMaterial({ color: 0xf2b33d, roughness: 0.5, side: THREE.DoubleSide }),
    film: new THREE.MeshStandardMaterial({ color: 0x8f7bff, roughness: 0.5, side: THREE.DoubleSide }),
    cocoa: new THREE.MeshStandardMaterial({ color: 0xd2453a, roughness: 0.5, side: THREE.DoubleSide }),
  };
  function spawnDrop() {
    const built = RUNS.filter((r) => sim.runBuilt(r.id));
    const r = built[(Math.random() * built.length) | 0];
    const p = m.runOf[r.id];
    const i = Math.floor(p.x.length * (0.15 + Math.random() * 0.7));
    const kind: DropKind = sim.isOpen && Math.random() < 0.2 ? 'film' : sim.isOpen && sim.hour < 14 && Math.random() < 0.2 ? 'cocoa' : 'cash';
    const g = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), crateM);
    const chute = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), chuteMs[kind]);
    chute.position.y = 8;
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1, 0), new THREE.Vector3(-4, 8, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(4, 8, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 8, 4), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 8, -4)]), new THREE.LineBasicMaterial({ color: 0x333333 }));
    g.add(crate, chute, lines);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const ground = m.ground(p.x[i], p.z[i]);
    const d: Drop = { id: dropId++, kind, x: p.x[i], z: p.z[i], y: ground + 70, ground, t: 0, mesh: g };
    g.position.set(d.x, d.y, d.z);
    world.scene.add(g);
    drops.push(d);
  }
  function collect(d: Drop, sx: number, sy: number) {
    world.scene.remove(d.mesh);
    drops.splice(drops.indexOf(d), 1);
    audio.cash();
    ui.coins(sx, sy, 16);
    fx.emit(d.x, d.ground + 1, d.z, 0, 4, 0, 5, 40, 1.2, 160);
    if (d.kind === 'cash') { const amt = sim.bonus(45); ui.floatCash(sx, sy - 30, amt, true); }
    else if (d.kind === 'film') { sim.addBuzz(0.12); sim.planDay(true); ui.toast('A ski film crew posted your mountain: +12% skiers for a while', 'good'); }
    else { sim.lunchBoost(2); ui.toast('Hot cocoa rush: lodge sales doubled for two hours', 'good'); }
  }
  function updateDrops(dt: number) {
    if (!ui.modalOpen) dropT -= dt;
    if (dropT <= 0 && drops.length < 2) { spawnDrop(); dropT = 35 + Math.random() * 45; }
    for (const d of [...drops]) {
      d.t += dt;
      d.y = Math.max(d.ground + 1.1, d.y - dt * 3.2);
      d.mesh.position.set(d.x + Math.sin(d.t * 0.8) * 2 * Math.min(1, (d.y - d.ground) / 10), d.y, d.z);
      d.mesh.rotation.y = Math.sin(d.t * 0.6) * 0.3;
      const chute = d.mesh.children[1];
      chute.visible = d.y > d.ground + 1.2;
      if (d.t > 34) { world.scene.remove(d.mesh); drops.splice(drops.indexOf(d), 1); }
    }
  }

  // ------------------------------------------------------------------ labels
  const V = new THREE.Vector3();
  function project(x: number, y: number, z: number) {
    V.set(x, y, z).project(cam);
    if (V.z > 1 || V.z < -1 || Math.abs(V.x) > 1.2 || Math.abs(V.y) > 1.2) return null;
    return { x: (V.x * 0.5 + 0.5) * innerWidth, y: (-V.y * 0.5 + 0.5) * innerHeight };
  }
  function labels() {
    const out: Label[] = [];
    const far = orbit.dist > 1000;
    for (const l of lifts.list) {
      const id = l.def.id;
      const lv = sim.lv('lift.' + id);
      const p = l.towers[0];
      const s = project(p.x, p.y + 9, p.z);
      if (!s) continue;
      const br = sim.broken[id] !== undefined;
      const tierName = l.def.kind === 'gondola' ? GONDOLA_TIERS : l.def.kind === 'carpet' ? CARPET_TIERS : CHAIR_TIERS;
      const lock = sim.lockReason('lift.' + id);
      const html = br
        ? `${icon('wrench', 13)} ${l.def.name} <small>fixing, ${Math.ceil(sim.fixLeft(id))} min</small>`
        : lv ? `${icon(l.def.kind === 'chair' ? 'chair' : l.def.kind, 14)} ${l.def.name} <span class="lv">${lv}</span>` : `${icon('lock', 13)} ${l.def.name} <small>${lock ? lock : money(ITEM_BY['lift.' + id].build)}</small>`;
      out.push({ id: 'l' + id, x: s.x, y: s.y, cls: br ? 'bad' : lv ? '' : 'dim', html, click: () => { ui.openItem('lift.' + id); }, hidden: (!lv && (far || !!lock)) || tour });
    }
    for (const r of RUNS) {
      const p = m.runOf[r.id];
      const i = Math.floor(p.x.length * 0.3);
      const s = project(p.x[i], p.h[i] + 4, p.z[i]);
      if (!s) continue;
      const lv = sim.lv('run.' + r.id);
      const built = sim.runBuilt(r.id);
      const q = sim.runQ[r.id] ?? 0;
      const thin = built && !sim.runOpen(r.id) && sim.isOpen;
      const lock = sim.lockReason('run.' + r.id);
      out.push({ id: 'r' + r.id, x: s.x, y: s.y, cls: built ? (thin ? 'bad' : '') : 'dim', html: `${icon(r.diff, 13)} ${r.name} ${built ? `<span class="lv">${lv}</span><small>${thin ? 'closed' : Math.round(q * 100) + '%'}</small>` : `<small>${lock ?? money(ITEM_BY['run.' + r.id].build)}</small>`}`, click: () => { ui.openItem('run.' + r.id); }, hidden: (!built && (far || !!lock || !sim.liftBuilt(r.needs))) || tour });
    }
    for (const d of drops) {
      const s = project(d.mesh.position.x, d.mesh.position.y + 12, d.mesh.position.z);
      if (!s) continue;
      const amt = Math.max(80 + sim.s.resortLv * 60, (sim.perMinute / 60) * 45, sim.s.rate * 45);
      const html = d.kind === 'cash' ? `${icon('gift', 16)} Supply drop · +${money(amt)}` : d.kind === 'film' ? `${icon('camera', 16)} Film crew · +buzz` : `${icon('cup', 16)} Cocoa rush · lodge ×2`;
      out.push({ id: 'd' + d.id, x: s.x, y: s.y, cls: 'drop ' + d.kind, html, click: () => collect(d, s.x, s.y) });
    }
    ui.labels(out);
  }

  // ------------------------------------------------------------------ Marta's first tips
  let tipT = 0;
  function tips(dt: number) {
    const s = sim.s;
    tipT += dt;
    const msgs = [
      `Welcome to Bluebird Peak! It runs itself: skiers come, snowcats groom at night, money rolls in. Your job is to spend it well. Start by upgrading <b>Sprout Slope</b> below.`,
      `<b>Guests a day</b> on the left shows what holds you back: the red bar. Hit <b>Fix</b> to jump to the upgrade that helps most.`,
      `Golden crates parachute onto the trails now and then: click them for bonus cash. Save up for the <b>Meadow Chair</b> to open the real mountain!`,
    ];
    if (s.tut === 0 && sim.lv('run.bunny') >= 3) { s.tut = 1; tipT = 0; }
    if (s.tut === 1 && (tipT > 16 || sim.lv('parking') >= 3)) { s.tut = 2; tipT = 0; }
    if (s.tut === 2 && (sim.liftBuilt('meadow') || tipT > 22)) { s.tut = 3; tipT = 0; }
    ui.radio(s.tut < msgs.length && !tour ? msgs[s.tut] : null);
  }

  // ------------------------------------------------------------------ the loop
  let last = performance.now();
  let saveT = 0, tSec = 0, lodgeCashT = 3;
  if (offlineEarned > 0) ui.welcome(offlineEarned);
  (window as any).__bb = { sim, world, m, lifts, crowd, cats, ui, orbit, village, fx, drops, spawnDrop, setTour };

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tSec += dt;
    idleT += dt;
    if (idleT > 90 && !tour && !ui.modalOpen) setTour(true);
    if (!ui.modalOpen) sim.update(dt);
    const gameDt = dt * (sim.paused ? 0 : sim.speed);

    for (const e of sim.events.splice(0)) {
      if (e.k === 'toast') ui.toast(e.text, e.tone);
      else if (e.k === 'broken') { ui.toast(`${LIFT_BY[e.lift].name} broke down. Mechanics are on it`, 'bad'); audio.bad(); }
      else if (e.k === 'dayend') { ui.dayEnd(e.day, e.visitors, e.income, e.stars, e.best); if (e.best) audio.good(); }
      else if (e.k === 'levelup') {
        const unlocked = ITEMS.filter((it) => it.needLv === e.lv).map((it) => it.name);
        ui.celebrate(`Level ${e.lv}`, `+${money(e.reward)}${unlocked.length ? ' · Unlocked: ' + unlocked.join(', ') : ''}`, 'level');
        audio.trick(2000);
      } else if (e.k === 'bought') {
        syncLevels();
        if (e.milestone) { ui.celebrate(`${ITEM_BY[e.id].name}`, `Level ${e.lv}: ×2 bonus`, 'milestone'); audio.trick(900); }
      }
    }

    // lifts spin while open (and a little before / after for the crowd)
    const liftsOn = sim.isOpen || sim.onMountain > 1;
    for (const l of lifts.list) l.update(gameDt, sim.liftRunning(l.def.id) && (liftsOn || l.riders.some((c) => c.some(Boolean))));
    crowd.update(gameDt);
    village.setCars(sim.onMountain / Math.max(1, sim.plan.visitors || 1) + 0.1);

    // snowcats: out on the trails at night, parked by the shed by day
    const fleet = Math.max(1, sim.lv('fleet'));
    for (let i = 0; i < fleet; i++) {
      const c = catFor(i);
      const st = sim.cats[i];
      if (st && st.on && sim.grooming && (st.x || st.z)) {
        const wob = Math.sin(tSec * 0.8 + i) * 3;
        c.pose(st.x + Math.cos(st.yaw) * wob, st.z - Math.sin(st.yaw) * wob, dt, tSec, true);
        c.setLights(world.night > 0.2 ? 90 : 0);
        if (Math.random() < 0.5) fx.emit(c.p.x - Math.sin(c.yaw) * 6, c.p.y + 0.4, c.p.z - Math.cos(c.yaw) * 6, 0, 0.8, 0, 1.5, 1, 0.8, 90);
      } else {
        c.pose(shx - 14 + i * 8, shz - 34, dt, tSec, false);
        c.setLights(0);
      }
    }

    // snow gun plumes
    const tmp = new THREE.Vector3();
    village.setGunState(sim, tSec);
    if (sim.gunOn.size && sim.canMakeSnow) {
      for (const g of sim.builtGuns()) {
        if (!sim.gunOn.has(g.id) || Math.hypot(g.x - cam.position.x, g.z - cam.position.z) > 900) continue;
        village.gunNozzle(g, tmp);
        fx.emit(tmp.x, tmp.y, tmp.z, g.dx * 17, 4.5, g.dz * 17, 2.6, 4, 2.6, 160);
      }
    }
    fx.update(dt, world.night, innerHeight * world.renderer.getPixelRatio(), cam.fov);
    updateDrops(dt);

    // floating money over the ticket booth and lodge while the crowd is in
    lodgeCashT -= dt;
    if (lodgeCashT < 0 && sim.isOpen && !tour) {
      lodgeCashT = 2.2;
      const [bx, bz] = Math.random() < 0.5 ? BUILD_SPOTS.tickets : BUILD_SPOTS.lodge;
      const s = project(bx, m.at(bx, bz) + 12, bz);
      const amt = (sim.perMinute / 60) * 2.2;
      if (s && amt > 1) ui.floatCash(s.x, s.y, amt);
    }

    const w = WEATHER[sim.weather];
    const snowing = w.snow > 0 ? Math.min(1, w.snow / 4) * (0.5 + 0.5 * Math.sin(sim.s.t * 1.3) ** 2) * 4.5 : 0;
    world.setTime(sim.hour, w.cloud, snowing, w.wind, dt, tSec);
    world.syncSnow(sim);

    ui.markers = [...sim.cats.filter((c) => c.on && sim.grooming).map((c) => ({ x: c.x, z: c.z, kind: 'cat' })), ...drops.map((d) => ({ x: d.x, z: d.z, kind: 'drop' }))];
    updateCamera(dt);
    labels();
    tips(dt);
    ui.update(dt);

    const nearGun = (() => { let d = 1e9; for (const g of sim.builtGuns()) if (sim.gunOn.has(g.id)) d = Math.min(d, Math.hypot(g.x - cam.position.x, g.z - cam.position.z)); return sim.canMakeSnow ? Math.max(0, 1 - d / 140) : 0; })();
    let catD = 1e9;
    for (const c of cats) if (c.driving) catD = Math.min(catD, c.p.distanceTo(cam.position));
    audio.frame({ wind: w.wind * 0.45 + Math.min(0.25, orbit.dist / 4000), carve: 0, spray: 0, cat: Math.max(0, 1 - catD / 160) * 0.7, catLoad: 0.5, sled: 0, gun: nearGun, hum: 0, night: world.night });

    world.render();
    saveT += dt;
    if (saveT > 8) { saveT = 0; persist(); }
  }

  function persist() { try { localStorage.setItem(SAVE_KEY, sim.save()); } catch {} }
  addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  $('#loading').classList.add('done');
  (window as any).__ready = true;
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  const el = $('#loading .lerr');
  if (el) el.textContent = String(e?.stack ?? e);
});
