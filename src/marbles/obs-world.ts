import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, cylAttr, roundBox } from './builder.ts';
import { Kin, Mat, Mode, type Field, type Marble } from './physics.ts';
import { Pattern, woodAttr } from './shaders.ts';
import { Parts, band, bolt, dome, frameAt, mat, plank, rod, rotX, rotZ } from './obs-kit.ts';

/**
 * The worlds' own machines: each world has something no other course has. Ice you slide on
 * (arctic), fans that blow you sideways (beach, blossom), laser gates that rise, fall and rock
 * (neon), ghost platforms that fade in and out over a drop (spooky), lava geysers (volcano),
 * quicksand (desert), river rapids (jungle), cannons firing across the deck (royal), pistons
 * slamming down from gantries (clockwork), jelly that bounces you (candy, sunset) and islands in
 * low gravity (space). Everything that moves is a pure function of time, so every browser sees
 * the same thing and the bots can look ahead.
 */

const UPV = new THREE.Vector3(0, 1, 0);
const sm = (x: number) => x * x * (3 - 2 * x);
const cyc = (t: number, P: number) => ((t % P) + P) % P;
type AiKin = Kin & { aiRole?: 'ride' | 'avoid' | 'ignore' };

/** a field over a straight stretch of the course s0..s1 (and `pad` past its edges) */
export function zoneField(path: Path, s0: number, s1: number, f: Omit<Field, 'min' | 'max'>, pad = 0.6, hi = 9): Field {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const q = new THREE.Vector3();
  for (let s = s0; s <= s1 + 0.01; s += 1) {
    const hw = path.sec[path.index(s)].w / 2 + pad;
    for (const l of [-hw, hw]) for (const u of [-3, hi]) min.min(path.at(s, l, u, q)), max.max(q);
  }
  const mid = (s0 + s1) / 2;
  const im = path.index(mid);
  const Pm = path.P[im].clone();
  const Th = new THREE.Vector3(path.T[im].x, 0, path.T[im].z);
  const hl = Th.length() || 1;
  Th.divideScalar(hl);
  const Rh = new THREE.Vector3(path.Rt[im].x, 0, path.Rt[im].z).normalize();
  const inside = (p: THREE.Vector3, t: number) => {
    const dx = p.x - Pm.x, dz = p.z - Pm.z;
    const s = mid + (dx * Th.x + dz * Th.z) / hl;
    if (s < s0 || s > s1) return false;
    const i = path.index(s);
    if (Math.abs(dx * Rh.x + dz * Rh.z) > path.sec[i].w / 2 + pad) return false;
    const h = p.y - path.P[i].y;
    if (h < -3 || h > hi) return false;
    return f.inside ? f.inside(p, t) : true;
  };
  return { ...f, min, max, inside };
}

