import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, Mode } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { signTexture } from './obstacles.ts';

/**
 * Storm Deck: a round raft out in a thunderstorm, no rail round it. Lightning strikes the deck:
 * a ring of light marks each spot a moment before, then the bolt blasts everyone near it flying.
 * More strikes and faster as the round goes on, now and then a big one. Last ones aboard go through.
 * Every strike is a pure function of the round's clock (seeded), so every browser sees the same storm.
 */

const UPV = new THREE.Vector3(0, 1, 0);
export const STORM = { R: 15.5, warn: 1.45, r: 2.35, big: 4.4, waveAt: 9, waveEvery: 11, waveV: 8.5 };

export interface Strike {
  /** seconds after the off */
  t: number;
  x: number;
  z: number;
  r: number;
}

export interface StormArena {
  center: THREE.Vector3;
  R: number;
  /** strikes landing between t0 and t1 (seconds after the off), in order */
  between(t0: number, t1: number, out: Strike[]): Strike[];
  /** the wave crossing the deck at x, if there is one: the way it's going, and how far along */
  wave(x: number): { ux: number; uz: number; d: number } | null;
}

/** a big wave right across the deck, every so often, from a new side each time: hop it or ride it off */
function waveAt(x: number, R: number) {
  const n = Math.floor((x - STORM.waveAt) / STORM.waveEvery);
  if (n < 0) return null;
  const u = x - STORM.waveAt - n * STORM.waveEvery;
  const d = -R - 5 + u * STORM.waveV;
  if (d > R + 5) return null;
  const a = n * 2.399963;
  return { ux: Math.cos(a), uz: Math.sin(a), d };
}

function schedule(R: number) {
  const list: Strike[] = [];
  let sd = 90217;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  let t = 2.4;
  let nextBig = 9;
  // (a small seed's first numbers are all tiny: run it in)
  for (let k = 0; k < 8; k++) rnd();
  while (t < 200) {
    const iv = Math.max(0.36, 1.2 - 0.03 * t);
    const n = Math.min(6, 1 + Math.floor(t / 14));
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2, r = (R - 0.6) * Math.sqrt(rnd());
      list.push({ t: t + j * 0.13, x: Math.cos(a) * r, z: Math.sin(a) * r, r: STORM.r });
    }
    if (t > nextBig) {
      const a = rnd() * Math.PI * 2, r = R * 0.55 * Math.sqrt(rnd());
      list.push({ t: t + 0.3, x: Math.cos(a) * r, z: Math.sin(a) * r, r: STORM.big });
      nextBig += 8 + rnd() * 5;
    }
    t += iv * (0.8 + rnd() * 0.4);
  }
  list.sort((p, q) => p.t - q.t);
  return list;
}

