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
import { Attractions, SPOTS } from './attractions.ts';
import { Dressing } from './dressing.ts';
import type { Thought } from './ui.ts';
import { WEATHER, ITEM_BY, ITEMS, EVENT_BY, tierOf, legendMul } from './data.ts';

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
  const attractions = new Attractions(world, m, village, fx);
  const dressing = new Dressing(world, m, village, fx);
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
  const catLanes: { run: number; lane: number; s: number }[] = [];
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
    cats.forEach((c, i) => (c.group.visible = i < fleet));
    village.update(sim);
    attractions.update(sim);
    dressing.update(sim);
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
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    keys.add(e.code); idleT = 0;
    if (e.code === 'Space') { e.preventDefault(); ui.onSpeed(0); }
    else if (e.code === 'KeyM') ui.setView(ui.view === 1 ? 0 : 1);
    else if (/^Digit[1-4]$/.test(e.code)) ui.setView(+e.code.slice(5) - 1);
    else if (e.code === 'KeyR') ui.report ? ui.closeModal() : ui.openReport('overview');
    else if (e.code === 'Escape') ui.closeModal();
  });
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
    world.viewDist = orbit.dist;
  }
  const PLACES: Record<string, [number, number]> = { ...BUILD_SPOTS, ...SPOTS };
  const focusItem = (id: string) => {
    if (tour) setTour(false);
    if (id.startsWith('lift.')) { const l = lifts.by[id.slice(5)]; const p = l.towers[Math.floor(l.towers.length / 2)]; flyTo = { target: p.clone(), dist: 300 }; }
    else if (id.startsWith('run.')) { const p = m.runOf[id.slice(4)]; const i = Math.floor(p.x.length / 2); flyTo = { target: new THREE.Vector3(p.x[i], p.h[i], p.z[i]), dist: Math.max(240, p.len * 0.55) }; }
    else if (PLACES[id]) { const [x, z] = PLACES[id]; flyTo = { target: new THREE.Vector3(x, m.at(x, z), z), dist: 150 }; }
  };
  ui.onFocusItem = focusItem;
  ui.onView = (n) => { world.setView(n); if (n && orbit.dist < 600 && !tour) flyTo = { target: new THREE.Vector3(0, 200, 0), dist: 1250 }; if (n) orbit.pitch = Math.max(orbit.pitch, 0.62); };

  // ------------------------------------------------------------------ buying, claiming, speed
  ui.onBuy = (id, n) => {
    const before = sim.lv(id);
    if (!sim.buy(id, n)) { audio.bad(); return; }
    audio.buy();
    if (before === 0 && (id.startsWith('lift.') || id.startsWith('run.') || SPOTS[id as keyof typeof SPOTS])) { focusItem(id); ui.toast(`${ITEM_BY[id].name} is open!`, 'good'); }
  };
  ui.onHost = (id) => {
    const e = EVENT_BY[id];
    if (!sim.hostEvent(id)) { audio.bad(); return; }
    audio.buy();
    const ev = sim.s.event!;
    ui.toast(ev.state === 'live' ? `${e.name} is on! Crowds are heading up the mountain` : `${e.name} is booked for ${ev.day === sim.day ? 'today' : 'tomorrow'}`, 'good');
    if (e.run) focusItem('run.' + e.run); else flyTo = { target: new THREE.Vector3(SPOTS.banner[0], 0, SPOTS.banner[1]), dist: 200 };
  };
  ui.onDeal = (yes) => {
    if (yes) { if (sim.acceptDeal()) { audio.buy(); ui.toast(`Deal signed with ${sim.s.deal!.sponsor}. Make it happen!`, 'good'); } else audio.bad(); }
    else sim.declineDeal();
  };
  ui.onSeason = () => {
    if (!sim.newSeason()) return;
    for (const d of [...drops]) { world.scene.remove(d.mesh); }
    drops.length = 0;
    sim.dirty = true;
    syncLevels();
    ui.setView(0);
    flyTo = { target: new THREE.Vector3(30, 0, 400), dist: 470 };
    ui.celebrate(`Season ${sim.s.seasons + 1}`, `Legend ×${legendMul(sim.s.legend).toFixed(2)} on everything you earn`, 'level');
    audio.trick(3000);
    persist();
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

  // ------------------------------------------------------------------ guests: what they think, and the odd VIP
  const NAMES = ['Maya', 'Theo', 'Priya', 'Jonas', 'Lucia', 'Sam', 'Ines', 'Kofi', 'Hana', 'Leo', 'Ava', 'Mateo', 'Zoe', 'Finn', 'Omar', 'Elsa', 'Ravi', 'Nora'];
  function thoughtFor(a: { run: { def: { id: string } } | null; st: string }): Thought {
    const pool: [string, boolean, number][] = [];
    const run = a.run ? RUN_BY[a.run.def.id] : null;
    const P = sim.plan, s = sim.s;
    if (run) {
      const q = sim.runQ[run.id] ?? 0.6;
      if (q < 0.45) pool.push([`${run.name} is scraped down to ice`, false, 3]);
      if (q > 0.85) pool.push([`The corduroy on ${run.name} is perfect`, true, 2]);
      if (run.diff === 'black' || run.diff === 'double') pool.push([`${run.name} nearly killed me. Again!`, true, 1.2]);
      if (run.diff === 'park') pool.push(['Landed my first 360!', true, 1.2]);
    }
    for (const l of LIFTS) if ((sim.liftLoad[l.id] ?? 0) > 0.95 && sim.liftBuilt(l.id)) pool.push([`The line for ${l.name} is taking forever`, false, 2.5]);
    for (const id of Object.keys(sim.broken)) pool.push([`${LIFT_BY[id].name} broke down. Seriously?`, false, 3]);
    if (s.price > P.fair * (s.autoPrice ? 1.8 : 1.25)) pool.push([`$${s.price} for a lift ticket? Ouch.`, false, 2]);
    if (s.price < P.fair * 0.8) pool.push(['Cannot believe how cheap the tickets are', true, 1.2]);
    if (sim.starParts.food < 0.35) pool.push(['Not one free seat in the lodge', false, 2]);
    if (P.limit === 'parking') pool.push(['Took forever to find a parking spot', false, 1.4]);
    if (P.limit === 'demand' && RUNS.filter((r) => sim.runBuilt(r.id)).length < 3) pool.push(['Wish there were more trails to explore', false, 1.4]);
    if (s.powderDay) pool.push(['POWDER DAY! I am never going back to work', true, 3]);
    if (sim.weather === 'storm') pool.push(['I cannot see my own skis', false, 1.2]);
    if (sim.weather === 'bluebird') pool.push(['Not a cloud in the sky. Bluebird!', true, 1]);
    const ev = sim.eventToday;
    if (ev && s.event?.state === 'live') pool.push([`${ev.name} is the best thing all winter`, true, 3]);
    if (sim.lv('rink')) pool.push(['Ice skating after skiing? Yes please', true, 0.8]);
    if (sim.lv('tubing')) pool.push(['The kids will not leave the tubing hill', true, 0.8]);
    if (sim.lv('heli')) pool.push(['Saving up for a heli-ski day', true, 0.6]);
    if (sim.lv('summithut')) pool.push(['Lunch at the summit, what a view', true, 0.8]);
    if (s.stars >= 4.5) pool.push(['Best resort in the state, easily', true, 1.2]);
    if (s.stars < 2.5) pool.push(['Kind of a sad little hill, honestly', false, 1.2]);
    if (a.st === 'queue') pool.push(['Come on, move the line', false, 1]);
    pool.push(['One more run, then cocoa', true, 0.7], ['Best day of my winter', true, 0.6], ['My boots are killing me', false, 0.3], ['First time skiing and I only fell twice', true, 0.5]);
    let tot = 0; for (const p of pool) tot += p[2];
    let r = Math.random() * tot;
    for (const p of pool) { r -= p[2]; if (r <= 0) return { text: p[0], good: p[1], who: NAMES[(Math.random() * NAMES.length) | 0] }; }
    return { text: pool[0][0], good: pool[0][1], who: 'Sam' };
  }
  const bubbles: { id: number; agent: any; t: number; th: Thought }[] = [];
  let bubbleT = 3, bubbleId = 1, vip: { agent: any; t: number; sp: number } | null = null, vipT = 50;
  function guests(dt: number) {
    const open = sim.isOpen && !tour && !ui.modalOpen;
    bubbleT -= dt;
    if (open && bubbleT < 0 && bubbles.length < 2 && orbit.dist < 800) {
      bubbleT = 2.6 + Math.random() * 2;
      const cand = crowd.agents.filter((a: any) => (a.st === 'ski' || a.st === 'queue' || a.st === 'walk') && project(a.x, a.y + 3, a.z));
      if (cand.length) { const a = cand[(Math.random() * cand.length) | 0]; const th = thoughtFor(a as any); bubbles.push({ id: bubbleId++, agent: a, t: 0, th }); ui.voices.unshift(th); ui.voices.length = Math.min(ui.voices.length, 12); }
    }
    for (const b of [...bubbles]) { b.t += dt; if (b.t > 4.2 || !crowd.agents.includes(b.agent)) bubbles.splice(bubbles.indexOf(b), 1); }
    // a VIP: a pro or a celebrity out on the trails; click them for a big tip and some buzz
    vipT -= dt * (open ? 1 : 0);
    if (!vip && vipT <= 0) {
      const cand = crowd.agents.filter((a: any) => a.st === 'ski');
      if (cand.length) {
        vip = { agent: cand[(Math.random() * cand.length) | 0], t: 0, sp: 0 };
        vipName = VIPS[(Math.random() * VIPS.length) | 0];
        const run = vip.agent.run ? RUN_BY[vip.agent.run.def.id]?.name : null;
        ui.toast(`A ${vipName.toLowerCase()} is skiing${run ? ' ' + run : ' at Bluebird'}! Find the gold label and say hi`, 'gold', 5000);
      }
      vipT = 70 + Math.random() * 70;
    }
    if (vip) {
      vip.t += dt;
      const a = vip.agent;
      if (vip.t > 45 || !crowd.agents.includes(a) || !sim.isOpen) vip = null;
      else if ((vip.sp -= dt) < 0) { vip.sp = 0.08; fx.emit(a.x, a.y + 1.5, a.z, 0, 2, 0, 2.5, 1, 0.6, 40); }
    }
  }
  const VIPS = ['Olympic champion', 'Pro freerider', 'Movie star', 'Famous YouTuber', 'Pop star', 'Ski magazine editor'];
  let vipName = VIPS[0];

  // ------------------------------------------------------------------ labels
  const V = new THREE.Vector3();
  function project(x: number, y: number, z: number) {
    V.set(x, y, z).project(cam);
    if (V.z > 1 || V.z < -1 || Math.abs(V.x) > 1.2 || Math.abs(V.y) > 1.2) return null;
    return { x: (V.x * 0.5 + 0.5) * innerWidth, y: (-V.y * 0.5 + 0.5) * innerHeight };
  }
  function labels() {
    const out: Label[] = [];
    const v = ui.view;
    const near = orbit.dist < 720;
    for (const l of lifts.list) {
      const id = l.def.id;
      const lv = sim.lv('lift.' + id);
      const p = l.towers[0];
      const s = project(p.x, p.y + 9, p.z);
      if (!s) continue;
      const br = sim.broken[id] !== undefined;
      const lock = sim.lockReason('lift.' + id);
      const load = sim.liftLoad[id] ?? 0;
      const lc = load > 0.9 ? '#e5302f' : load > 0.6 ? '#f9b72e' : '#3fe07a';
      const busy = lv && sim.isOpen && !br ? `<span class="ld" title="How busy"><b style="width:${Math.min(100, load * 100).toFixed(0)}%;background:${lc}"></b></span>` : '';
      const html = br
        ? `${icon('wrench', 13)} ${l.def.name} <small>fixing, ${Math.ceil(sim.fixLeft(id))} min</small>`
        : lv ? `${icon(l.def.kind === 'chair' ? 'chair' : l.def.kind, 14)} ${l.def.name} <span class="lv">${lv}</span>${busy}` : `${icon('lock', 13)} ${l.def.name} <small>${lock ? lock : money(ITEM_BY['lift.' + id].build)}</small>`;
      out.push({ id: 'l' + id, x: s.x, y: s.y, cls: br ? 'bad' : lv ? '' : 'dim', html, click: () => ui.openItem('lift.' + id), hidden: tour || (lv ? !near && v === 0 && !br : (!!lock || v !== 1 && !near)) });
    }
    for (const r of RUNS) {
      const p = m.runOf[r.id];
      const i = Math.floor(p.x.length * 0.3);
      const s = project(p.x[i], p.h[i] + 4, p.z[i]);
      if (!s) continue;
      const lv = sim.lv('run.' + r.id);
      const built = sim.runBuilt(r.id);
      const q = sim.runQ[r.id] ?? 0;
      const dark = sim.phase === 'evening' && !r.lit;
      const thin = built && !sim.runOpen(r.id) && sim.isOpen && !dark;
      const lock = sim.lockReason('run.' + r.id);
      const metric = v === 3 ? `${num(sim.onRun[r.id] ?? 0)} skiing` : thin ? 'closed: thin snow' : dark ? 'closed for the night' : Math.round(q * 100) + '% snow';
      const html = `${icon(r.diff, 13)} ${r.name} ${built ? `<span class="lv">${lv}</span><small>${metric}</small>` : `<small>${lock ?? money(ITEM_BY['run.' + r.id].build)}</small>`}`;
      out.push({ id: 'r' + r.id, x: s.x, y: s.y, cls: (built ? (thin ? 'bad' : '') : 'dim') + (v ? ' big' : ''), html, click: () => ui.openItem('run.' + r.id), hidden: tour || (built ? !near && v === 0 && !thin : (!!lock || !sim.liftBuilt(r.needs) || (v !== 1 && !near))) });
    }
    for (const id of ['tubing', 'rink', 'summithut', 'spa', 'heli'] as const) {
      if (!sim.lv(id)) continue;
      const [x, z] = SPOTS[id];
      const s = project(x, m.at(x, z) + 16, z);
      if (!s) continue;
      out.push({ id: 'a' + id, x: s.x, y: s.y, cls: 'place', html: `${icon(ITEM_BY[id].icon, 13)} ${ITEM_BY[id].name} <small>${sim.lv(id)}</small>`, click: () => ui.openItem(id), hidden: tour || orbit.dist > 520 || v !== 0 });
    }
    const ev = sim.eventToday;
    if (ev) {
      const p = ev.run ? m.runOf[ev.run] : null;
      const [x, z] = p ? [p.x[Math.floor(p.x.length * 0.55)], p.z[Math.floor(p.z.length * 0.55)]] : SPOTS.banner;
      const s = project(x, m.at(x, z) + 14, z);
      if (s) out.push({ id: 'ev', x: s.x, y: s.y, cls: 'ev big', html: `${icon(ev.icon, 15)} ${ev.name} <small style="color:#fff">${sim.s.event?.state === 'live' ? 'live now' : 'today'}</small>`, click: () => ui.openReport('events'), hidden: tour });
    }
    for (const b of bubbles) {
      const s = project(b.agent.x, b.agent.y + 3.2, b.agent.z);
      if (s) out.push({ id: 't' + b.id, x: s.x, y: s.y, cls: 'thought ' + (b.th.good ? 'good' : 'bad'), html: `<em>${b.th.who}:</em> ${b.th.text}`, hidden: tour });
    }
    if (vip) {
      const a = vip.agent;
      const s = project(a.x, a.y + 4, a.z);
      if (s) out.push({ id: 'vip', x: s.x, y: s.y, cls: 'drop vip', html: `${icon('star', 16)} ${vipName} on the slopes! · tap`, click: () => { const amt = sim.bonus(75); sim.addBuzz(0.06); sim.planDay(true); audio.cash(); audio.trick(900); ui.coins(s.x, s.y, 24); ui.floatCash(s.x, s.y - 30, amt, true); ui.toast(`The ${vipName.toLowerCase()} posted a selfie from Bluebird Peak: +6% buzz`, 'good'); vip = null; } });
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
      `Welcome to Bluebird Peak! It runs itself: skiers come, snowcats groom at night, money rolls in. Your job is to spend it well. Start by upgrading <b>Sprout Slope</b> in the shop on the right.`,
      `<b>Your business</b> on the left shows what holds you back: the red bar. Hit <b>Fix</b> to jump to the upgrade that helps most.`,
      `Golden crates parachute onto the trails now and then: click them for bonus cash. Press <b>M</b> for the trail map. Save up for the <b>Meadow Chair</b> to open the real mountain!`,
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
  (window as any).__bb = { sim, world, m, lifts, crowd, cats, ui, orbit, village, fx, drops, spawnDrop, setTour, attractions, syncLevels, dressing, forceVip: () => { vipT = 0; } };

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
      } else if (e.k === 'event') {
        const ev = EVENT_BY[e.id];
        if (e.phase === 'live') { ui.toast(`${ev.name} is on today: ${Math.round((ev.guestMul - 1) * 100)}% more guests`, 'good', 5000); audio.good(); }
        else { ui.celebrate(ev.name, `Prize +${money(e.payout ?? 0)}`, 'event'); audio.trick(1500); }
      } else if (e.k === 'league') {
        ui.celebrate(`#${e.rank} in the league`, `Passed ${e.rival} · +${money(e.reward)}`, 'league');
        audio.trick(2500);
      } else if (e.k === 'deal') {
        if (e.phase === 'offer') { ui.toast(`<b>Sponsor offer</b> · ${e.text} · ${money(e.reward)}`, 'gold', 6500); audio.good(); }
        else if (e.phase === 'won') { ui.toast(`Contract done! ${e.text} · +${money(e.reward)}`, 'good', 5500); audio.cash(); audio.trick(1200); }
        else { ui.toast(`Contract missed: ${e.text}`, 'bad', 5000); audio.bad(); }
      } else if (e.k === 'bought') {
        syncLevels();
        if (e.milestone) { ui.celebrate(`${ITEM_BY[e.id].name}`, `Level ${e.lv}: ×2 bonus`, 'milestone'); audio.trick(900); }
      }
    }

    // lifts spin while open (and a little before / after for the crowd)
    const liftsOn = sim.isOpen || sim.onMountain > 1;
    for (const l of lifts.list) l.update(gameDt, sim.liftRunning(l.def.id) && (liftsOn || l.riders.some((c) => c.some(Boolean))));
    crowd.update(gameDt);
    attractions.frame(dt, tSec, sim, world.night, gameDt);
    dressing.frame(dt, tSec, sim, WEATHER[sim.weather].wind, world.night);
    guests(dt);
    if (attractions.boom) { attractions.boom = false; if (Math.random() < 0.6) audio.land(4 + Math.random() * 6); }
    village.setCars(sim.onMountain / Math.max(1, sim.plan.visitors || 1) + 0.1);

    // snowcats: out on the trails at night driving lanes up and down (the sim grooms in bulk; these are the
    // trucks you watch), parked by the shed by day
    const fleet = Math.max(1, sim.lv('fleet'));
    const out = sim.grooming && sim.cats.some((c) => c.on);
    for (let i = 0; i < fleet; i++) {
      const c = catFor(i);
      const lane = catLanes[i] ?? (catLanes[i] = { run: -1, lane: 0, s: 0 });
      if (out) {
        if (lane.run < 0 || !sim.runBuilt(RUNS[lane.run].id)) {
          const taken = new Set(catLanes.map((l) => l?.run));
          const want = sim.cats[i]?.run ?? -1;
          const free = RUNS.map((r, ri) => ri).filter((ri) => sim.runBuilt(RUNS[ri].id) && !taken.has(ri));
          lane.run = want >= 0 && !taken.has(want) ? want : free.length ? free[(Math.random() * free.length) | 0] : RUNS.findIndex((r) => sim.runBuilt(r.id));
          lane.lane = 0; lane.s = 0;
        }
        const p = m.runOf[RUNS[lane.run].id];
        const w = 7 * (c.lv >= 3 ? 1.4 : 1);
        const lanes = Math.max(1, Math.floor(p.def.w / w));
        lane.s += dt * (9 + 3 * Math.min(4, sim.speed)) * (sim.paused ? 0 : 1);
        if (lane.s > p.len - 4) { lane.s = 0; lane.lane++; if (lane.lane >= lanes) { lane.run = -1; continue; } }
        const down = lane.lane % 2 === 0;
        const k = m.idxAt(p, down ? lane.s + 2 : p.len - 2 - lane.s);
        const lat = -p.def.w / 2 + (lane.lane + 0.5) * (p.def.w / lanes);
        const tx = p.x[k] - p.tz[k] * lat, tz = p.z[k] + p.tx[k] * lat;
        c.pose(tx, tz, dt, tSec, true);
        c.setLights(world.night > 0.15 ? 90 : 0);
        if (Math.random() < 0.5) fx.emit(c.p.x - Math.sin(c.yaw) * 6, c.p.y + 0.4, c.p.z - Math.cos(c.yaw) * 6, 0, 0.8, 0, 1.5, 1, 0.8, 90);
      } else {
        lane.run = -1;
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

    world.syncTrails(sim, dt, cats.map((c) => ({ x: c.p.x, z: c.p.z, yaw: c.yaw, on: c.lightsOn && c.group.visible })));
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
