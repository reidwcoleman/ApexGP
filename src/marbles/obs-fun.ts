import * as THREE from 'three';
import { Path, type CourseBuilder } from './builder.ts';
import { frameQuat } from './obstacles.ts';
import { GRAVITY, Mode, type Marble } from './physics.ts';
import { glowMat } from './obs-world.ts';
import { makeCrown } from './course-kit.ts';

/**
 * The big moments any race can have: a spring strip that throws the whole field across a chasm, a
 * boost strip that sends you off at a sprint, a slick slide, and the castle gate at the top of the
 * final. All of it is fields on the course, so every browser does its own beans and nothing goes
 * over the network.
 */

/** chevrons pointing up the texture (forward along the strip) */
function chevrons(a: string, bg: string, n = 3) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = a;
  const h = 256 / n;
  for (let k = 0; k < n; k++) {
    const y = k * h;
    x.beginPath();
    x.moveTo(128, y + h * 0.1);
    x.lineTo(236, y + h * 0.62);
    x.lineTo(236, y + h * 0.98);
    x.lineTo(128, y + h * 0.46);
    x.lineTo(20, y + h * 0.98);
    x.lineTo(20, y + h * 0.62);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** a flat strip across the course at s0..s1 (`up` metres off the floor), and how to tell a bean is on it */
function strip(b: CourseBuilder, path: Path, s0: number, s1: number, w: number, tex: THREE.Texture, glow: number) {
  const s = (s0 + s1) / 2, i = path.index(s), len = s1 - s0;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).rotateY(Math.PI), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.position.copy(path.at(s, 0, 0.05));
  m.quaternion.copy(frameQuat(path, s));
  m.receiveShadow = true;
  b.group.add(m);
  const P = path.P[i].clone(), T = path.T[i].clone(), Rt = path.Rt[i].clone();
  const r = Math.hypot(w / 2, len / 2) + 1;
  return {
    m,
    T,
    min: new THREE.Vector3(P.x - r, P.y - 2, P.z - r),
    max: new THREE.Vector3(P.x + r, P.y + 2.6, P.z + r),
    inside: (p: THREE.Vector3) => {
      const dx = p.x - P.x, dz = p.z - P.z;
      return Math.abs(dx * T.x + dz * T.z) < len / 2 + 0.2 && Math.abs(dx * Rt.x + dz * Rt.z) < w / 2 + 0.4;
    },
    lat: (p: THREE.Vector3) => (p.x - P.x) * Rt.x + (p.z - P.z) * Rt.z,
  };
}

/**
 * The whole width of the course throws you to a spot further on, along a clean arc. It has gold
 * hoops down the middle of the flight with stars through them. `grav` is the course's own.
 */
export function springStrip(b: CourseBuilder, path: Path, s0: number, s1: number, w: number, o: { landS: number; T: number; grav?: number; up?: number }) {
  const g = GRAVITY * (o.grav ?? 1);
  const tex = chevrons('#ff4f6a', '#ffd23a');
  tex.repeat.set(3, 1);
  const st = strip(b, path, s0, s1, w, tex, 0.45);
  let hit = -9;
  const mat = st.m.material as THREE.MeshPhysicalMaterial;
  b.animators.push((t) => {
    const q = t - hit;
    mat.emissiveIntensity = 0.45 + 0.2 * Math.sin(t * 6) + (q < 0.35 ? 1.6 * (1 - q / 0.35) : 0);
  });
  b.world.fields.push({
    min: st.min,
    max: st.max,
    inside: st.inside,
    act: (m: Marble, t: number) => {
      if (m.vel.y > 3) return;
      const to = path.at(o.landS, st.lat(m.pos) * 0.65, 0.55);
      const T = o.T;
      m.vel.set((to.x - m.pos.x) / T, (to.y - m.pos.y) / T + 0.5 * g * T, (to.z - m.pos.z) / T);
      m.groundT = 1;
      m.sprung = true;
      if (m.mode === Mode.Dive) m.mode = Mode.Run;
      hit = t;
    },
  });
  // the hoops, and the stars down the arc
  const a = path.at((s0 + s1) / 2, 0, 0.55), e = path.at(o.landS, 0, 0.55);
  const vy = (e.y - a.y) / o.T + 0.5 * g * o.T;
  const at = (k: number) => {
    const t = k * o.T;
    return new THREE.Vector3(a.x + (e.x - a.x) * k, a.y + vy * t - 0.5 * g * t * t, a.z + (e.z - a.z) * k);
  };
  for (const k of [0.3, 0.5, 0.7]) {
    const p = at(k), n = at(k + 0.02).sub(p).normalize();
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.13, 10, 44), glowMat(0xffc860, 1.8));
    hoop.position.copy(p);
    hoop.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    b.group.add(hoop);
  }
  for (let k = 0.12; k < 0.92; k += 0.066) b.starSpots.push(at(k));
}