/** a ribbon lying on the floor s0..s1, `hw` each side, `up` above it (uv: lat, s) */
export function ribbon(path: Path, s0: number, s1: number, hw: number | ((s: number) => number), up = 0.03, step = 0.5, nl = 8) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const q = new THREE.Vector3();
  const ns = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= ns; i++) {
    const s = s0 + ((s1 - s0) * i) / ns;
    const w = typeof hw === 'number' ? hw : hw(s);
    for (let j = 0; j <= nl; j++) {
      const l = -w + (2 * w * j) / nl;
      path.at(s, l, up, q);
      pos.push(q.x, q.y, q.z);
      uv.push(l, s);
    }
  }
  for (let i = 0; i < ns; i++)
    for (let j = 0; j < nl; j++) {
      const a = i * (nl + 1) + j, c = a + nl + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (wound to face up: flip if the normals came out down)
  const n = g.getAttribute('normal');
  if (n.count && n.getY(0) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** a self-lit colour that blooms (k over 1) */
export function glowMat(color: number, k = 2.4, o: THREE.MeshBasicMaterialParameters = {}) {
  const m = new THREE.MeshBasicMaterial({ ...o });
  m.color.set(color).multiplyScalar(k);
  return m;
}

/** a canvas texture of streaks (foam on water, wind, swirls) */
function streakTex(kind: 'foam' | 'ice' | 'sand' | 'jelly', base: string, line: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  let sd = kind.length * 977;
  const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  x.strokeStyle = line;
  x.lineCap = 'round';
  if (kind === 'foam') {
    for (let i = 0; i < 60; i++) {
      const y = r() * 256, x0 = r() * 256, l = 20 + r() * 70;
      x.lineWidth = 2 + r() * 5;
      x.globalAlpha = 0.35 + r() * 0.5;
      x.beginPath();
      x.moveTo(x0, y);
      x.bezierCurveTo(x0 + l * 0.3, y - 6, x0 + l * 0.6, y + 6, x0 + l, y);
      x.stroke();
    }
  } else if (kind === 'ice') {
    for (let i = 0; i < 30; i++) {
      x.lineWidth = 0.6 + r() * 1.6;
      x.globalAlpha = 0.25 + r() * 0.5;
      let px = r() * 256, py = r() * 256;
      x.beginPath();
      x.moveTo(px, py);
      for (let k = 0; k < 4; k++) x.lineTo((px += (r() - 0.5) * 60), (py += (r() - 0.5) * 60));
      x.stroke();
    }
  } else if (kind === 'sand') {
    for (let k = 0; k < 9; k++) {
      x.lineWidth = 4 + r() * 4;
      x.globalAlpha = 0.35;
      x.beginPath();
      x.arc(128, 128, 14 + k * 13, r() * 6, r() * 6 + 4.2);
      x.stroke();
    }
  } else {
    for (let i = 0; i < 40; i++) {
      x.globalAlpha = 0.25 + r() * 0.3;
      x.fillStyle = line;
      x.beginPath();
      x.arc(r() * 256, r() * 256, 3 + r() * 9, 0, Math.PI * 2);
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------------------------- ice
/** an ice rink laid over the deck: your feet slide (grip down to `grip`), dives go on and on */
export function iceSheet(b: CourseBuilder, path: Path, s0: number, s1: number, o: { grip?: number; field?: boolean } = {}) {
  if (o.field !== false) b.world.fields.push(zoneField(path, s0, s1, { grip: o.grip ?? 0.13 }, 1.2));
  const tex = streakTex('ice', '#cfeeff', '#ffffff');
  tex.repeat.set(0.12, 0.12);
  const m = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, map: tex, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.82, ior: 1.31, specularIntensity: 1 });
  const g = ribbon(path, s0, s1, (s) => path.sec[path.index(s)].w / 2 - 0.25, 0.035);
  // (uv in metres; the texture repeats every 8 m)
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  b.group.add(mesh);
  // frosty drifts along the edges
  const p = new Parts();
  const snow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  for (let s = s0 + 1.5; s < s1 - 1; s += 2.2 + ((s * 7) % 1.3)) {
    for (const side of [-1, 1]) {
      const hw = path.sec[path.index(s)].w / 2;
      const r = 0.35 + ((s * 13 + side) % 0.3);
      const at = path.at(s, side * (hw - 0.3), -0.05);
      p.add(snow, new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.6, 0.6, 1.2), mat(at.x, at.y, at.z));
    }
  }
  p.toBatch(b, new THREE.Matrix4());
}

/** an ice crystal post (a peg made of ice) */
export function crystal(b: CourseBuilder, path: Path, s: number, lat: number, h = 1.8) {
  const f = frameAt(path, s, lat);
  const kin = new Kin({ type: 'cyl', r: 0.42, hh: h / 2 }, Mat.Metal);
  kin.pos.copy(f.pos).addScaledVector(f.U, h / 2);
  kin.quat.copy(f.q);
  const p = new Parts();
  const m = new THREE.MeshPhysicalMaterial({ color: 0xa8e4ff, roughness: 0.08, transmission: 0.35, thickness: 0.6, clearcoat: 1, emissive: 0x2a6a9a, emissiveIntensity: 0.25, flatShading: true });
  p.add(m, new THREE.CylinderGeometry(0.28, 0.48, h, 6).translate(0, 0, 0));
  p.add(m, new THREE.ConeGeometry(0.28, 0.6, 6).translate(0, h / 2 + 0.3, 0));
  for (const a of [0.9, 2.6, 4.4]) p.add(m, new THREE.ConeGeometry(0.16, 0.9, 5).rotateZ(0.6).rotateY(a).translate(Math.cos(a) * 0.4, -h / 2 + 0.4, -Math.sin(a) * 0.4));
  b.fixed(kin, p);
}

// ------------------------------------------------------------------------------------- gusts
/**
 * Big fans standing off one side of the deck, blowing across it in gusts (a beat on, a beat off,
 * spinning up first): run when they rest, lean in when they blow. `petals` for blossom.
 */
export function fanGust(b: CourseBuilder, path: Path, s: number, side: number, o: { period?: number; phase?: number; force?: number; reach?: number; color?: number; petals?: boolean } = {}) {
  const P = o.period ?? 4.6, ON = P * 0.52, ph = o.phase ?? 0;
  const F = o.force ?? 26;
  const reach = o.reach ?? 3.6;
  const f = frameAt(path, s);
  const hw = f.sec.w / 2;
  /** 0..1, how hard it blows */
  const blow = (t: number) => {
    const u = cyc(t + ph, P);
    if (u > ON + 0.35) return 0;
    if (u < 0.45) return sm(u / 0.45);
    if (u > ON) return 1 - sm((u - ON) / 0.35);
    return 1;
  };
  // (blows toward -side: from the fan across the deck and off the far edge)
  const dir = f.R.clone().multiplyScalar(-side).setY(0).normalize();
  b.world.fields.push(
    zoneField(path, s - reach, s + reach, {
      act: (m: Marble, t: number, dt: number) => {
        const k = blow(t);
        if (k <= 0) return;
        // (a tumbler or a bean in the air is blown further)
        const a = F * k * (m.mode === Mode.Tumble ? 1.25 : m.grounded ? 1 : 1.15);
        m.vel.x += dir.x * a * dt;
        m.vel.z += dir.z * a * dt;
      },
    }, 0.4, 5),
  );
  // the fan: a round cowl on a stand off the edge, blades turning, a guard over its face
  const col = o.color ?? PAINT.teal;
  const R = 2.5;
  const at = path.at(s, side * (hw + 1.9), 0);
  const stand = new Parts();
  const body = b.paint({ a: col, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 });
  const cowl = cylAttr(new THREE.CylinderGeometry(R + 0.25, R + 0.25, 1.4, 40, 1, true));
  const fq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.R.clone().negate(), f.U, f.T));
  // (in the fan's frame: x along the track's left, y up, z along the track; the fan's axis is x)
  stand.add(body, cowl.rotateZ(Math.PI / 2), mat(0, R + 0.5, 0));
  stand.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), band(R + 0.25, 0.14, 40).rotateY(Math.PI / 2), mat(side * 0.7, R + 0.5, 0));
  stand.add(b.darkWood, roundBox(1.2, R + 0.6, 1.6, 0.1), mat(0, (R + 0.6) / 2 - 0.3, 0));
  stand.add(b.darkWood, roundBox(2.6, 0.3, 3, 0.08), mat(0, -0.35, 0));
  // (a guard: rings and spokes on the side facing the deck)
  for (const r of [0.9, 1.7, 2.5]) stand.add(b.steel, new THREE.TorusGeometry(r, 0.035, 6, 40).rotateY(Math.PI / 2), mat(side * 0.75, R + 0.5, 0));
  for (let k = 0; k < 8; k++) stand.add(b.steel, rod(0.03, R * 2, 6).rotateX((k / 8) * Math.PI), mat(side * 0.75, R + 0.5, 0));
  stand.toBatch(b, new THREE.Matrix4().compose(at, fq, new THREE.Vector3(1, 1, 1)));
  // (and a shelf under it, so it stands on something)
  const shelf = new Parts();
  shelf.add(b.darkWood, roundBox(3.4, 0.5, 4, 0.1), mat(0, -0.75, 0));
  shelf.toBatch(b, new THREE.Matrix4().compose(at, fq, new THREE.Vector3(1, 1, 1)));
  const blades = new THREE.Group();
  const bp = new Parts();
  const bm = b.paint({ a: PAINT.white, b: col, pattern: Pattern.Stripes, scale: 3 });
  for (let k = 0; k < 4; k++) bp.add(bm, roundBox(0.12, R * 0.92, 0.7, 0.05).translate(0, R * 0.48, 0).rotateY(0.35).rotateX((k / 4) * Math.PI * 2));
  bp.add(b.brass, dome(0.45, 0.8, 16).rotateZ((-side * Math.PI) / 2));
  blades.add(bp.group());
  blades.position.copy(at).addScaledVector(f.U, R + 0.5);
  blades.quaternion.copy(fq);
  b.group.add(blades);
  const bladeQ = fq.clone();
  const qx = new THREE.Quaternion();
  b.animators.push((t) => {
    // (spins all the time, hard while it blows: the spin is the integral of the blow, near enough)
    const u = cyc(t + ph, P), n = Math.floor((t + ph) / P);
    const a = t * 3 + 16 * (n * ON + Math.min(u, ON));
    qx.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a * side);
    blades.quaternion.copy(bladeQ).multiply(qx);
  });
  // the wind you can see: streaks (or petals) blown across while it blows
  const N = 26;
  const sg = o.petals ? new THREE.CircleGeometry(0.12, 5).scale(1, 0.6, 1) : new THREE.PlaneGeometry(1.6, 0.05);
  const sm2 = o.petals ? new THREE.MeshBasicMaterial({ color: 0xffb8d8, side: THREE.DoubleSide, transparent: true }) : new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const im = new THREE.InstancedMesh(sg, sm2, N);
  im.frustumCulled = false;
  b.group.add(im);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3();
  const yaw = Math.atan2(dir.x, dir.z) + Math.PI / 2;
  b.animators.push((t) => {
    const k = blow(t);
    for (let i = 0; i < N; i++) {
      const sd = (i * 0.618) % 1, sd2 = (i * 0.377) % 1;
      const u = cyc(t * (0.9 + sd2 * 0.5) + sd * 3, 1.3) / 1.3;
      const lat = side * (hw + 1) - side * u * (2 * hw + 6);
      path.at(s + (sd - 0.5) * 2 * reach, lat, 0.4 + sd2 * 2.6 + Math.sin(t * 3 + i) * 0.2, V);
      Q.setFromEuler(new THREE.Euler(o.petals ? t * 4 + i : 0, yaw, o.petals ? t * 3 : 0));
      const vis = k > 0.15 ? 1 : 0;
      S.set(vis, vis, vis);
      M.compose(V, Q, S);
      im.setMatrixAt(i, M);
    }
    im.instanceMatrix.needsUpdate = true;
    if (!o.petals) sm2.opacity = 0.5 * k;
  });
}

