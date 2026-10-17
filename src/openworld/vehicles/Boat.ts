import * as THREE from 'three';
import { mergeStatic } from '../city/build.ts';
import { loft, table, type Station } from './loft.ts';
import { MAT, paintMaterial } from './parts.ts';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Drivable, HudInfo, WorldCtx } from './drivable.ts';
import { WATER_Y } from '../geo.ts';

/**
 * The go-fast boat: a 39-foot offshore racer (the Miami Vice cigarette boat), deep-V hull, a low
 * deck and windscreen, three outboards. It planes: at speed the bow rises and the hull skims; it
 * banks into turns and leaves a wake. Also used (smaller, no driver) for the bay's other boats.
 */

/** a soft white wake: two diverging wash lines and a churned centre, fading aft */
let wakeTex: THREE.CanvasTexture | null = null;
function wakeTexture() {
  if (wakeTex) return wakeTex;
  const W = 256, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const R = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  // (v = 0 at the transom, 1 far aft)
  for (let i = 0; i < 2600; i++) {
    const v = R();
    const fade = Math.pow(1 - v, 1.6);
    // the centre churn
    const cx = W / 2 + (R() - 0.5) * (30 + v * 120);
    g.fillStyle = `rgba(255,255,255,${0.05 + 0.18 * fade})`;
    g.beginPath();
    g.arc(cx, v * H, 2 + R() * 6 * (0.4 + v), 0, Math.PI * 2);
    g.fill();
    // the two wash lines (the Kelvin wedge, ~19°)
    for (const sg of [1, -1]) {
      const x = W / 2 + sg * (18 + v * W * 0.42) + (R() - 0.5) * 8;
      g.fillStyle = `rgba(255,255,255,${0.08 + 0.25 * fade})`;
      g.beginPath();
      g.arc(x, v * H, 1.5 + R() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  wakeTex = new THREE.CanvasTexture(cv);
  wakeTex.colorSpace = THREE.SRGBColorSpace;
  // (canvas top = the transom = the plane's near edge)
  wakeTex.flipY = false;
  return wakeTex;
}

export function buildBoat(color: THREE.ColorRepresentation, stripe: THREE.ColorRepresentation, len = 11.8) {
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);
  const k = len / 11.8;
  const white = paintMaterial(color, 0.22, 0.2);
  const str = paintMaterial(stripe, 0.3, 0.2);
  const str2 = paintMaterial(0x57e8ff, 0.3, 0.2);
  const bottom = paintMaterial(0x15171b, 0.3, 0.35);
  const cream = new THREE.MeshStandardMaterial({ color: 0xe9dfc9, roughness: 0.55 });
  const chrome = MAT.chrome();
  // ---- the hull: a deep-V bottom to a hard chine, flared topsides, the rub rail, a crowned deck
  const hw = table([[5.9, 0.0], [5.3, 0.5], [4.2, 0.95], [2.4, 1.2], [0, 1.25], [-5.9, 1.2]]);
  const keel = table([[5.9, 0.95], [5.0, 0.22], [3.5, -0.35], [1.0, -0.5], [-5.9, -0.48]]);
  const chine = table([[5.9, 1.0], [5.0, 0.5], [3.0, 0.02], [0, -0.1], [-5.9, -0.14]]);
  const sheer = table([[5.9, 1.38], [4.5, 1.22], [1.0, 1.04], [-5.9, 0.98]]);
  const st: Station[] = [];
  for (let i = 0; i <= 44; i++) {
    const z = 5.9 - (i / 44) * 11.8;
    const w = Math.max(0.004, hw(z)), yk = keel(z), yc = Math.min(chine(z), sheer(z) - 0.55), ys = sheer(z);
    const top = (t: number) => w * (1 + 0.04 * Math.sin(t * Math.PI));
    st.push({
      z: z * k,
      bands: [
        { pts: [[0, yk], [w * 0.45, yk + (yc - yk) * 0.42], [w * 0.92, yc]] },
        { pts: [[w * 0.92, yc], [w, yc + 0.05]] },
        { pts: [[w, yc + 0.05], [top(0.3), ys - 0.5], [top(0.45), ys - 0.42], [top(0.55), ys - 0.36], [top(0.75), ys - 0.2], [w, ys]] },
        { pts: [[w, ys], [w * 1.015, ys + 0.03], [w * 0.97, ys + 0.06]] },
        { pts: [[w * 0.97, ys + 0.06], [w * 0.6, ys + 0.14], [0, ys + 0.18]] },
      ].map((b) => ({ pts: b.pts.map(([x, y]) => [x * k, y * k] as [number, number]) })),
    });
  }
  const L0 = loft({
    stations: st,
    slot: (b, z, y) => {
      if (b <= 1) return 'bottom';
      if (b === 3) return 'rail';
      if (b === 2) {
        const d = y / k - sheer(z / k);
        if (d > -0.36 && d < -0.2) return 'stripe';
        if (d > -0.5 && d < -0.42) return 'stripe2';
      }
      return 'paint';
    },
    capRear: 'paint',
  });
  const mats: Record<string, THREE.Material> = { bottom, rail: chrome, stripe: str, stripe2: str2, paint: white };
  for (const [sl, g] of L0.slots) {
    const m = new THREE.Mesh(g, mats[sl] ?? white);
    m.castShadow = true;
    hull.add(m);
  }
  const deckY = (z: number) => (sheer(z) + 0.16) * k;
  // ---- the cockpit: a cream tub, two bolstered buckets, a bench, the helm with its wheel
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.9 * k, 0.12 * k, 2.6 * k), cream);
  tub.position.set(0, deckY(-1.3) + 0.02, -1.3 * k);
  hull.add(tub);
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(2.05 * k, 0.1 * k, 2.75 * k), white);
  coaming.position.set(0, deckY(-1.3) - 0.03, -1.3 * k);
  hull.add(coaming);
  for (const sx of [-0.45, 0.45]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.55 * k, 0.32 * k, 0.55 * k), cream);
    base.position.set(sx * k, deckY(-0.9) + 0.2 * k, -0.9 * k);
    hull.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55 * k, 0.55 * k, 0.14 * k), cream);
    back.position.set(sx * k, deckY(-0.9) + 0.55 * k, -1.18 * k);
    back.rotation.x = -0.18;
    hull.add(back);
    const bol = new THREE.Mesh(new THREE.BoxGeometry(0.08 * k, 0.4 * k, 0.5 * k), str);
    for (const bx of [-0.25, 0.25]) {
      const b2 = bol.clone();
      b2.position.set((sx + bx) * k, deckY(-0.9) + 0.42 * k, -0.95 * k);
      hull.add(b2);
    }
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8 * k, 0.32 * k, 0.6 * k), cream);
  bench.position.set(0, deckY(-2.2) + 0.2 * k, -2.25 * k);
  hull.add(bench);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.8 * k, 0.4 * k, 0.14 * k), cream);
  benchBack.position.set(0, deckY(-2.5) + 0.5 * k, -2.55 * k);
  hull.add(benchBack);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7 * k, 0.32 * k, 0.4 * k), MAT.interior());
  dash.position.set(0, deckY(-0.3) + 0.12 * k, -0.25 * k);
  dash.rotation.x = 0.3;
  hull.add(dash);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17 * k, 0.018 * k, 8, 24), chrome);
  wheel.position.set(0.45 * k, deckY(-0.5) + 0.38 * k, -0.48 * k);
  wheel.rotation.x = -0.55;
  hull.add(wheel);
  // ---- the wraparound windscreen with its chrome top rail
  {
    const N = 16, z0 = -0.05 * k, rx = 1.05 * k, rz = 0.5 * k, h = 0.48 * k;
    const pos: number[] = [];
    const idx: number[] = [];
    const rail: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = -1.35 + (i / N) * 2.7;
      const bx = Math.sin(a) * rx, bz = z0 + Math.cos(a) * rz;
      const by = deckY(bz / k) + 0.02;
      // the top leans aft
      const tx = bx * 0.93, tz = bz - 0.32 * k, ty = by + h;
      pos.push(bx, by, bz, tx, ty, tz);
      rail.push(new THREE.Vector3(tx, ty, tz));
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const glass = MAT.glassDark().clone() as THREE.MeshPhysicalMaterial;
    glass.side = THREE.DoubleSide;
    glass.transparent = true;
    glass.opacity = 0.55;
    hull.add(new THREE.Mesh(g, glass));
    hull.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 32, 0.022 * k, 6), chrome));
  }
  // ---- the engine hatch (vented) and the swim platform
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.9 * k, 0.24 * k, 2.0 * k), white);
  hatch.position.set(0, deckY(-4.2) + 0.08 * k, -4.15 * k);
  hatch.castShadow = true;
  hull.add(hatch);
  for (let i = 0; i < 6; i++) {
    for (const sx of [-0.55, 0.55]) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.5 * k, 0.03 * k, 0.06 * k), MAT.blackTrim());
      v.position.set(sx * k, deckY(-4.2) + 0.21 * k, (-3.5 - i * 0.22) * k);
      hull.add(v);
    }
  }
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2.2 * k, 0.08 * k, 0.5 * k), MAT.interior());
  plat.position.set(0, 0.25 * k, -6.1 * k);
  hull.add(plat);
  // ---- three outboards on the transom: cowling, midsection, the leg into the water, the prop
  const engines: THREE.Group[] = [];
  const cowlMat = paintMaterial(0x0c0d10, 0.2, 0.15);
  for (const x of [-0.62, 0, 0.62]) {
    const e = new THREE.Group();
    e.position.set(x * k, 0, -6.35 * k);
    const cowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.24 * k, 0.32 * k, 4, 12), cowlMat);
    cowl.scale.set(0.85, 1, 1.25);
    cowl.position.set(0, 1.15 * k, 0);
    e.add(cowl);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.42 * k, 0.05 * k, 0.6 * k), white);
    band.position.set(0, 1.0 * k, 0);
    e.add(band);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.22 * k, 0.65 * k, 0.32 * k), cowlMat);
    mid.position.set(0, 0.55 * k, -0.04 * k);
    e.add(mid);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1 * k, 0.75 * k, 0.26 * k), cowlMat);
    leg.position.set(0, -0.05 * k, -0.06 * k);
    e.add(leg);
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.17 * k, 0.04 * k, 3), MAT.rimSilver());
    prop.rotation.x = Math.PI / 2;
    prop.position.set(0, -0.32 * k, -0.24 * k);
    e.add(prop);
    e.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    hull.add(e);
    engines.push(e);
  }
  // ---- nav lights
  for (const [sx, c] of [[1, 0xff2020], [-1, 0x20ff40]] as const) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.5) }));
    n.position.set(sx * hw(4.6) * k, deckY(4.6) - 0.08, 4.6 * k);
    hull.add(n);
  }
  // ---- the wake (on the water, not pitching with the hull) and the bow spray
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, opacity: 0, depthWrite: false });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(14 * k, 40 * k), wakeMat);
  wake.rotation.x = -Math.PI / 2;
  // (after the turn flat, the plane's +y runs aft)
  wake.geometry.translate(0, 20 * k, 0);
  wake.position.set(0, 0.06, -5.8 * k);
  wake.renderOrder = 2;
  root.add(wake);
  const sprayMat = new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const spray: THREE.Mesh[] = [];
  for (const sx of [1, -1]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * k, 3.5 * k), sprayMat);
    sp.position.set(sx * 1.3 * k, 0.45, 2.6 * k);
    sp.rotation.set(-0.3, sx * 0.35, sx * 0.9);
    root.add(sp);
    spray.push(sp);
  }
  for (const e of engines) mergeStatic(e, new Set());
  mergeStatic(hull, new Set<THREE.Object3D>(engines));
  return { root, hull, engines, wake, wakeMat, spray, sprayMat };
}

