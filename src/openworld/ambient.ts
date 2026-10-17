import * as THREE from 'three';
import { ll, WORLD, type LandMask } from './geo.ts';
import { buildBoat } from './vehicles/Boat.ts';
import { Helicopter } from './vehicles/Helicopter.ts';
import { mergeStatic, rng } from './city/build.ts';
import type { WorldCtx } from './vehicles/drivable.ts';

/**
 * The life over and around the city that isn't traffic: airliners on the approach to MIA (they
 * come in from the Atlantic over Miami Beach and the bay, descending west), boats cruising the bay
 * and the Government Cut, and a news helicopter circling Downtown.
 */

const WATER_Y = -1.1;

/** a twin-engine airliner, ~45 m: fuselage, swept wings, fin, tailplane, engines, nav lights */
function buildAirliner(stripe: number) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.35, metalness: 0.2 });
  const grey = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.4, metalness: 0.4 });
  const band = new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.4 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(2.0, 38, 6, 16), white);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(2.03, 30, 4, 16, 1), band);
  belly.rotation.x = Math.PI / 2;
  belly.scale.set(1, 1, 0.35);
  belly.position.y = -0.9;
  g.add(belly);
  // swept wings (a flat trapezoid each side)
  const wing = (sx: number, span: number, root: number, tip: number, sweep: number, y: number, z: number, mat: THREE.Material) => {
    const sh = new THREE.Shape();
    sh.moveTo(0, root / 2);
    sh.lineTo(span * sx, root / 2 - sweep);
    sh.lineTo(span * sx, root / 2 - sweep - tip);
    sh.lineTo(0, -root / 2);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, y, z);
    g.add(m);
  };
  for (const sx of [1, -1]) {
    wing(sx, 17, 8, 2.2, 7, -0.8, 1, white);
    wing(sx, 7, 4, 1.4, 3, 1.2, -18.5, white);
    // the engine under each wing
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.1, 4.6, 14), grey);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(sx * 6, -2.1, 3.2);
    g.add(eng);
  }
  // the fin
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(-6.5, 0);
  fin.lineTo(-9.5, 8.5);
  fin.lineTo(-6.8, 8.5);
  fin.closePath();
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.35, bevelEnabled: false });
  finG.rotateY(-Math.PI / 2);
  const finM = new THREE.Mesh(finG, band);
  finM.position.set(0.17, 1.6, -13);
  g.add(finM);
  mergeStatic(g, new Set());
  // nav lights: red left, green right, white strobes (blink)
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.2) }));
  red.position.set(17, -0.6, -6);
  const green = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 6, 0.4) }));
  green.position.set(-17, -0.6, -6);
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 4), strobeMat);
  strobe.position.set(0, -2.1, 0);
  g.add(red, green, strobe);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { g, strobeMat };
}

interface Plane {
  g: THREE.Group;
  strobe: THREE.MeshBasicMaterial;
  phase: number;
}

interface BayBoat {
  m: ReturnType<typeof buildBoat>;
  path: { x: number; z: number }[];
  i: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  bob: number;
}

export class Ambient {
  readonly group = new THREE.Group();
  private planes: Plane[] = [];
  private boats: BayBoat[] = [];
  private news: Helicopter;
  private t = 0;
  private readonly approachZ: number;