// ------------------------------------------------------------------------------------- lasers
/**
 * A laser gate across the deck between two emitters. 'bob': up and down (hop it low, run under
 * it high, never be there when it comes down); 'rock': tilted and rocking (hop the low end or
 * duck the high one). Touch it and you're zapped over.
 */
export function laserGate(b: CourseBuilder, path: Path, s: number, o: { kind?: 'bob' | 'rock'; period?: number; phase?: number; color?: number } = {}) {
  const f = frameAt(path, s);
  const hw = f.sec.w / 2;
  const P = o.period ?? 3.8, ph = o.phase ?? 0;
  const kind = o.kind ?? 'bob';
  const LO = 0.4, HI = 2.05;
  const height = (t: number) => {
    if (kind === 'rock') return 1.1;
    const u = cyc(t + ph, P) / P;
    if (u < 0.36) return LO;
    if (u < 0.46) return LO + (HI - LO) * sm((u - 0.36) / 0.1);
    if (u < 0.82) return HI;
    return HI - (HI - LO) * sm((u - 0.82) / 0.18);
  };
  const tiltMax = Math.atan(0.85 / hw);
  const roll = (t: number) => (kind === 'rock' ? tiltMax * Math.sin(((t + ph) / P) * Math.PI * 2) : 0);
  const qr = new THREE.Quaternion();
  const kin = new Kin({ type: 'box', hx: hw + 0.3, hy: 0.1, hz: 0.1 }, Mat.Bumper, (t, pos, quat) => {
    pos.copy(f.pos).addScaledVector(f.U, height(t));
    qr.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll(t));
    quat.copy(f.q).multiply(qr);
  });
  const back = f.T.clone().setY(0).normalize();
  kin.onHit = (m) => {
    if (m.puppet || m.mode === Mode.Tumble) return;
    // zapped: a hop back the way you came and over you go
    const along = m.vel.x * back.x + m.vel.z * back.z;
    m.vel.addScaledVector(back, -Math.max(0, along) - 4.5);
    m.vel.y = Math.max(m.vel.y, 4.5);
    m.knock(1.1);
  };
  const col = o.color ?? 0xff3aa0;
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2 * hw + 0.6, 10).rotateZ(Math.PI / 2), glowMat(col, 3.2));
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2 * hw + 0.6, 12, 1, true).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(beam, halo);
  b.obstacle(kin, g);
  // the emitters: posts each side with a glowing slot the beam runs in
  const p = new Parts();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1430, roughness: 0.35, metalness: 0.6 });
  for (const e of [-1, 1]) {
    p.add(dark, roundBox(0.5, 2.9, 0.6, 0.08), mat(e * (hw + 0.55), 1.45, 0));
    p.add(glowMat(col, 2.2), new THREE.BoxGeometry(0.08, 2.4, 0.16), mat(e * (hw + 0.29), 1.35, 0));
    p.add(glowMat(col, 2.6), new THREE.SphereGeometry(0.16, 12, 8), mat(e * (hw + 0.55), 3.0, 0));
  }
  p.toBatch(b, f.m);
  // (the beam flickers)
  b.animators.push((t) => {
    halo.material.opacity = 0.16 + 0.08 * Math.sin(t * 31 + s);
  });
}