export class Boat implements Drivable {
  readonly kind = 'boat' as const;
  name = 'Go-fast boat';
  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  occupied = false;
  impact = 0;
  health = 1;
  private model: ReturnType<typeof buildBoat>;
  private speed = 0;
  private yawRate = 0;
  private pitch = 0;
  private roll = 0;
  private t = 0;
  private steerVis = 0;

  constructor(color: THREE.ColorRepresentation = 0xf4f4f2, stripe: THREE.ColorRepresentation = 0xff3f8e) {
    this.model = buildBoat(color, stripe);
    this.root = this.model.root;
  }

  place(x: number, _y: number, z: number, yaw: number) {
    this.pos.set(x, WATER_Y, z);
    this.yaw = yaw;
    this.speed = 0;
    this.sync(0);
  }

  drive(dt: number, pad: Pad | null, ctx: WorldCtx) {
    this.t += dt;
    this.impact = 0;
    const thr = pad ? pad.throttle - pad.brake * 0.6 : 0;
    const max = 38;
    const acc = thr > 0 ? thr * 7.5 * (1 - this.speed / max) : thr * 6;
    this.speed += acc * dt;
    this.speed -= this.speed * (Math.abs(this.speed) > 12 ? 0.06 : 0.28) * dt;
    const steer = pad ? pad.steer : 0;
    this.steerVis += (steer - this.steerVis) * Math.min(1, dt * 5);
    this.yawRate += (steer * 0.55 * THREE.MathUtils.clamp(this.speed / 10, -0.6, 1) - this.yawRate) * Math.min(1, dt * 2.5);
    this.yaw += this.yawRate * dt;
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
    // the shore: the hull grounds (the land mask is the seawall)
    const bow = 5.5 * Math.sign(this.speed || 1);
    if (ctx.net.mask.land(nx + Math.sin(this.yaw) * bow, nz + Math.cos(this.yaw) * bow)) {
      this.impact = Math.abs(this.speed);
      this.speed *= -0.25;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.vel.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
    // planing: the bow lifts, then settles on the step; banks into the turn; swell
    const plane = THREE.MathUtils.smoothstep(this.speed, 4, 14) * (1 - THREE.MathUtils.smoothstep(this.speed, 18, 32) * 0.6);
    this.pitch += (-plane * 0.13 - this.pitch) * Math.min(1, dt * 2);
    this.roll += (this.yawRate * this.speed * 0.025 - this.roll) * Math.min(1, dt * 3);
    this.pos.y = WATER_Y + 0.05 + Math.sin(this.t * 1.3) * 0.06 + plane * 0.18;
    this.sync(dt);
  }

  private sync(_dt: number) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.set(0, this.yaw, 0, 'YXZ');
    m.hull.rotation.set(this.pitch + Math.sin(this.t * 0.9) * 0.012, 0, -this.roll + Math.sin(this.t * 1.1) * 0.015, 'YXZ');
    // the wake sits on the water at the waterline whatever the hull does
    m.wake.position.y = WATER_Y + 0.08 - this.pos.y;
    const sp = Math.abs(this.speed);
    m.wakeMat.opacity = THREE.MathUtils.smoothstep(sp, 1.5, 14) * 0.85;
    m.wake.scale.set(1, 0.35 + Math.min(1, sp / 25) * 0.65, 1);
    m.sprayMat.opacity = THREE.MathUtils.smoothstep(sp, 8, 22) * 0.55;
    for (const e of m.engines) e.rotation.y = -this.steerVis * 0.35;
  }

  subject(): CamSubject {
    return { pos: this.pos, yaw: this.yaw, vel: this.vel, body: this.model.hull, eye: new THREE.Vector3(0.4, 1.9, -0.3), size: 9, kind: 'car' };
  }

  hud(): HudInfo {
    return { name: this.name, speed: Math.abs(this.speed), gauges: [{ label: 'Hull', value: this.health, color: '#ffb547' }], gear: this.speed < -0.2 ? 'R' : 'D' };
  }

  exitPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x + Math.cos(this.yaw) * 2.5, this.pos.y + 1, this.pos.z - Math.sin(this.yaw) * 2.5);
  }
}
