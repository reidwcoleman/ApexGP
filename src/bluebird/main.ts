// Bluebird: boot, the modes (manage / ski / snowcat / snowmobile), cameras, input, the jobs you do
// with your own hands (grooming, snow guns, lift repairs, rescues), tutorial, saving, the frame loop.
import * as THREE from 'three';
import { Mountain, RUNS, LIFTS, RUN_BY, LIFT_BY, BUILD_SPOTS, DIFF_COLOR, HALF } from './mountain.ts';
import { Sim, money, SEC_PER_HOUR, type SaveState, type Incident, type Gun } from './sim.ts';
import { World } from './world.ts';
import { Village } from './village.ts';
import { Lifts, type Lift } from './lifts.ts';
import { Crowd } from './crowd.ts';
import { Skier, Snowcat, Sled, type Controls } from './actors.ts';
import { Fx } from './fx.ts';
import { Audio } from './audio.ts';
import { UI, icon, type Mode, type Job, type Label } from './ui.ts';
import { WEATHER, SNOWCAT, OPEN, UP_BY } from './data.ts';
import { skierGeo } from './people.ts';

const SAVE_KEY = 'bluebird.v1';
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const step = (t: string, p: number) => { const l = $('#loading .lstep'); if (l) l.textContent = t; const b = $('#loading .lbar b'); if (b) b.style.width = p * 100 + '%'; };
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function readSave(): SaveState | null {
  const q = new URLSearchParams(location.search);
  if (q.has('fresh')) return null;
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
  const skier = new Skier(world, m, sim);
  const cat = new Snowcat(world, m, sim);
  const sled = new Sled(world, m, sim);
  const fx = new Fx(world.scene);
  const audio = new Audio();
  const ui = new UI($('#ui'), sim, m);
  step('Starting the lifts', 0.9);
  await frame();

  // parked vehicles by the shed, the skier at the base
  const [shx, shz] = BUILD_SPOTS.shed;
  cat.place(shx - 6, shz - 34, Math.PI);
  sled.place(shx + 10, shz - 30, Math.PI);
  skier.place(-60, 470, Math.PI);
  const q = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ input
  const keys = new Set<string>();
  const pressed = new Set<string>();
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    audio.start();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const k = (...c: string[]) => (c.some((x) => keys.has(x)) ? 1 : 0);
  const hit = (...c: string[]) => c.some((x) => pressed.has(x));
  const controls = (): Controls => ({
    up: k('KeyW', 'ArrowUp'), down: k('KeyS', 'ArrowDown'), left: k('KeyA', 'ArrowLeft'), right: k('KeyD', 'ArrowRight'),
    jump: hit('Space'), jumpHeld: !!k('Space'), grab: !!k('ShiftLeft', 'ShiftRight'), act: hit('KeyE'),
  });

  // ------------------------------------------------------------------ cameras
  const cam = world.camera;
  const orbit = { target: new THREE.Vector3(60, 0, 230), yaw: 0.18, pitch: 0.5, dist: 820 };
  const fly: { target: THREE.Vector3; dist: number; t: number } | null = null as any;
  let flyTo: { target: THREE.Vector3; dist: number } | null = null;
  let chaseYawOff = 0, chasePitchOff = 0;
  let camStyle = 0; // 0 chase, 1 far, 2 first person (skier)
  const canvas = $('#gl') as HTMLCanvasElement;
  let drag: { x: number; y: number; btn: number } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, btn: e.button === 0 && !e.shiftKey ? 0 : 2 }; canvas.setPointerCapture(e.pointerId); audio.start(); });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (ui.mode === 'manage') {
      flyTo = null;
      if (drag.btn === 0) { orbit.yaw -= dx * 0.005; orbit.pitch = Math.min(1.45, Math.max(0.12, orbit.pitch + dy * 0.004)); }
      else {
        const s = orbit.dist * 0.0016;
        const fx2 = Math.sin(orbit.yaw), fz2 = Math.cos(orbit.yaw);
        orbit.target.x += (-dx * fz2 - dy * fx2) * s * -1;
        orbit.target.z += (dx * fx2 - dy * fz2) * s * -1;
      }
    } else { chaseYawOff -= dx * 0.006; chasePitchOff = Math.max(-0.4, Math.min(0.9, chasePitchOff + dy * 0.004)); }
  });
  canvas.addEventListener('wheel', (e) => { if (ui.mode === 'manage') { flyTo = null; orbit.dist = Math.min(1700, Math.max(35, orbit.dist * Math.exp(e.deltaY * 0.0012))); } e.preventDefault(); }, { passive: false });

  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const smoothPos = new THREE.Vector3(0, 300, 900), smoothLook = new THREE.Vector3(0, 100, 0);
  let camInit = false;
  function updateCamera(dt: number) {
    if (ui.mode === 'manage') {
      if (flyTo) {
        orbit.target.lerp(flyTo.target, Math.min(1, dt * 3));
        orbit.dist += (flyTo.dist - orbit.dist) * Math.min(1, dt * 3);
        if (orbit.target.distanceTo(flyTo.target) < 1 && Math.abs(orbit.dist - flyTo.dist) < 2) flyTo = null;
      }
      const pan = orbit.dist * 0.9 * dt;
      const fx2 = Math.sin(orbit.yaw), fz2 = Math.cos(orbit.yaw);
      const mx = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), mz = k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
      if (mx || mz) { flyTo = null; orbit.target.x += (mx * fz2 + mz * fx2) * pan; orbit.target.z += (-mx * fx2 + mz * fz2) * pan; }
      if (k('KeyQ')) orbit.yaw += dt * 1.2;
      if (k('KeyE')) orbit.yaw -= dt * 1.2;
      orbit.target.x = Math.max(-HALF + 50, Math.min(HALF - 50, orbit.target.x));
      orbit.target.z = Math.max(-HALF + 50, Math.min(HALF + 100, orbit.target.z));
      orbit.target.y += (m.at(orbit.target.x, Math.min(HALF - 1, orbit.target.z)) - orbit.target.y) * Math.min(1, dt * 4);
      camPos.set(orbit.target.x + fx2 * Math.cos(orbit.pitch) * orbit.dist, orbit.target.y + Math.sin(orbit.pitch) * orbit.dist, orbit.target.z + fz2 * Math.cos(orbit.pitch) * orbit.dist);
      const gy = m.at(Math.max(-799, Math.min(799, camPos.x)), Math.max(-799, Math.min(799, camPos.z))) + 8;
      if (camPos.y < gy) camPos.y = gy;
      camLook.copy(orbit.target);
      smoothPos.lerp(camPos, camInit ? Math.min(1, dt * 8) : 1);
      smoothLook.lerp(camLook, camInit ? Math.min(1, dt * 8) : 1);
      world.focus.set(orbit.target.x, orbit.target.y, orbit.target.z);
    } else {
      let p: THREE.Vector3, yaw: number, back = 9, up = 3.4, ahead = 4, lookUp = 1.2;
      if (ui.mode === 'ski') {
        p = skier.p;
        const sp = Math.hypot(skier.v.x, skier.v.z);
        yaw = sp > 2.5 && !skier.air ? Math.atan2(skier.v.x, skier.v.z) : skier.air && sp > 2 ? Math.atan2(skier.v.x, skier.v.z) : skier.yaw;
        if (skier.lift) { back = 7.5; up = 4.6; ahead = 14; lookUp = 1.5; }
        if (camStyle === 1) { back = 18; up = 8; }
      } else if (ui.mode === 'cat') { p = cat.p; yaw = cat.yaw + (cat.speed < -0.3 ? 0 : 0); back = 17; up = 8.5; ahead = 6; lookUp = 2; if (camStyle === 1) { back = 30; up = 16; } }
      else { p = sled.p; yaw = sled.speed > 2 ? Math.atan2(sled.vel.x, sled.vel.y) : sled.yaw; back = 9.5; up = 3.6; ahead = 5; if (camStyle === 1) { back = 18; up = 8; } }
      if (!camInit) chaseYaw = yaw;
      chaseYaw += wrap(yaw - chaseYaw) * Math.min(1, dt * (ui.mode === 'cat' ? 2.5 : 4));
      if (!drag) { chaseYawOff *= Math.exp(-dt * 0.8); chasePitchOff *= Math.exp(-dt * 0.8); }
      const cy = chaseYaw + chaseYawOff;
      const fx2 = Math.sin(cy), fz2 = Math.cos(cy);
      const fp = camStyle === 2;
      if (fp) {
        const hy = ui.mode === 'ski' ? (skier.lift ? 1.1 : 1.55) : ui.mode === 'cat' ? 3.0 : 1.9;
        camPos.set(p.x + fx2 * 0.3, p.y + hy, p.z + fz2 * 0.3);
        camLook.set(p.x + fx2 * 20, p.y + hy - 2.5 + chasePitchOff * 10, p.z + fz2 * 20);
        smoothPos.copy(camPos); smoothLook.lerp(camLook, Math.min(1, dt * 12));
      } else {
        camPos.set(p.x - fx2 * back, p.y + up + chasePitchOff * back * 0.8, p.z - fz2 * back);
        const gy = m.ground(camPos.x, camPos.z) + 1.4;
        if (camPos.y < gy) camPos.y = gy;
        camLook.set(p.x + fx2 * ahead, p.y + lookUp, p.z + fz2 * ahead);
        smoothPos.lerp(camPos, camInit ? Math.min(1, dt * 7) : 1);
        smoothLook.lerp(camLook, camInit ? Math.min(1, dt * 10) : 1);
      }
      world.focus.copy(p);
    }
    camInit = true;
    cam.position.copy(smoothPos);
    cam.lookAt(smoothLook);
    const wantFov = ui.mode === 'ski' && !skier.lift ? 58 + Math.min(14, skier.speed * 0.45) : 55;
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 3);
    cam.near = ui.mode === 'manage' ? 1 : 0.2;
    cam.updateProjectionMatrix();
  }
  let chaseYaw = 0;
  const wrap = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

  // ------------------------------------------------------------------ modes
  function setMode(mode: Mode) {
    if (mode === ui.mode && camInit) return;
    const prev = ui.mode;
    if (prev === 'cat') cat.driving = false;
    if (prev === 'sled') sled.driving = false;
    if (mode === 'ski') {
      if (prev === 'cat' || prev === 'sled') {
        const v = prev === 'cat' ? cat : sled;
        const sx = Math.cos(v.yaw) * 3.5, sz = -Math.sin(v.yaw) * 3.5;
        skier.place(v.p.x + sx, v.p.z + sz, v.yaw);
      }
      skier.group.visible = true;
    } else if (!skier.lift && !skier.queued) skier.group.visible = mode === 'manage' ? skier.group.visible : false;
    if (mode === 'cat') cat.driving = true;
    if (mode === 'sled') sled.driving = true;
    if (mode === 'manage' && prev !== 'manage') {
      const p = prev === 'ski' ? skier.p : prev === 'cat' ? cat.p : sled.p;
      flyTo = { target: new THREE.Vector3(p.x, p.y, p.z), dist: 260 };
    }
    chaseYawOff = chasePitchOff = 0;
    camInit = mode === 'manage' && prev !== 'manage' ? camInit : false;
    if (camInit === false && mode !== 'manage') {
      const v = mode === 'ski' ? skier : mode === 'cat' ? cat : sled;
      chaseYaw = v.yaw;
    }
    ui.setMode(mode);
    if (mode !== 'manage') ui.selected = null;
    mini = null; ui.mini(null);
  }
  ui.onMode = (md) => { audio.click(); setMode(md); };
  ui.onBuy = (id) => {
    if (sim.buy(id)) { audio.buy(); const u = UP_BY[id]; ui.toast(`${u.name}: ${u.levels?.[sim.lv(id)] ?? 'done'}`, 'good'); syncLevels(); }
    else audio.bad();
  };
  ui.onSpeed = (n) => { audio.click(); if (n === 0) sim.paused = !sim.paused; else { sim.paused = false; sim.speed = n; } };
  ui.onSkip = () => {
    audio.click();
    // the night crew finishes whatever's left; time jumps to opening
    sim.skipToMorning();
    ui.toast(`Good morning! ${WEATHER[sim.weather].name}, ${Math.round(sim.temp)}°C`, 'info');
  };
  ui.onFocus = (x, z) => { if (ui.mode !== 'manage') setMode('manage'); flyTo = { target: new THREE.Vector3(x, m.at(x, z), z), dist: Math.min(orbit.dist, 420) }; };
  ui.onJob = (j) => {
    audio.click();
    target = { x: j.x, z: j.z, label: j.text, id: j.id };
    if (j.mode === 'cat' && j.kind === 'groom') {
      // the cat drives itself up while you grab a coffee
      const d = Math.hypot(cat.p.x - j.x, cat.p.z - j.z);
      if (d > 250) {
        const r = RUN_BY[j.id.slice(6)];
        const p = m.runOf[r.id];
        cat.place(p.x[3], p.z[3], Math.atan2(p.tx[3], p.tz[3]));
        sim.s.t += 0.15;
        ui.toast('Drove the cat up to the top of the trail (9 min)', 'info');
      }
    }
    setMode(j.mode);
  };

  function syncLevels() {
    for (const l of lifts.list) l.setLevel(sim.lv('lift.' + l.def.id));
    cat.setLevel(Math.max(1, sim.lv('snowcat')));
    sled.setLevel(Math.max(1, sim.lv('sled')));
    village.update(sim);
  }
  syncLevels();

  // ------------------------------------------------------------------ incidents in the world
  const hurtMeshes = new Map<number, THREE.Group>();
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 160, 10, 1, true);
  beamGeo.translate(0, 80, 0);
  const hurtGeo = skierGeo('stand');
  function hurtMesh(inc: Incident) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.add(new THREE.Mesh(hurtGeo.jacket, new THREE.MeshStandardMaterial({ color: 0x3fb7c9 })), new THREE.Mesh(hurtGeo.rest, new THREE.MeshStandardMaterial({ vertexColors: true })));
    body.rotation.set(-Math.PI / 2, 0.6, 0);
    body.position.y = 0.25;
    const skiM = new THREE.MeshStandardMaterial({ color: 0xd2453a });
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.04), skiM); s1.position.set(2, 0.8, 0); s1.rotation.z = 0.4;
    const s2 = s1.clone(); s2.rotation.z = -0.4;
    const beam = new THREE.Mesh(beamGeo, beaconMat);
    g.add(body, s1, s2, beam);
    g.position.set(inc.x, m.ground(inc.x, inc.z), inc.z);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== beam) o.castShadow = true; });
    world.scene.add(g);
    return g;
  }
  const targetBeam = new THREE.Mesh(beamGeo, goldMat);
  targetBeam.visible = false;
  world.scene.add(targetBeam);
  let target: { x: number; z: number; label: string; id: string } | null = null;

  // ------------------------------------------------------------------ the hands-on jobs
  let carrying: Incident | null = null;
  type Mini = { kind: 'repair'; lift: string; needle: number; dir: number; zone: [number, number]; hits: number; speed: number } | { kind: 'load'; inc: Incident; t: number };
  let mini: Mini | null = null;
  function startRepair(id: string) {
    mini = { kind: 'repair', lift: id, needle: 0, dir: 1, zone: newZone(), hits: 0, speed: 0.9 };
  }
  const newZone = (): [number, number] => { const w = 0.16 + Math.random() * 0.06; const a = 0.1 + Math.random() * (0.8 - w); return [a, a + w]; };
  function drawMini() {
    if (!mini) { ui.mini(null); return; }
    if (mini.kind === 'repair') {
      const hits = mini.hits;
      ui.mini(`<h4>${icon('wrench', 18)} Fixing ${LIFT_BY[mini.lift].name}</h4><p>Press <b>E</b> when the needle is in the green to torque each bolt</p>
        <div class="gauge"><div class="zone" style="left:${mini.zone[0] * 100}%;width:${(mini.zone[1] - mini.zone[0]) * 100}%"></div><div class="needle" style="left:${mini.needle * 100}%"></div></div>
        <div class="bolts">${[0, 1, 2].map((i) => `<i class="${i < hits ? 'on' : ''}"></i>`).join('')}</div>`);
    } else ui.mini(`<h4>${icon('cross', 18)} Strapping them into the toboggan</h4><div class="gauge"><div class="zone" style="left:0;width:${Math.min(100, (mini.t / 1.3) * 100)}%"></div></div>`);
  }

  function nearestGun(x: number, z: number, r: number): Gun | null {
    let best: Gun | null = null, bd = r;
    for (const g of sim.builtGuns()) { const d = Math.hypot(g.x - x, g.z - z); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  function nearLiftLoad(x: number, z: number): Lift | null {
    for (const l of lifts.list) if (l.lv && Math.hypot(l.loadPt.x - x, l.loadPt.z - z) < 5.5) return l;
    return null;
  }

  /** what E would do right now, and do it if pressed */
  function interact(act: boolean) {
    const mode = ui.mode;
    if (mini) return;
    const pos = mode === 'ski' ? skier.p : mode === 'cat' ? cat.p : mode === 'sled' ? sled.p : null;
    if (!pos) { ui.prompt(null); return; }
    let text: string | null = null, run: (() => void) | null = null;
    if (mode === 'ski' && !skier.lift && !skier.queued && skier.crashT <= 0) {
      const l = nearLiftLoad(pos.x, pos.z);
      if (l) {
        if (sim.broken[l.def.id] !== undefined) text = `${l.def.name} is broken: fix it with the snowmobile`;
        else { text = `<kbd>E</kbd>Ride ${l.def.name}`; run = () => { l.enqueue(skier, true); skier.queued = true; skier.v.set(0, 0, 0); const qp = l.loadPt; skier.p.set(qp.x - l.dir.x * 1.2, qp.y, qp.z - l.dir.y * 1.2); skier.yaw = Math.atan2(l.dir.x, l.dir.y); audio.clunk(); }; }
      }
    }
    if (mode === 'sled') {
      if (!carrying) {
        for (const inc of sim.incidents) if (!inc.carried && Math.hypot(inc.x - pos.x, inc.z - pos.z) < 8) { text = `<kbd>E</kbd>Load the hurt skier`; run = () => { if (sled.speed > 3) { ui.toast('Stop the sled first', 'info'); return; } mini = { kind: 'load', inc, t: 0 }; }; break; }
      } else {
        const [px, pz] = BUILD_SPOTS.patrol;
        if (Math.hypot(px - pos.x, pz - 6 - pos.z) < 16) { text = `<kbd>E</kbd>Hand them over to the clinic`; run = () => { const inc = carrying!; carrying = null; sled.carrying = false; sim.resolve(inc, true); target = null; audio.good(); }; }
      }
      for (const id of Object.keys(sim.broken)) {
        const l = lifts.by[id];
        if (Math.hypot(l.loadPt.x - pos.x, l.loadPt.z - pos.z) < 16) { text = `<kbd>E</kbd>Repair ${l.def.name}`; run = () => { if (sled.speed > 3) { ui.toast('Stop the sled first', 'info'); return; } startRepair(id); }; }
      }
    }
    if (!text) {
      const g = nearestGun(pos.x, pos.z, mode === 'cat' ? 10 : 8);
      if (g) {
        const on = sim.gunOn.has(g.id);
        text = `<kbd>E</kbd>${on ? 'Switch off' : 'Switch on'} snow gun${!on && !sim.canMakeSnow ? ' (too warm to make snow now)' : ''}`;
        run = () => { const now = sim.toggleGun(g); audio.clunk(); ui.toast(now ? (sim.canMakeSnow ? 'Snow gun running' : 'Gun on: it will start when it drops below -2°C') : 'Snow gun off', 'info'); };
      }
    }
    if (mode === 'cat' && !text) text = `Tiller ${cat.tiller ? '<b>down</b>: grooming' : '<b>up</b>'} · <kbd>Q</kbd>`;
    ui.prompt(text);
    if (act && run) run();
  }

  function tickMini(dt: number) {
    if (!mini) return;
    if (hit('Escape')) { mini = null; drawMini(); return; }
    if (mini.kind === 'repair') {
      mini.needle += mini.dir * mini.speed * dt;
      if (mini.needle > 1) { mini.needle = 1; mini.dir = -1; }
      if (mini.needle < 0) { mini.needle = 0; mini.dir = 1; }
      if (hit('KeyE', 'Space')) {
        if (mini.needle >= mini.zone[0] && mini.needle <= mini.zone[1]) {
          mini.hits++; audio.wrench(true); mini.zone = newZone(); mini.speed *= 1.25;
          if (mini.hits >= 3) { sim.fixLift(mini.lift); target = null; mini = null; audio.good(); }
        } else { mini.hits = Math.max(0, mini.hits - 1); audio.wrench(false); const el = $('#u-mini'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
      }
    } else {
      mini.t += dt;
      if (mini.t > 1.3) {
        const inc = mini.inc;
        inc.carried = true;
        carrying = inc;
        sled.carrying = true;
        const [px, pz] = BUILD_SPOTS.patrol;
        target = { x: px, z: pz + 6, label: 'Patrol clinic', id: 'clinic' };
        ui.toast('Patient loaded. Drive gently to the patrol clinic at the base', 'good');
        mini = null;
      }
    }
    drawMini();
  }

  // ------------------------------------------------------------------ skier callbacks
  let runTimer: { id: string; t: number; off: number } | null = null;
  skier.onTrick = (t) => {
    ui.trick(t.name, t.score, t.clean);
    if (t.clean) {
      audio.trick(t.score);
      const crowdK = sim.isOpen ? Math.min(1, sim.onMountain / 300) : 0.15;
      sim.addBuzz((t.score / 30000) * (0.3 + crowdK));
    }
  };
  skier.onCrash = (why) => { audio.crash(); fx.emit(skier.p.x, skier.p.y + 0.4, skier.p.z, skier.v.x * 0.4, 2, skier.v.z * 0.4, 5, 90, 1.4, 110); ui.trick(why, 0, false); if (runTimer) { runTimer = null; ui.toast('Run timer cancelled', 'info'); } };
  skier.onLand = (imp) => { audio.land(imp); if (imp > 4) fx.emit(skier.p.x, skier.p.y + 0.1, skier.p.z, skier.v.x * 0.3, 1.5, skier.v.z * 0.3, 3, Math.min(60, imp * 5), 0.9, 70); };
  skier.onUnload = (l) => { audio.clunk(); if (sim.s.tut === 4) advanceTut(); };

  function trackRunTimer(dt: number) {
    if (ui.mode !== 'ski' || skier.lift || skier.queued) { return; }
    if (runTimer) {
      runTimer.t += dt;
      const p = m.runOf[runTimer.id];
      const n = m.nearestOn(p, skier.p.x, skier.p.z);
      if (n.d > p.def.w / 2 + 25) { runTimer.off += dt; if (runTimer.off > 4) { runTimer = null; ui.toast('Left the trail: timer cancelled', 'info'); return; } } else runTimer.off = 0;
      if (p.s[n.i] > p.len - 8 && n.d < p.def.w / 2 + 6) {
        const r = sim.finishRun(runTimer.id, runTimer.t);
        const medal = ['No medal', 'Bronze', 'Silver', 'Gold'][r.medal];
        ui.trick(`${RUN_BY[runTimer.id].name} ${runTimer.t.toFixed(1)}s`, 0, true);
        ui.toast(`${medal}${r.paid ? `! Sponsors paid ${money(r.paid)}` : ''} · gold is ${r.par[2].toFixed(0)}s`, r.medal ? 'good' : 'info');
        if (r.medal) audio.trick(1200);
        runTimer = null;
      }
      return;
    }
    if (skier.speed < 3) return;
    for (const r of RUNS) {
      if (!sim.runBuilt(r.id)) continue;
      const p = m.runOf[r.id];
      const dx = skier.p.x - p.x[4], dz = skier.p.z - p.z[4];
      if (dx * dx + dz * dz < (r.w / 2 + 4) ** 2 && skier.v.x * p.tx[4] + skier.v.z * p.tz[4] > 2) {
        runTimer = { id: r.id, t: 0, off: 0 };
        ui.toast(`Timing ${r.name}: gold in ${sim.par(r.id)[2].toFixed(0)}s`, 'info');
        break;
      }
    }
  }

  // ------------------------------------------------------------------ jobs list
  function computeJobs() {
    const jobs: Job[] = [];
    for (const [id, t0] of Object.entries(sim.broken)) {
      const l = lifts.by[id];
      jobs.push({ id: 'lift:' + id, kind: 'lift', text: `Fix ${l.def.name}`, sub: `Stopped ${Math.round((sim.s.t - t0) * 60)} min · riders stuck`, x: l.loadPt.x, z: l.loadPt.z, mode: 'sled', urgent: true });
    }
    for (const inc of sim.incidents) {
      if (inc.carried) continue;
      jobs.push({ id: 'hurt:' + inc.id, kind: 'hurt', text: `Skier down on ${RUN_BY[inc.run].name}`, sub: `Waiting ${Math.round((sim.s.t - inc.t0) * 60)} min · take the sled`, x: inc.x, z: inc.z, mode: 'sled', urgent: true });
    }
    if (carrying) { const [px, pz] = BUILD_SPOTS.patrol; jobs.unshift({ id: 'clinic', kind: 'hurt', text: 'Bring the skier to the clinic', sub: 'Patrol hut at the base', x: px, z: pz + 6, mode: 'sled', urgent: true }); }
    const night = sim.phase === 'night' || sim.phase === 'prep' || sim.closedToday;
    if (night && sim.canMakeSnow) {
      for (const r of RUNS) {
        const off = sim.builtGuns().filter((g) => g.run === r.id && !sim.gunOn.has(g.id));
        if (!off.length) continue;
        jobs.push({ id: 'guns:' + r.id, kind: 'guns', text: `Snow guns on ${r.name}`, sub: `${off.length} off · ${Math.round(sim.temp)}°C is cold enough`, x: off[0].x, z: off[0].z, mode: 'sled', urgent: false });
      }
    }
    const rough = RUNS.filter((r) => sim.runBuilt(r.id) && (sim.runGroom[r.id] ?? 1) < 0.6).sort((a, b) => sim.runGroom[a.id] - sim.runGroom[b.id]).slice(0, 3);
    for (const r of rough) {
      const p = m.runOf[r.id];
      jobs.push({ id: 'groom:' + r.id, kind: 'groom', text: `Groom ${r.name}`, sub: `${Math.round(sim.runGroom[r.id] * 100)}% groomed · ${Math.round(sim.runQ[r.id] * 100)}% quality`, x: p.x[3], z: p.z[3], mode: 'cat', urgent: false });
    }
    ui.jobs = jobs.slice(0, 7);
    // keep the target if its job still exists
    if (target && target.id !== 'clinic' && !jobs.some((j) => j.id === target!.id)) target = null;
  }

  // ------------------------------------------------------------------ tutorial (Marta on the radio)
  let tutT = 0;
  function advanceTut() { sim.s.tut++; tutT = 0; }
  function tutorial(dt: number) {
    tutT += dt;
    const s = sim.s;
    const msgs: (string | null)[] = [
      `Morning, boss! Lifts open at 8:30 and Sprout Slope is only half groomed. Press <kbd>3</kbd> to fire up the snowcat.`,
      `<kbd>W</kbd> drives, <kbd>A</kbd>/<kbd>D</kbd> steer, and it turns on the spot. Keep the tiller down and drive over the rough half of Sprout Slope (the gold beam). Those stripes behind you are corduroy.`,
      `Beautiful lines. Skiers pay more for good snow. Press <kbd>1</kbd> to manage the resort.`,
      `Tickets earn all day. Save up ${money(UP_BY['lift.meadow'].cost(0))} for the <b>Meadow Chair</b> (Lifts tab) to open the real mountain. Jobs pop up on the left: hurt skiers and broken lifts can't wait.`,
      `The chair comes with Meadowlark cut for free. Press <kbd>2</kbd> and ski it yourself: <kbd>E</kbd> at the lift to ride, hold <kbd>Space</kbd> to speed the ride up.`,
      `Nice. Trails time you from the top: beat the gold time for a sponsor payout. Tricks off jumps get people talking, and buzz brings more skiers tomorrow.`,
    ];
    if (s.tut === 0 && ui.mode === 'cat') advanceTut();
    if (s.tut === 1) { const bp = m.runOf['bunny']; if (!target) target = { x: bp.x[Math.floor(bp.x.length / 2)] + 8, z: bp.z[Math.floor(bp.x.length / 2)], label: 'Sprout Slope', id: 'tut' }; if ((sim.runGroom['bunny'] ?? 0) > 0.86 || sim.hour > OPEN + 1.5) { advanceTut(); target = null; } }
    if (s.tut === 2 && ui.mode === 'manage') advanceTut();
    if (s.tut === 3 && sim.liftBuilt('meadow')) advanceTut();
    if (s.tut === 5 && tutT > 12) advanceTut();
    if (s.tut === 6) {
      if (sim.phase === 'night' && !nightHintShown) { nightHintShown = true; tutT = 0; }
      if (nightHintShown && tutT < 12) { ui.radio(`After close the mountain is yours. Groom what got skied off, and if it's cold, drive the sled round and switch on the snow guns. Or go ski under the stars.`); return; }
    }
    ui.radio(s.tut < msgs.length ? msgs[s.tut] : null);
  }
  let nightHintShown = false;

  // ------------------------------------------------------------------ overview labels
  const V = new THREE.Vector3();
  function project(x: number, y: number, z: number) {
    V.set(x, y, z).project(cam);
    if (V.z > 1 || V.z < -1) return null;
    return { x: (V.x * 0.5 + 0.5) * innerWidth, y: (-V.y * 0.5 + 0.5) * innerHeight };
  }
  function labels() {
    if (ui.mode !== 'manage') { ui.labels([]); return; }
    const out: Label[] = [];
    const far = orbit.dist > 1100;
    for (const l of lifts.list) {
      const id = l.def.id;
      const built = sim.liftBuilt(id);
      const p = l.towers[0];
      const s = project(p.x, p.y + 8, p.z);
      if (!s) continue;
      const br = sim.broken[id] !== undefined;
      const cost = built ? '' : ` <small>${money(l.def.cost)}</small>`;
      out.push({ id: 'l' + id, x: s.x, y: s.y, cls: br ? 'bad' : built ? '' : 'dim', html: `${icon(l.def.kind === 'chair' ? 'chair' : l.def.kind, 14)} ${l.def.name}${br ? ' <small>BROKEN</small>' : built && l.queue.length > 8 ? ` <small>${l.queue.length} in line</small>` : ''}${cost}`, click: () => { ui.select('lift', id); }, hidden: far && !built });
    }
    for (const r of RUNS) {
      const p = m.runOf[r.id];
      const i = Math.floor(p.x.length * 0.3);
      const s = project(p.x[i], p.h[i] + 4, p.z[i]);
      if (!s) continue;
      const built = sim.runBuilt(r.id);
      const q = sim.runQ[r.id] ?? 0;
      const thin = built && !sim.runOpen(r.id);
      out.push({ id: 'r' + r.id, x: s.x, y: s.y, cls: built ? (thin ? 'bad' : '') : 'dim', html: `${icon(r.diff, 13)} ${r.name} ${built ? `<small>${thin ? 'closed' : Math.round(q * 100) + '%'}</small>` : `<small>${r.cost ? money(r.cost) : ''}</small>`}`, click: () => { ui.select('run', r.id); }, hidden: far && !built });
    }
    for (const inc of sim.incidents) {
      if (inc.carried) continue;
      const s = project(inc.x, m.ground(inc.x, inc.z) + 6, inc.z);
      if (s) out.push({ id: 'i' + inc.id, x: s.x, y: s.y, cls: 'marker', html: `${icon('cross', 13)} Skier down`, click: () => { target = { x: inc.x, z: inc.z, label: 'Hurt skier', id: 'hurt:' + inc.id }; setMode('sled'); } });
    }
    ui.labels(out);
  }

  // ------------------------------------------------------------------ the loop
  let last = performance.now();
  let saveT = 0, jobsT = 0, tSec = 0, lampsT = 0;
  if (offlineEarned > 0) ui.welcome(offlineEarned);
  setMode((q.get('mode') as Mode) || 'manage');
  (window as any).__bb = { sim, world, m, lifts, crowd, skier, cat, sled, ui, setMode, orbit, village, fx };

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tSec += dt;
    // hold space on a lift: the world speeds up
    const ff = ui.mode === 'ski' && skier.lift && keys.has('Space') ? 6 : 1;
    const wdt = dt * ff * (sim.paused ? 0 : 1);
    sim.paused = sim.paused || false;
    const modal = ui.modalOpen;
    if (!modal) sim.update(dt * ff);

    // sim events
    for (const e of sim.events.splice(0)) {
      if (e.k === 'toast') { ui.toast(e.text, e.tone); if (e.tone === 'bad') audio.bad(); }
      else if (e.k === 'summary') { ui.summary(e.day, e.stats, e.stars, e.profit, `${WEATHER[sim.s.weather[1]].name}`); }
      else if (e.k === 'level') syncLevels();
      else if (e.k === 'cash') {}
      else if (e.k === 'newday') { for (const [id, g] of hurtMeshes) { world.scene.remove(g); hurtMeshes.delete(id); } if (carrying) { carrying = null; sled.carrying = false; } }
    }
    // hurt skiers on the snow
    for (const inc of sim.incidents) if (!inc.carried && !hurtMeshes.has(inc.id)) hurtMeshes.set(inc.id, hurtMesh(inc));
    for (const [id, g] of hurtMeshes) { const inc = sim.incidents.find((i) => i.id === id); if (!inc || inc.carried) { world.scene.remove(g); hurtMeshes.delete(id); } }

    // lifts run when open, or for you
    for (const l of lifts.list) {
      const near = (ui.mode === 'ski' && (skier.lift === l || skier.queued || Math.hypot(skier.p.x - l.loadPt.x, skier.p.z - l.loadPt.z) < 90));
      const run = sim.liftBuilt(l.def.id) && sim.broken[l.def.id] === undefined && (sim.isOpen || near || l.riders.some((c) => c.some(Boolean)));
      l.update(wdt, run);
    }
    crowd.update(wdt);
    village.setCars(sim.onMountain / Math.max(1, sim.demand || 1) + 0.1);

    // you
    const c = controls();
    const playing = !modal && !mini;
    if (ui.mode === 'ski') {
      if (!skier.lift && !skier.queued) skier.update(dt, playing ? c : { up: 0, down: 0, left: 0, right: 0, jump: false, jumpHeld: false, grab: false, act: false });
      else skier.update(wdt, c);
      // spray
      if (!skier.air && skier.crashT <= 0 && !skier.lift && skier.speed > 6) {
        const turn = Math.abs(skier.edge) + skier.brake * 1.5;
        if (turn > 0.35) {
          const sx = Math.cos(skier.yaw) * skier.edge, sz = -Math.sin(skier.yaw) * skier.edge;
          fx.emit(skier.p.x - Math.sin(skier.yaw) * 0.7, skier.p.y + 0.05, skier.p.z - Math.cos(skier.yaw) * 0.7, skier.v.x * 0.25 + sx * 3, 1.2 + turn, skier.v.z * 0.25 + sz * 3, 1.6, Math.ceil(turn * 2 + skier.surf.powder * 4), 0.7, 40 + skier.surf.powder * 50);
        }
      }
    } else if (!skier.lift && !skier.queued) skier.update(dt, { up: 0, down: 0, left: 0, right: 0, jump: false, jumpHeld: false, grab: false, act: false });
    else skier.update(wdt, c);
    if (hit('KeyQ') && ui.mode === 'cat') { cat.tiller = !cat.tiller; audio.clunk(); }
    cat.update(dt, ui.mode === 'cat' && playing ? c : null, tSec);
    if (cat.groomGain > 0) sim.s.today.groomed += 0;
    if (ui.mode === 'cat' && Math.abs(cat.speed) > 0.5) sim.spend((dt * sim.speed) / SEC_PER_HOUR * 34, 'fuel');
    if (ui.mode === 'cat' && cat.tiller && cat.speed > 0.6 && Math.random() < 0.7) {
      const fx2 = Math.sin(cat.yaw), fz2 = Math.cos(cat.yaw);
      const w = SNOWCAT[cat.lv].w;
      const side = (Math.random() - 0.5) * w;
      fx.emit(cat.p.x - fx2 * 4.2 + fz2 * side, cat.p.y + 0.3, cat.p.z - fz2 * 4.2 - fx2 * side, -fx2 * 1.5, 0.8, -fz2 * 1.5, 1.2, 1, 0.8, 70);
    }
    sled.update(dt, ui.mode === 'sled' && playing ? c : null);
    if (ui.mode === 'sled' && sled.speed > 8 && !sled.air) {
      fx.emit(sled.p.x - Math.sin(sled.yaw) * 1.6, sled.p.y + 0.2, sled.p.z - Math.cos(sled.yaw) * 1.6, -sled.vel.x * 0.15, 2.5, -sled.vel.y * 0.15, 1.5, 2, 0.8, 60);
    }
    audio.sledRpm = Math.min(1, sled.speed / 30 + (c.up && ui.mode === 'sled' ? 0.25 : 0));

    if (playing) interact(c.act); else if (!mini) ui.prompt(null);
    tickMini(dt);
    if (hit('Escape') && !mini && ui.mode !== 'manage') setMode('manage');
    if (hit('Digit1')) setMode('manage');
    if (hit('Digit2')) setMode('ski');
    if (hit('Digit3')) setMode('cat');
    if (hit('Digit4')) setMode('sled');
    if (hit('KeyC') && ui.mode !== 'manage') camStyle = (camStyle + 1) % 3;
    if (hit('KeyR') && ui.mode !== 'manage' && !skier.lift) {
      const v = ui.mode === 'ski' ? skier : ui.mode === 'cat' ? cat : sled;
      if (ui.mode === 'ski') { skier.queued = false; for (const l of lifts.list) l.leaveQueue(skier); skier.place(-40, 468, Math.PI); }
      else v.place(shx + (ui.mode === 'cat' ? -6 : 10), shz - 32, Math.PI);
      ui.toast('Back at the base', 'info');
    }
    // snow gun plumes
    const tmp = new THREE.Vector3();
    village.setGunState(sim, tSec);
    if (sim.gunOn.size && sim.canMakeSnow) {
      for (const g of sim.builtGuns()) {
        if (!sim.gunOn.has(g.id)) continue;
        if (Math.hypot(g.x - cam.position.x, g.z - cam.position.z) > 700) continue;
        village.gunNozzle(g, tmp);
        fx.emit(tmp.x, tmp.y, tmp.z, g.dx * 17, 4.5, g.dz * 17, 2.6, 5, 2.6, 120);
      }
    }
    fx.update(dt, world.night, innerHeight * world.renderer.getPixelRatio(), cam.fov);

    // world look
    const w = WEATHER[sim.weather];
    const snowing = w.snow > 0 ? Math.min(1, w.snow / 4) * (0.5 + 0.5 * Math.sin(sim.s.t * 1.3) ** 2) * 4.5 : 0;
    world.setTime(sim.hour, w.cloud, snowing, w.wind, dt, tSec);
    world.syncSnow(sim);
    lampsT -= dt;
    const dark = world.night > 0.35;
    skier.headlamp.intensity = ui.mode === 'ski' && dark ? 70 : 0;
    cat.setLights(dark || w.cloud > 0.9 ? 90 : 0);
    sled.setLights(dark ? 80 : 0);

    // target beam + arrow
    computeJobsMaybe(dt);
    if (target) {
      targetBeam.visible = true;
      targetBeam.position.set(target.x, m.ground(target.x, target.z), target.z);
      const p = ui.mode === 'ski' ? skier.p : ui.mode === 'cat' ? cat.p : ui.mode === 'sled' ? sled.p : null;
      if (p && ui.mode !== 'manage') {
        const d = Math.hypot(target.x - p.x, target.z - p.z);
        const camYaw = Math.atan2(smoothLook.x - smoothPos.x, smoothLook.z - smoothPos.z);
        const ang = Math.atan2(target.x - p.x, target.z - p.z) - camYaw;
        ui.arrow(d > 12, -ang, d, target.label);
      } else ui.arrow(false);
    } else { targetBeam.visible = false; ui.arrow(false); }

    // minimap markers
    const mk: { x: number; z: number; kind: string }[] = [];
    for (const inc of sim.incidents) if (!inc.carried) mk.push({ x: inc.x, z: inc.z, kind: 'hurt' });
    for (const g of sim.builtGuns()) mk.push({ x: g.x, z: g.z, kind: sim.gunOn.has(g.id) ? 'gunOn' : 'gun' });
    mk.push({ x: cat.p.x, z: cat.p.z, kind: 'cat' }, { x: sled.p.x, z: sled.p.z, kind: 'sled' });
    if (target) mk.push({ x: target.x, z: target.z, kind: 'target' });
    ui.markers = mk;
    const youP = ui.mode === 'ski' ? { x: skier.p.x, z: skier.p.z, yaw: skier.yaw } : ui.mode === 'cat' ? { x: cat.p.x, z: cat.p.z, yaw: cat.yaw } : ui.mode === 'sled' ? { x: sled.p.x, z: sled.p.z, yaw: sled.yaw } : null;
    ui.you = youP;

    // hud
    hudFor();
    trackRunTimer(dt);
    tutorial(dt);
    updateCamera(dt);
    labels();
    ui.update(dt);

    // sound
    const wind = ui.mode === 'ski' ? Math.min(1, skier.speed / 26) * (skier.air ? 1.2 : 1) + w.wind * 0.3 : w.wind * 0.4 + (ui.mode === 'manage' ? Math.min(0.3, orbit.dist / 3000) : 0);
    const nearGun = (() => { let d = 1e9; for (const g of sim.builtGuns()) if (sim.gunOn.has(g.id)) d = Math.min(d, Math.hypot(g.x - cam.position.x, g.z - cam.position.z)); return sim.canMakeSnow ? Math.max(0, 1 - d / 90) : 0; })();
    audio.frame({
      wind,
      carve: ui.mode === 'ski' && !skier.air && !skier.lift ? Math.min(1, skier.speed / 18) * (0.4 + Math.abs(skier.edge) * 0.8) : 0,
      spray: ui.mode === 'ski' && !skier.air ? skier.brake * Math.min(1, skier.speed / 10) : 0,
      cat: ui.mode === 'cat' ? 1 : Math.max(0, 1 - cam.position.distanceTo(cat.p) / 80) * 0.5,
      catLoad: Math.min(1, Math.abs(cat.speed) / 10 + (ui.mode === 'cat' && (c.up || c.down) ? 0.3 : 0)),
      sled: ui.mode === 'sled' ? 1 : 0,
      gun: nearGun,
      hum: ui.mode === 'ski' && skier.lift ? 1 : 0,
      night: world.night,
    });

    pressed.clear();
    world.render();
    saveT += dt;
    if (saveT > 10) { saveT = 0; persist(); }
  }

  function computeJobsMaybe(dt: number) { jobsT -= dt; if (jobsT < 0) { jobsT = 0.5; computeJobs(); } }

  function hudFor() {
    const mode = ui.mode;
    if (mode === 'ski') {
      const kmh = Math.round(skier.speed * 3.6);
      const timer = runTimer ? `<div class="g"><small>${RUN_BY[runTimer.id].name}</small><b>${runTimer.t.toFixed(1)}<em>s</em></b></div>` : '';
      const lift = skier.lift ? `<div class="g"><small>${skier.lift.def.name}</small><b>${Math.round(skier.lift.rideFrac(skier.chair) * 100)}<em>%</em></b><div class="bar"><i style="width:${skier.lift.rideFrac(skier.chair) * 100}%"></i></div><small style="margin-top:4px">hold Space to speed up</small></div>` : '';
      const surf = skier.surf.groom > 0.6 ? 'Corduroy' : skier.surf.powder > 0.4 ? 'Powder' : skier.surf.chop > 0.5 ? 'Chopped up' : 'Packed';
      ui.hud(lift || `<div class="g"><small>Speed</small><b>${kmh}<em>km/h</em></b></div><div class="g"><small>Snow</small><b style="font-size:18px">${surf}</b></div>${timer}`);
    } else if (mode === 'cat') {
      const k = m.cellAt(cat.p.x, cat.p.z);
      const ri = k >= 0 ? m.runCell[k] : 0;
      const r = ri ? RUNS[ri - 1] : null;
      const g = r ? sim.runGroom[r.id] : 0;
      ui.hud(`<div class="g"><small>Speed</small><b>${Math.round(Math.abs(cat.speed) * 3.6)}<em>km/h</em></b></div><div class="g"><small>${r ? r.name : 'Off piste'}</small><b>${r ? Math.round(g * 100) : '–'}<em>${r ? '% groomed' : ''}</em></b>${r ? `<div class="bar"><i style="width:${g * 100}%"></i></div>` : ''}</div><div class="g"><small>Tiller</small><b style="font-size:18px">${cat.tiller ? 'Down' : 'Up'}</b></div>`);
    } else if (mode === 'sled') {
      ui.hud(`<div class="g"><small>Speed</small><b>${Math.round(sled.speed * 3.6)}<em>km/h</em></b></div>${carrying ? '<div class="g"><small>Toboggan</small><b style="font-size:18px">Patient aboard</b></div>' : ''}`);
    } else ui.hud('');
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