// ------------------------------------------------------------------------------------- ghosts
/** how fast the ghost pads' wave runs down the course (m/s): a shade under a bean's run */
const WAVE_V = 8.6;
/**
 * Ghost platforms over a drop, three lanes of them: each fades in, holds, flickers and is gone,
 * on its own beat, so there's always a way over if you watch. Solid while it shows.
 */
export function ghostPads(b: CourseBuilder, path: Path, s0: number, s1: number, o: { lanes?: number[]; pitch?: number; r?: number; period?: number; phase?: number; color?: number } = {}) {
  const lanes = o.lanes ?? [-3, 0, 3];
  const pitch = o.pitch ?? 2.75, R = o.r ?? 1.38;
  const P = o.period ?? 4.2, ON = P * 0.64, ph = o.phase ?? 0;
  const col = o.color ?? 0x8affb0;
  const rows = Math.max(1, Math.floor((s1 - s0 - 0.4) / pitch));
  const first = s0 + (s1 - s0 - (rows - 1) * pitch) / 2;
  const geo = new THREE.CylinderGeometry(R, R * 0.92, 0.5, 32);
  for (let r = 0; r < rows; r++) {
    lanes.forEach((lat, l) => {
      const s = first + r * pitch;
      // (each row comes on after the one before, at a runner's pace: ride the wave across)
      const off = ph + (l * P) / lanes.length - (r * pitch) / WAVE_V;
      const on = (t: number) => cyc(t + off, P) < ON;
      const f = frameAt(path, s, lat, -0.25);
      const kin = new Kin({ type: 'cyl', r: R, hh: 0.25 }, Mat.Paint, (t, pos, quat) => {
        pos.copy(f.pos);
        if (!on(t)) pos.y -= 60;
        quat.copy(f.q);
      }) as AiKin;
      kin.aiRole = 'ride';
      b.world.addKin(kin);
      const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.4, transparent: true, opacity: 0.85 });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(f.pos);
      mesh.quaternion.copy(f.q);
      mesh.receiveShadow = true;
      b.group.add(mesh);
      // (a little face on each: two eyes)
      const eyes = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), new THREE.MeshBasicMaterial({ color: 0x1a2a20, transparent: true }));
      const eyes2 = eyes.clone();
      for (const [e, x] of [[eyes, -0.35], [eyes2, 0.35]] as const) {
        e.position.copy(path.at(s, lat + x, 0.02));
        e.quaternion.copy(f.q).multiply(rotX(-Math.PI / 2));
        b.group.add(e);
      }
      b.animators.push((t) => {
        const u = cyc(t + off, P);
        let a: number;
        if (u < 0.3) a = u / 0.3;
        else if (u < ON - 0.75) a = 1;
        else if (u < ON) a = Math.sin(u * 40) > 0 ? 0.9 : 0.25;
        else a = 0.07;
        m.opacity = 0.12 + 0.8 * a;
        m.emissiveIntensity = 0.25 + 0.6 * a;
        mesh.castShadow = a > 0.5;
        mesh.scale.y = 0.3 + 0.7 * Math.min(1, a * 1.5);
        (eyes.material as THREE.MeshBasicMaterial).opacity = a;
      });
    });
  }
  // a mist down in the drop
  const mist = new THREE.Mesh(ribbon(path, s0, s1, path.sec[path.index((s0 + s1) / 2)].w / 2 + 2, -3.5, 1, 4), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false }));
  b.group.add(mist);
}