  constructor(mask: LandMask) {
    this.group.name = 'Ambient';
    const R = rng(4242);
    // ---- the approach to MIA's runway 9/27: a line along ~25.795° N, west-bound, descending
    this.approachZ = ll(25.7965, 0).z;
    const stripes = [0x1d3c8a, 0xd8202a, 0x0b5fa5];
    for (let i = 0; i < 3; i++) {
      const { g, strobeMat } = buildAirliner(stripes[i]);
      this.group.add(g);
      this.planes.push({ g, strobe: strobeMat, phase: i / 3 });
    }
    // ---- boats in the bay: loops of open-water waypoints whose legs never cross land
    const clear = (a: { x: number; z: number }, b: { x: number; z: number }) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 12);
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
        if (mask.land(x, z) || mask.land(x + 25, z) || mask.land(x - 25, z) || mask.land(x, z + 25) || mask.land(x, z - 25)) return false;
      }
      return true;
    };
    const centres = [ll(25.7700, -80.1800), ll(25.7900, -80.1700), ll(25.7600, -80.1650), ll(25.8000, -80.1600), ll(25.7820, -80.1640), ll(25.7550, -80.1750), ll(25.7740, -80.1550)];
    const liveries = [0xffffff, 0xf4f4f2, 0x10131a, 0xf2e8d5, 0x1f5bd6];
    for (const c of centres) {
      // a loose ring of points round the centre; keep the ones reachable leg to leg
      const pts: { x: number; z: number }[] = [];
      const r = 220 + R() * 260;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + R() * 0.3;
        const p = { x: c.x + Math.cos(a) * r * (0.7 + R() * 0.5), z: c.z + Math.sin(a) * r * (0.7 + R() * 0.5) };
        if (p.x < WORLD.x0 || p.x > WORLD.x1 || p.z < WORLD.z0 || p.z > WORLD.z1 || mask.land(p.x, p.z)) continue;
        if (pts.length && !clear(pts[pts.length - 1], p)) continue;
        pts.push(p);
      }
      if (pts.length < 3 || !clear(pts[pts.length - 1], pts[0])) continue;
      const len = 9 + R() * 12;
      const m = buildBoat(liveries[Math.floor(R() * liveries.length)], [0xff3f8e, 0x57e8ff, 0x1d3c8a, 0xffd84d][Math.floor(R() * 4)], len);
      this.group.add(m.root);
      this.boats.push({ m, path: pts, i: 1, x: pts[0].x, z: pts[0].z, yaw: 0, speed: 7 + R() * 9, bob: R() * 10 });
    }
    // ---- the news helicopter over Downtown
    this.news = new Helicopter('news');
    const d = ll(25.7745, -80.1905);
    this.news.place(d.x, 240, d.z, 0);
    this.news.rpm = 1;
    this.news.grounded = false;
    this.news.aiTarget = new THREE.Vector3(d.x, 170, d.z);
    this.group.add(this.news.root);
  }

  update(dt: number, ctx: WorldCtx, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    // airliners: 26 km of approach at ~75 m/s, from 1100 m down to 250 m as they leave the map
    const L = 26000, x0 = WORLD.x1 + 9000;
    for (const p of this.planes) {
      const u = ((t * 75) / L + p.phase) % 1;
      const x = x0 - u * L;
      const y = 1100 - u * 850;
      p.g.position.set(x, y, this.approachZ + Math.sin(u * 6 + p.phase * 9) * 40);
      // west-bound, a 3° glide, nose a touch up
      p.g.rotation.set(-0.03, -Math.PI / 2, 0, 'YXZ');
      p.strobe.color.setScalar(Math.floor(t * 1.1 + p.phase * 3) % 2 === 0 && (t * 1.1) % 1 < 0.1 ? 8 : 0);
      p.g.visible = Math.abs(x - cam.x) < 14000;
    }
    // boats: follow their loops, bank into the turns, bob, a wake that builds with speed
    for (const b of this.boats) {
      const w = b.path[b.i];
      const dx = w.x - b.x, dz = w.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 30) b.i = (b.i + 1) % b.path.length;
      const want = Math.atan2(dx, dz);
      const err = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
      const turn = THREE.MathUtils.clamp(err, -0.35 * dt, 0.35 * dt);
      b.yaw += turn;
      const sp = b.speed * (1 - Math.min(0.5, Math.abs(err)));
      b.x += Math.sin(b.yaw) * sp * dt;
      b.z += Math.cos(b.yaw) * sp * dt;
      const m = b.m;
      const near = Math.hypot(b.x - cam.x, b.z - cam.z) < 2500;
      m.root.visible = near;
      if (!near) continue;
      m.root.position.set(b.x, WATER_Y + 0.05 + Math.sin(t * 1.3 + b.bob) * 0.05, b.z);
      m.root.rotation.set(0, b.yaw, 0);
      m.hull.rotation.set(-0.06 * Math.min(1, sp / 12) + Math.sin(t * 0.9 + b.bob) * 0.01, 0, (-turn / Math.max(dt, 1e-3)) * 0.4, 'YXZ');
      m.wake.position.y = 0.03;
      m.wakeMat.opacity = THREE.MathUtils.smoothstep(sp, 2, 12) * 0.75;
      m.wake.scale.set(1, 0.35 + Math.min(1, sp / 20) * 0.6, 1);
      m.sprayMat.opacity = THREE.MathUtils.smoothstep(sp, 9, 18) * 0.4;
    }
    // the news chopper: a slow orbit round Downtown
    const c = ll(25.7745, -80.1905);
    this.news.aiTarget!.set(c.x + Math.cos(t * 0.04) * 500, 170, c.z + Math.sin(t * 0.04) * 500);
    this.news.drive(dt, null, ctx);
    this.news.root.visible = this.news.pos.distanceTo(cam) < 4000;
  }
}