/** the deck: planks, a hazard ring at the edge, a bolt painted in the middle */
function deckTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  const tones = ['#8a5a34', '#9a6a3e', '#7e5230', '#a07444', '#8f6038'];
  for (let i = 0; i < 32; i++) {
    x.fillStyle = tones[(i * 7) % tones.length];
    x.fillRect(0, i * 32, 1024, 32);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, i * 32, 1024, 2);
    // (plank ends, staggered)
    for (let k = 0; k < 3; k++) x.fillRect(((i * 397 + k * 341) % 1024), i * 32, 2, 32);
    x.fillStyle = 'rgba(40,24,10,0.6)';
    for (let k = 0; k < 6; k++) x.fillRect(((i * 211 + k * 170) % 1024), i * 32 + 14, 3, 3);
  }
  // the hazard ring at the edge
  const cx = 512, R = 512;
  for (let k = 0; k < 64; k++) {
    x.beginPath();
    x.moveTo(cx, cx);
    x.arc(cx, cx, R, (k / 64) * Math.PI * 2, ((k + 1) / 64) * Math.PI * 2);
    x.closePath();
    x.fillStyle = k % 2 ? '#1d1b22' : '#ffcf2a';
    x.fill();
  }
  x.save();
  x.beginPath();
  x.arc(cx, cx, R * 0.93, 0, Math.PI * 2);
  x.clip();
  for (let i = 0; i < 32; i++) {
    x.fillStyle = tones[(i * 7) % tones.length];
    x.fillRect(0, i * 32, 1024, 32);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, i * 32, 1024, 2);
    for (let k = 0; k < 3; k++) x.fillRect(((i * 397 + k * 341) % 1024), i * 32, 2, 32);
  }
  x.restore();
  // a big bolt in the middle
  x.save();
  x.translate(cx, cx);
  x.rotate(0.25);
  x.beginPath();
  const pts = [[-40, -170], [70, -170], [20, -30], [90, -30], [-60, 190], [-10, 30], [-80, 30]];
  pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
  x.closePath();
  x.fillStyle = '#ffcf2a';
  x.fill();
  x.lineWidth = 14;
  x.strokeStyle = '#1d1b22';
  x.stroke();
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function storm(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 130, 0);
  const R = STORM.R;
  b.lakeY = center.y - 30;
  const state = { go: 1e9 };
  const list = schedule(R);
  const between = (t0: number, t1: number, out: Strike[]) => {
    out.length = 0;
    // (binary search to the first at or after t0)
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m].t < t0) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < list.length && list[i].t < t1; i++) out.push(list[i]);
    return out;
  };
  // the deck: a thick round raft (its top and rim are the course), a keel under it
  {
    const top = new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2).translate(center.x, center.y, center.z);
    const topM = new THREE.MeshPhysicalMaterial({ map: deckTexture(), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const tm = new THREE.Mesh(top, topM);
    tm.receiveShadow = true;
    b.group.add(tm);
    b.world.statics.addGeometry(top, Mat.Wood);
    const rim = new THREE.CylinderGeometry(R, R * 0.97, 1.4, 96, 1, true).translate(center.x, center.y - 0.7, center.z);
    const rimM = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.7 });
    const rmesh = new THREE.Mesh(rim, rimM);
    rmesh.castShadow = rmesh.receiveShadow = true;
    b.group.add(rmesh);
    b.world.statics.addGeometry(rim, Mat.Wood);
    const keel = new THREE.Mesh(new THREE.ConeGeometry(R * 0.97, 7, 48, 1, true).rotateX(Math.PI).translate(center.x, center.y - 4.9, center.z), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8, side: THREE.DoubleSide }));
    b.group.add(keel);
    // brass studs round the edge
    const stud = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 6), b.brass, 60);
    const M = new THREE.Matrix4();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      stud.setMatrixAt(k, M.makeTranslation(center.x + Math.cos(a) * (R + 0.02), center.y - 0.5, center.z + Math.sin(a) * (R + 0.02)));
    }
    b.group.add(stud);
  }
  // two masts (cover from nothing: lightning strikes where it likes) with furled sails and lamps
  for (const [mx, mz] of [[-5.5, 2.5], [6, -3.5]]) {
    const h = 11;
    const k = new Kin({ type: 'cyl', r: 0.32, hh: h / 2 }, Mat.Wood);
    k.pos.set(center.x + mx, center.y + h / 2, center.z + mz);
    k.set(0);
    b.world.addKin(k);
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.7 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, h, 12), wood));
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 6, 8).rotateZ(Math.PI / 2), wood);
    yard.position.y = h * 0.28;
    g.add(yard);
    const sail = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5.6, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.9 }));
    sail.position.y = h * 0.28 - 0.45;
    g.add(sail);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), glowMat(0xffd070, 2.6));
    lamp.position.y = h / 2 + 0.3;
    g.add(lamp);
    g.position.copy(k.pos);
    g.traverse((o) => (o.castShadow = true));
    b.group.add(g);
  }
  // the name, on a board at the back
  {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: signTexture(info.name.toUpperCase(), 'Survival · Dodge the lightning', 0x30a0ff, 9 / 1.7), transparent: true }));
    sign.position.set(center.x, center.y + 7.5, center.z - R - 6);
    b.group.add(sign);
  }
  // the strikes: a ring of light where one's coming, the bolt, a scorch after
  const POOL = 14;
  const ringG = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  const discG = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringG, glowMat(0xffe070, 2.4, { transparent: true, opacity: 0.9, depthWrite: false }), POOL);
  const discs = new THREE.InstancedMesh(discG, new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.22, depthWrite: false }), POOL);
  const scorch = new THREE.InstancedMesh(discG, new THREE.MeshBasicMaterial({ color: 0x1a1008, transparent: true, opacity: 0.55, depthWrite: false }), POOL);
  // (a bolt: a jagged ribbon from the cloud to the deck, its shape varying by strike)
  const boltG = (() => {
    const pts: THREE.Vector3[] = [];
    let x = 0, z = 0;
    for (let y = 0; y <= 1.0001; y += 0.08) {
      pts.push(new THREE.Vector3(x, y, z));
      x += Math.sin(y * 91.7) * 0.05;
      z += Math.cos(y * 57.3) * 0.05;
    }
    pts[pts.length - 1].set(0, 1, 0);
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 24, 0.006, 5);
  })();
  const bolts = new THREE.InstancedMesh(boltG, glowMat(0xeef4ff, 3.2), 6);
  for (const im of [rings, discs, scorch, bolts]) {
    im.frustumCulled = false;
    im.count = 0;
    b.group.add(im);
  }
  const flashL = new THREE.PointLight(0xdde8ff, 0, 60, 1.6);
  b.group.add(flashL);
  const live: Strike[] = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  b.animators.push((t) => {
    const x = t - state.go;
    between(x - 1.6, x + STORM.warn, live);
    let nr = 0, nb = 0, ns = 0;
    let flash = 0;
    for (const s of live) {
      const dt = s.t - x;
      if (dt > 0 && nr < POOL) {
        // coming: the ring closes in on its spot, the disc brightens
        const k = 1 - dt / STORM.warn;
        V.set(center.x + s.x, center.y + 0.04, center.z + s.z);
        S.setScalar(s.r * (1.6 - 0.6 * k));
        rings.setMatrixAt(nr, M.compose(V, Q.identity(), S));
        S.setScalar(s.r);
        V.y = center.y + 0.03;
        discs.setMatrixAt(nr, M.compose(V, Q, S.setScalar(s.r * (0.3 + 0.7 * k))));
        nr++;
      } else if (dt <= 0) {
        if (-dt < 0.2 && nb < 6) {
          V.set(center.x + s.x, center.y, center.z + s.z);
          Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.t * 7);
          bolts.setMatrixAt(nb++, M.compose(V, Q, S.set(s.r > 3 ? 40 : 28, 60, s.r > 3 ? 40 : 28)));
          flash = Math.max(flash, 1 + dt * 5);
          flashL.position.set(V.x, V.y + 6, V.z);
        }
        if (ns < POOL) {
          V.set(center.x + s.x, center.y + 0.02, center.z + s.z);
          scorch.setMatrixAt(ns++, M.compose(V, Q.identity(), S.setScalar(s.r * 0.7)));
        }
      }
    }
    rings.count = nr;
    discs.count = nr;
    bolts.count = nb;
    scorch.count = ns;
    for (const im of [rings, discs, bolts, scorch]) im.instanceMatrix.needsUpdate = true;
    flashL.intensity = flash * 900;
  });
  // the rain
  {
    const N = 700;
    const rain = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, 1.1), new THREE.MeshBasicMaterial({ color: 0xc8d8f0, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }), N);
    rain.frustumCulled = false;
    b.group.add(rain);
    const sx = new Float32Array(N), sz = new Float32Array(N), sp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 34 * Math.sqrt(Math.random());
      sx[i] = Math.cos(a) * r;
      sz[i] = Math.sin(a) * r;
      sp[i] = Math.random();
    }
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0.12));
    const one = new THREE.Vector3(1, 1, 1);
    b.animators.push((t) => {
      for (let i = 0; i < N; i++) {
        const u = ((t * 1.1 + sp[i]) % 1 + 1) % 1;
        V.set(center.x + sx[i] + u * 2, center.y + 26 - u * 34, center.z + sz[i] + u * 1.5);
        rain.setMatrixAt(i, M.compose(V, tilt, one));
      }
      rain.instanceMatrix.needsUpdate = true;
    });
  }
  // the waves: a low wall of water, hop it (it's a Kin: it shoves what it meets along with it)
  {
    const hh = 0.42, hw = R + 5;
    const kin = new Kin({ type: 'box', hx: 0.7, hy: hh, hz: hw }, Mat.Wood, (t, pos, quat) => {
      const w = waveAt(t - state.go, R);
      if (!w) {
        pos.set(center.x, center.y - 60, center.z);
        return void quat.identity();
      }
      pos.set(center.x + w.ux * w.d, center.y + hh, center.z + w.uz * w.d);
      quat.setFromAxisAngle(UPV, Math.atan2(-w.uz, w.ux));
    });
    b.world.addKin(kin);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(1.4, hh * 2, hw * 2, 1, 1, 1), new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85 }));
    crest.visible = false;
    b.group.add(crest);
    b.animators.push((t) => {
      const w = waveAt(t - state.go, R);
      crest.visible = !!w;
      if (!w) return;
      crest.position.set(center.x + w.ux * w.d, center.y + hh, center.z + w.uz * w.d);
      crest.rotation.y = Math.atan2(-w.uz, w.ux);
    });
  }
  // the blast: everyone near a bolt as it lands is thrown away from it (each browser its own beans)
  const hitBy = new Map<number, number>();
  const now: Strike[] = [];
  b.world.fields.push({
    min: new THREE.Vector3(center.x - R - 3, center.y - 2, center.z - R - 3),
    max: new THREE.Vector3(center.x + R + 3, center.y + 4, center.z + R + 3),
    act: (m, t) => {
      const x = t - state.go;
      if (x < 0) return;
      between(x - 0.12, x, now);
      for (const s of now) {
        const dx = m.pos.x - center.x - s.x, dz = m.pos.z - center.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > s.r + 0.3) continue;
        const key = m.id * 100000 + Math.round(s.t * 100);
        if (hitBy.get(m.id) === key) continue;
        hitBy.set(m.id, key);
        const ux = d > 0.2 ? dx / d : Math.cos(s.t * 13), uz = d > 0.2 ? dz / d : Math.sin(s.t * 13);
        const k = 1 - Math.min(1, d / (s.r + 0.3));
        const v = (s.r > 3 ? 14 : 11) + 5 * k;
        m.vel.x = ux * v;
        m.vel.z = uz * v;
        m.vel.y = 7 + 3 * k;
        m.groundT = 1;
        if (m.mode !== Mode.Tumble) m.knock(1.4);
        else m.tumbleT = Math.max(m.tumbleT, 1.4);
      }
    },
  });
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), R + 4, 13);
  b.finish();
  const arena: StormArena = { center, R, between: (t0, t1, out) => between(t0, t1, out), wave: (x) => waveAt(x, R) };
  return {
    id: 'stormdeck',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 6,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const ring = k < 7 ? 4.5 : k < 15 ? 8.5 : 12;
        const inRing = k < 7 ? 7 : k < 15 ? 8 : Math.max(1, n - 15);
        const kk = k < 7 ? k : k < 15 ? k - 7 : k - 15;
        const a = (kk / inRing) * Math.PI * 2 + ring;
        const p = new THREE.Vector3(center.x + Math.cos(a) * ring, center.y + 0.55, center.z + Math.sin(a) * ring);
        out.push({ pos: p, yaw: Math.atan2(center.x - p.x, center.z - p.z) });
      }
      return out;
    },
    plate: { center, radius: R, bars: [] },
    storm: arena,
    intro: [],
  };
}