/** a strip of running chevrons: over it you go off at a sprint */
export function boostStrip(b: CourseBuilder, path: Path, s: number, w: number, len = 5) {
  const tex = chevrons('#b8fff0', '#17b89a', 2);
  tex.repeat.set(Math.max(1, Math.round(w / 3)), 1);
  const st = strip(b, path, s, s + len, w, tex, 0.7);
  b.animators.push((t) => {
    tex.offset.y = 1 - ((t * 1.4) % 1);
  });
  b.world.fields.push({
    min: st.min,
    max: st.max,
    inside: st.inside,
    act: (m: Marble, t: number) => {
      if (m.mode === Mode.Tumble) return;
      if (m.zoomT < t + 0.8) m.boosted = true;
      m.zoomT = Math.max(m.zoomT, t + 1.6);
    },
  });
}

/** a slick stretch: nothing under your feet but speed */
export function slickField(b: CourseBuilder, path: Path, s0: number, s1: number, o: { grip: number; run: number }) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let s = s0; s <= s1; s += 2) {
    const p = path.P[path.index(s)];
    min.min(p);
    max.max(p);
  }
  min.addScalar(-9);
  max.addScalar(9);
  b.world.fields.push({ min, max, grip: o.grip, run: o.run });
}

/** the castle gate at the top of the final: two towers, a gold portcullis arch and the crown over the line */
export function castleGate(b: CourseBuilder, path: Path, s: number, w: number) {
  const q = frameQuat(path, s);
  const stone = new THREE.MeshStandardMaterial({ color: 0xf2e6d2, roughness: 0.75 });
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.3, metalness: 0.5, emissive: 0x8a5200, emissiveIntensity: 0.5 });
  const roofs = [0x8a3fe0, 0xd83a5a];
  [-1, 1].forEach((side, k) => {
    const p = path.at(s, side * (w / 2 + 2.6), -2);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 15, 24).translate(p.x, p.y + 7.5, p.z), stone);
    body.castShadow = true;
    b.group.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 6.5, 24).translate(p.x, p.y + 18.4, p.z), new THREE.MeshPhysicalMaterial({ color: roofs[k], roughness: 0.35, clearcoat: 0.7 }));
    roof.castShadow = true;
    b.group.add(roof);
    b.group.add(new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.16, 8, 36).rotateX(Math.PI / 2).translate(p.x, p.y + 15.1, p.z), gold));
    for (const y of [6, 10.5]) {
      const win = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 4, 10), glowMat(0xffc860, 2.2));
      win.position.copy(p).add(new THREE.Vector3(0, y, 0)).addScaledVector(path.T[path.index(s)], -2.3);
      b.group.add(win);
    }
  });
  // the arch over the way
  const c = path.at(s, 0, 10.6);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 3.4, 1.5, 1.4), stone);
  beam.position.copy(c);
  beam.quaternion.copy(q);
  beam.castShadow = true;
  b.group.add(beam);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 3.8, 0.22, 1.6), gold);
  trim.position.copy(c).add(new THREE.Vector3(0, -0.76, 0));
  trim.quaternion.copy(q);
  b.group.add(trim);
  // the great crown over the line, with hoops turning round it
  const big = makeCrown();
  big.scale.setScalar(2.3);
  big.position.copy(path.at(s, 0, 14.2));
  big.traverse((o) => (o.castShadow = false));
  b.group.add(big);
  const y0 = big.position.y;
  const hoops = [0, 1].map((k) => {
    const h = new THREE.Mesh(new THREE.TorusGeometry(3.6 + k * 0.9, 0.08, 8, 72), glowMat(0xffc860, 1.6));
    h.position.copy(big.position);
    b.group.add(h);
    return h;
  });
  b.animators.push((t) => {
    big.rotation.y = t * 0.5;
    big.position.y = y0 + Math.sin(t * 0.9) * 0.35;
    hoops.forEach((h, k) => {
      h.position.y = big.position.y + 0.6;
      h.rotation.set(t * (0.3 + k * 0.2), t * (0.2 - k * 0.14), k);
    });
  });
}