// ------------------------------------------------------------------------------------- geysers
/** lava vents in the deck: a bubble, a rumble, then a blast that throws you high (and maybe off) */
export function geysers(b: CourseBuilder, path: Path, s0: number, s1: number, o: { period?: number; phase?: number; spots?: [number, number][] } = {}) {
  const P = o.period ?? 3.4;
  const WARN = 0.9, BLAST = 0.75, R = 1.35;
  const spots = o.spots ?? [];
  const rock = new THREE.MeshStandardMaterial({ color: 0x5a3426, roughness: 0.85, flatShading: true, emissive: 0xff4a10, emissiveIntensity: 0.18 });
  spots.forEach(([ds, lat], k) => {
    const core = glowMat(0xff6a18, 2.2);
    const s = s0 + ds;
    const off = (o.phase ?? 0) + k * 0.83;
    const u = (t: number) => cyc(t + off, P);
    const blasting = (t: number) => {
      const x = u(t);
      return x >= WARN && x < WARN + BLAST;
    };
    const f = frameAt(path, s, lat);
    const c = f.pos.clone();
    b.world.fields.push({
      min: c.clone().add(new THREE.Vector3(-R, -1, -R)),
      max: c.clone().add(new THREE.Vector3(R, 7, R)),
      inside: (p) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < R * R,
      act: (m, t) => {
        if (!blasting(t)) return;
        const dx = m.pos.x - c.x, dz = m.pos.z - c.z;
        const d = Math.hypot(dx, dz) || 1;
        m.vel.y = Math.max(m.vel.y, 15.5);
        m.vel.x += (dx / d) * 0.6;
        m.vel.z += (dz / d) * 0.6;
        m.groundT = 1;
        if (m.mode !== Mode.Tumble) m.knock(1.3);
      },
    });
    // (the bots keep off a vent about to go)
    b.ghost({ type: 'cyl', r: R, hh: 1.4 }, (t, pos, quat) => {
      const x = u(t);
      pos.copy(c).addScaledVector(f.U, 1.2);
      if (x < WARN - 0.6 || x > WARN + BLAST) pos.y -= 80;
      quat.copy(f.q);
    });
    // the vent: a crusty rim, the glowing throat, a column of fire when it goes
    const p = new Parts();
    p.add(rock, new THREE.TorusGeometry(R * 0.85, 0.24, 6, 12).rotateX(Math.PI / 2).scale(1, 0.6, 1), mat(0, 0.08, 0));
    // (cracks glowing round it)
    for (let q = 0; q < 5; q++) p.add(core, new THREE.PlaneGeometry(0.12, 0.9).rotateX(-Math.PI / 2).translate(0, 0, R * 0.85 + 0.45).rotateY((q / 5) * Math.PI * 2 + k), mat(0, 0.03, 0));
    p.toBatch(b, f.m);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(R * 0.82, 20).rotateX(-Math.PI / 2), core);
    throat.position.copy(path.at(s, lat, 0.07));
    b.group.add(throat);
    const colM = glowMat(0xffa030, 2.6, { transparent: true, opacity: 0.85, depthWrite: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, R * 0.8, 1, 16, 1, true).translate(0, 0.5, 0), colM);
    col.position.copy(f.pos);
    b.group.add(col);
    const bub = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), glowMat(0xffc040, 2.4));
    bub.position.copy(f.pos);
    b.group.add(bub);
    b.animators.push((t) => {
      const x = u(t);
      const warn = x < WARN ? THREE.MathUtils.smoothstep(x, WARN - 0.6, WARN) : 0;
      const blast = x >= WARN && x < WARN + BLAST ? Math.sin(((x - WARN) / BLAST) * Math.PI) : 0;
      core.color.setRGB(1, 0.42, 0.1).multiplyScalar(1.4 + 2.4 * Math.max(warn, blast));
      col.visible = blast > 0.01;
      col.scale.set(0.6 + 0.6 * blast, 0.2 + 7.5 * blast, 0.6 + 0.6 * blast);
      bub.visible = warn > 0.05;
      bub.position.copy(f.pos).addScaledVector(f.U, 0.1 + warn * 0.3 + Math.abs(Math.sin(t * 17)) * 0.25 * warn);
      bub.scale.setScalar(0.5 + warn);
    });
  });
}

// ------------------------------------------------------------------------------------- quicksand
/** sinking sand: patches that bog you down (slow feet, a feeble hop) */
export function quicksand(b: CourseBuilder, path: Path, s0: number, pits: [number, number, number][]) {
  const tex = streakTex('sand', '#c89a5a', '#8a6030');
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  for (const [ds, lat, r] of pits) {
    const s = s0 + ds;
    const f = frameAt(path, s, lat);
    const c = f.pos.clone();
    b.world.fields.push({
      min: c.clone().add(new THREE.Vector3(-r, -1, -r)),
      max: c.clone().add(new THREE.Vector3(r, 2.2, r)),
      inside: (p) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < r * r,
      run: 0.36,
      jump: 0.62,
      grip: 0.6,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), m);
    disc.position.copy(path.at(s, lat, 0.025));
    disc.receiveShadow = true;
    b.group.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 6, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0b878, roughness: 1 }));
    rim.position.copy(disc.position);
    b.group.add(rim);
    const w = 0.4 + (ds % 0.3);
    b.animators.push((t) => (disc.rotation.y = t * w));
  }
}

// ------------------------------------------------------------------------------------- rapids
/** a river running across the deck toward the open side: wade it or be washed off */
export function rapids(b: CourseBuilder, path: Path, s: number, width: number, o: { force?: number; dir?: number } = {}) {
  const F = o.force ?? 30, side = o.dir ?? 1;
  const f = frameAt(path, s);
  const dir = f.R.clone().multiplyScalar(side).setY(0).normalize();
  b.world.fields.push(
    zoneField(path, s - width / 2, s + width / 2, {
      act: (m, _t, dt) => {
        if (m.pos.y > path.P[path.index(s)].y + 1.6) return;
        const k = m.mode === Mode.Tumble ? 1.3 : 1;
        m.vel.x += dir.x * F * k * dt;
        m.vel.z += dir.z * F * k * dt;
      },
      run: 0.8,
    }, 0.3, 2),
  );
  const tex = streakTex('foam', '#1a8ab0', '#e8fbff');
  tex.repeat.set(0.18, 0.25);
  const m = new THREE.MeshPhysicalMaterial({ color: 0x38b8f0, map: tex, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.94 });
  const g = ribbon(path, s - width / 2, s + width / 2, f.sec.w / 2 + 2.5, 0.06, 0.5, 16);
  const mesh = new THREE.Mesh(g, m);
  b.group.add(mesh);
  b.animators.push((t) => (tex.offset.x = -t * 0.9 * side));
  // its banks: low stones each side of the stream
  const p = new Parts();
  const st = new THREE.MeshStandardMaterial({ color: 0x8a8a7a, roughness: 0.9, flatShading: true });
  for (const e of [-1, 1])
    for (let l = -f.sec.w / 2 + 0.6; l < f.sec.w / 2; l += 1.1 + ((l * 7 + e) % 0.5)) {
      const at = path.at(s + e * (width / 2 + 0.15), l, 0);
      p.add(st, new THREE.DodecahedronGeometry(0.22 + ((l * 13) % 0.12), 0).scale(1.3, 0.6, 1), mat(at.x, at.y, at.z));
    }
  p.toBatch(b, new THREE.Matrix4());
}

// ------------------------------------------------------------------------------------- cannons
/** a cannon on a ledge off one side, firing a ball across the deck every so often */
export function cannon(b: CourseBuilder, path: Path, s: number, side: number, o: { period?: number; phase?: number; speed?: number; color?: number } = {}) {
  const f = frameAt(path, s);
  const hw = f.sec.w / 2;
  const P = o.period ?? 3.2, ph = o.phase ?? 0, v = o.speed ?? 13;
  const R = 0.58;
  const start = side * (hw + 1.0);
  const fly = (2 * hw + 2.2) / v;
  const fwd = f.R.clone().multiplyScalar(-side).setY(0).normalize();
  const kin = new Kin({ type: 'sph', r: R }, Mat.Metal, (t, pos, quat) => {
    const u = cyc(t + ph, P);
    if (u > fly + 0.6) {
      pos.copy(f.pos).y -= 80;
    } else {
      const lat = start - side * v * u;
      pos.copy(path.at(s, lat, R + 0.02));
      const over = Math.abs(lat) - hw;
      if (over > 0 && u > 0.3) pos.y -= 18 * (over / v) * (over / v) * 6;
    }
    quat.setFromAxisAngle(f.T, -side * u * v / R);
  });
  kin.onHit = (m) => {
    if (m.puppet) return;
    m.vel.addScaledVector(fwd, 9);
    m.vel.y = Math.max(m.vel.y, 5);
    if (m.mode !== Mode.Tumble) m.knock(1.2);
  };
  const ball = new Parts();
  const iron = new THREE.MeshPhysicalMaterial({ color: 0x2a2a32, metalness: 0.9, roughness: 0.35, clearcoat: 0.5 });
  ball.add(iron, new THREE.SphereGeometry(R, 24, 16));
  ball.add(b.brass, band(R * 0.98, 0.04, 24).rotateX(Math.PI / 2));
  b.obstacle(kin, ball.group());
  // the cannon: a barrel on a red carriage, on a ledge just off the edge
  const col = o.color ?? PAINT.red;
  const p = new Parts();
  const lx = side * (hw + 2.0);
  p.add(b.darkWood, roundBox(3.0, 0.4, 2.6, 0.1), mat(lx, -0.2, 0));
  p.add(b.paint({ a: col, b: PAINT.yellow, pattern: Pattern.Stripes, scale: 2 }), roundBox(1.6, 0.6, 1.4, 0.1), mat(lx, 0.3, 0));
  for (const e of [-0.75, 0.75]) p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), cylAttr(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16)).rotateX(Math.PI / 2), mat(lx, 0.35, e));
  const barrel = new THREE.LatheGeometry([new THREE.Vector2(0.001, -1.3), new THREE.Vector2(0.55, -1.3), new THREE.Vector2(0.62, -1.0), new THREE.Vector2(0.5, 0.4), new THREE.Vector2(0.58, 0.9), new THREE.Vector2(0.62, 1.0), new THREE.Vector2(0.45, 1.0), new THREE.Vector2(0.4, 0.2)], 24);
  p.add(iron, barrel.rotateZ((side * Math.PI) / 2), mat(lx - side * 0.1, 0.9, 0));
  p.add(b.brass, band(0.6, 0.06, 24).rotateZ(Math.PI / 2), mat(lx - side * 0.6, 0.9, 0));
  p.toBatch(b, f.m);
  const solid = new Kin({ type: 'box', hx: 1.5, hy: 1.0, hz: 1.3 }, Mat.Paint);
  solid.pos.copy(path.at(s, lx, 0.6));
  solid.quat.copy(f.q);
  solid.set(0);
  b.world.addKin(solid);
  // (a puff of smoke at the muzzle when it fires)
  const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 1, transparent: true }));
  puff.position.copy(path.at(s, side * (hw + 0.7), 0.95));
  b.group.add(puff);
  b.animators.push((t) => {
    const u = cyc(t + ph, P);
    const k = u < 0.6 ? u / 0.6 : 1;
    puff.visible = u < 0.6;
    puff.scale.setScalar(0.4 + k * 1.6);
    (puff.material as THREE.MeshStandardMaterial).opacity = 0.8 * (1 - k);
  });
}

// ------------------------------------------------------------------------------------- stampers
/** a piston over the deck slamming down on a beat (a gantry over it): under it when it lands is flat */
export function stamper(b: CourseBuilder, path: Path, s: number, lat: number, o: { period?: number; phase?: number; size?: number; color?: number; top?: number } = {}) {
  const P = o.period ?? 2.9, ph = o.phase ?? 0;
  const S = o.size ?? 2.0, TOP = o.top ?? 3.6;
  const f = frameAt(path, s, lat);
  const DOWN = 0.18, HOLD = 0.45, UP = 0.8;
  // the head's bottom above the floor at t
  const lift = (t: number) => {
    const u = cyc(t + ph, P);
    const wait = P - DOWN - HOLD - UP;
    if (u < wait) return TOP;
    if (u < wait + DOWN) {
      const k = (u - wait) / DOWN;
      return TOP * (1 - k * k);
    }
    if (u < wait + DOWN + HOLD) return 0;
    return TOP * sm((u - wait - DOWN - HOLD) / UP);
  };
  const falling = (t: number) => {
    const u = cyc(t + ph, P), wait = P - DOWN - HOLD - UP;
    return u >= wait - 0.05 && u < wait + DOWN + 0.08;
  };
  const kin = new Kin({ type: 'box', hx: S / 2, hy: 0.4, hz: S / 2 }, Mat.Paint, (t, pos, quat) => {
    pos.copy(f.pos).addScaledVector(f.U, lift(t) + 0.4);
    quat.copy(f.q);
  });
  const world = b.world;
  kin.onHit = (m) => {
    if (m.puppet || !falling(world.time)) return;
    // squashed: shot out from under it
    const dx = m.pos.x - kin.pos.x, dz = m.pos.z - kin.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    m.vel.x += (dx / d) * 7;
    m.vel.z += (dz / d) * 7;
    if (m.mode !== Mode.Tumble) m.knock(1.4);
  };
  const col = o.color ?? PAINT.orange;
  const p = new Parts();
  p.add(b.paint({ a: col, b: PAINT.black, pattern: Pattern.Chevron, scale: 1.2 }), woodAttr(roundBox(S, 0.8, S, 0.14), 'x', s));
  p.add(b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 2.4 }), plank(S + 0.06, 0.14, S + 0.06, 0.04, 'x'), mat(0, -0.33, 0));
  p.add(b.steel, rod(0.22, 6, 16), mat(0, 3.4, 0));
  p.add(b.brass, band(0.3, 0.06, 18), mat(0, 0.45, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bolt(p, b, mat(x * (S / 2 - 0.25), 0.41, z * (S / 2 - 0.25)), 0.07);
  b.obstacle(kin, p.group());
  // (the bots: never under it while it's up and due)
  b.ghost({ type: 'box', hx: S / 2 + 0.2, hy: 0.9, hz: S / 2 + 0.2 }, (t, pos, quat) => {
    pos.copy(f.pos).addScaledVector(f.U, 0.9);
    const u = cyc(t + ph, P), wait = P - DOWN - HOLD - UP;
    if (u < wait - 0.55 || u > wait + DOWN + HOLD) pos.y -= 80;
    quat.copy(f.q);
  });
  // its shadow mark on the floor
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }));
  mark.position.copy(f.pos).addScaledVector(f.U, 0.03);
  mark.quaternion.copy(f.q);
  b.group.add(mark);
  b.animators.push((t) => {
    const h = lift(t);
    (mark.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.35 * (1 - h / TOP);
  });
}

// ------------------------------------------------------------------------------------- jelly
/** jelly laid over the deck: it bounces you (land and you're back up), and you jump half again as high */
export function jellyDeck(b: CourseBuilder, path: Path, s0: number, s1: number, o: { color?: number } = {}) {
  b.world.fields.push(
    zoneField(path, s0, s1, {
      jump: 1.45,
      act: (m) => {
        // (a hard landing bounces back up)
        // (a real drop, not the bounce's own landing: it dies away after one)
        if (m.landed > 7 && m.mode !== Mode.Tumble && m.vel.y < 2) {
          m.vel.y = Math.min(10, m.landed * 0.55);
          m.groundT = 1;
        }
      },
    }, 0.4, 4),
  );
  const col = o.color ?? 0xff6ab0;
  const tex = streakTex('jelly', '#ffffff', '#ffffff');
  tex.repeat.set(0.25, 0.25);
  const m = new THREE.MeshPhysicalMaterial({ color: col, map: tex, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, transmission: 0.25, thickness: 0.5, transparent: true, opacity: 0.9, sheen: 0.6, sheenColor: new THREE.Color(0xffffff) });
  const g = ribbon(path, s0, s1, (s) => path.sec[path.index(s)].w / 2 - 0.2, 0.08, 0.5, 10);
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  b.group.add(mesh);
  const base = mesh.position.clone();
  b.animators.push((t) => {
    mesh.position.copy(base);
    mesh.position.y = base.y + Math.sin(t * 7.5 + s0) * 0.025;
  });
}

/** a jelly cube to bounce off */
export function jellyCube(b: CourseBuilder, path: Path, s: number, lat: number, o: { color?: number; size?: number; phase?: number } = {}) {
  const S = o.size ?? 1.5;
  const f = frameAt(path, s, lat);
  const ph = o.phase ?? s;
  const kin = new Kin({ type: 'box', hx: S / 2, hy: S / 2, hz: S / 2 }, Mat.Bumper, (t, pos, quat) => {
    pos.copy(f.pos).addScaledVector(f.U, S / 2 + 0.05);
    quat.copy(f.q).multiply(new THREE.Quaternion().setFromAxisAngle(UPV, Math.sin(t * 0.8 + ph) * 0.5));
  });
  kin.kick = 5;
  const m = new THREE.MeshPhysicalMaterial({ color: o.color ?? 0x5ad8ff, roughness: 0.1, clearcoat: 1, transmission: 0.35, thickness: 1, transparent: true, opacity: 0.92 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(roundBox(S, S, S, 0.3), m));
  const sq = new THREE.Group();
  sq.add(g);
  b.obstacle(kin, sq);
  sq.userData.squash = g;
}

// ------------------------------------------------------------------------------------- moon
/** low gravity over a stretch: floaty, huge jumps (and a glow on the floor to say so) */
export function moonField(b: CourseBuilder, path: Path, s0: number, s1: number, g = 0.45) {
  b.world.fields.push(zoneField(path, s0, s1, { g }, 3, 14));
  // sparkles drifting up through it
  const N = 60;
  const im = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.08, 0), glowMat(0xb8a8ff, 3), N);
  im.frustumCulled = false;
  b.group.add(im);
  const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1);
  b.animators.push((t) => {
    for (let i = 0; i < N; i++) {
      const a = (i * 0.618) % 1, c = (i * 0.383) % 1;
      const u = cyc(t * 0.15 + a, 1);
      path.at(s0 + a * (s1 - s0), (c - 0.5) * 16, -4 + u * 12, V);
      M.compose(V, Q, S1);
      im.setMatrixAt(i, M);
    }
    im.instanceMatrix.needsUpdate = true;
  });
}

/** a floating rock with a glowing seam (scenery over a moon gap) */
export function floatRock(b: CourseBuilder, at: THREE.Vector3, r: number, seed: number) {
  const g = new THREE.DodecahedronGeometry(r, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 1 + Math.sin(i * 12.9898 + seed) * 0.12;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6a6078, roughness: 0.9, flatShading: true }));
  mesh.position.copy(at);
  mesh.castShadow = true;
  b.group.add(mesh);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, 0.06, 6, 30).rotateX(Math.PI / 2), glowMat(0xa080ff, 2.6));
  ring.position.copy(at);
  b.group.add(ring);
  b.animators.push((t) => {
    mesh.position.y = at.y + Math.sin(t * 0.7 + seed) * 0.6;
    ring.position.y = mesh.position.y;
    mesh.rotation.y = t * 0.2 + seed;
  });
}

/** a striped ball for rollDown in the world's look: a pumpkin, a snowball, a boulder */
export function ballLook(b: CourseBuilder, R: number, look: 'pumpkin' | 'snow' | 'rock', k: number) {
  const p = new Parts();
  if (look === 'pumpkin') {
    const g = new THREE.SphereGeometry(R, 32, 18);
    const pp = g.getAttribute('position');
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const a = Math.atan2(z, x);
      const f = 1 - 0.07 * Math.abs(Math.sin(a * 5));
      pp.setXYZ(i, x * f, y * 0.86, z * f);
    }
    g.computeVertexNormals();
    p.add(new THREE.MeshStandardMaterial({ color: k % 2 ? 0xff8a1a : 0xf07010, roughness: 0.55 }), g);
    p.add(new THREE.MeshStandardMaterial({ color: 0x4a7a2a, roughness: 0.8 }), new THREE.CylinderGeometry(0.1, 0.16, 0.45, 8), mat(0, R * 0.92, 0));
    // (a carved face)
    const face = glowMat(0xffc040, 2.2);
    for (const e of [-1, 1]) p.add(face, new THREE.CircleGeometry(0.2, 3), mat(e * 0.35, 0.15, R * 0.86));
    p.add(face, new THREE.PlaneGeometry(0.7, 0.14), mat(0, -0.3, R * 0.88));
  } else if (look === 'snow') {
    const g = new THREE.IcosahedronGeometry(R, 3);
    const pp = g.getAttribute('position');
    for (let i = 0; i < pp.count; i++) {
      const f = 1 + Math.sin(i * 7.31) * 0.035;
      pp.setXYZ(i, pp.getX(i) * f, pp.getY(i) * f, pp.getZ(i) * f);
    }
    g.computeVertexNormals();
    p.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), g);
    p.add(new THREE.MeshStandardMaterial({ color: 0xc8e8ff, roughness: 0.4 }), band(R * 0.99, 0.08, 24), mat(0, 0, 0, rotZ(0.4)));
  } else {
    p.add(new THREE.MeshStandardMaterial({ color: 0xb87a4a, roughness: 0.9, flatShading: true }), new THREE.DodecahedronGeometry(R, 1));
  }
  return p;
}

