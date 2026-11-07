import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CourseBuilder } from './builder.ts';
import { glowMat } from './obs-world.ts';
import type { KartTrack } from './kart-track.ts';
import { RACE } from './kart-race.ts';

/**
 * What stands round Bean Bay: the start gantry and its lights, grandstands full of beans, the
 * funfair with its big wheel, palms along the shore, a lighthouse, balloons, hoardings for things
 * that don't exist. None of it is solid (the barriers are in the way); all of it is for looking at.
 */

export interface Land {
  sea: number;
  at(x: number, z: number): { h: number; d: number };
}

const V = new THREE.Vector3();
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** a frame on the ribbon: position, and a quaternion facing up the road */
function frame(tr: KartTrack, s: number, lat: number, up: number) {
  const o = tr.idx(Math.round(s)) * 3;
  const p = tr.point(s, lat, up, new THREE.Vector3());
  const T = new THREE.Vector3(tr.T[o], 0, tr.T[o + 2]).normalize(), U = new THREE.Vector3(0, 1, 0), L = new THREE.Vector3().crossVectors(U, T);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(L, U, T));
  return { p, q, T, L };
}

function board(text: string, sub: string, bg: string, fg: string, w = 1024, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `900 ${h * (sub ? 0.5 : 0.62)}px "Arial Black", Impact, sans-serif`;
  x.fillText(text, w / 2, sub ? h * 0.4 : h / 2, w * 0.94);
  if (sub) {
    x.font = `700 ${h * 0.17}px Arial, sans-serif`;
    x.fillText(sub, w / 2, h * 0.8, w * 0.9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const HOARDINGS: [string, string, string, string][] = [
  ['BEAN BAY GP', 'Two laps. No mercy.', '#ffc21f', '#17182a'],
  ['JELLY OIL', 'Keeps you wobbling', '#e6332f', '#ffffff'],
  ['SQUISH TYRES', 'Grip when it counts', '#17182a', '#ffc21f'],
  ['WOBBLE COLA', 'Shaken, always', '#1f7fe0', '#ffffff'],
  ['DRIFT!', 'Hold it. Let go. Boost.', '#ff4f8f', '#ffffff'],
  ['BIG BOWL', 'Flat out if you dare', '#22c08a', '#10242a'],
];

export function dressScenery(b: CourseBuilder, tr: KartTrack, land: Land, y0: number, time: { value: number }) {
  const r = rng(4242);
  const S0 = RACE.start;
  // ---- the start gantry
  const redOn = glowMat(0xff2020, 9), off = new THREE.MeshStandardMaterial({ color: 0x331010, roughness: 0.4 }), greenOn = glowMat(0x20ff60, 9);
  const pods: THREE.Mesh[] = [];
  {
    const f = frame(tr, S0, 0, 0), g = new THREE.Group();
    g.position.copy(f.p);
    g.quaternion.copy(f.q);
    const hw = tr.wl[tr.idx(S0)] + 0.8, hr = tr.wr[tr.idx(S0)] + 0.8;
    const steel = new THREE.MeshStandardMaterial({ color: 0x20222e, metalness: 0.6, roughness: 0.4 });
    for (const x of [hw, -hr]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7).translate(x, 4, 0), steel);
      p.castShadow = true;
      g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw + hr + 0.7, 1.5, 0.7).translate((hw - hr) / 2, 7.5, 0), steel);
    beam.castShadow = true;
    g.add(beam);
    // the chequers across the front
    const chk = document.createElement('canvas');
    chk.width = 1024;
    chk.height = 64;
    const cx = chk.getContext('2d')!;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) {
      cx.fillStyle = (x + y) % 2 ? '#f4f4f4' : '#14141a';
      cx.fillRect(x * 32, y * 32, 32, 32);
    }
    const ct = new THREE.CanvasTexture(chk);
    ct.colorSpace = THREE.SRGBColorSpace;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(hw + hr + 0.7, 0.8), new THREE.MeshBasicMaterial({ map: ct, toneMapped: true }));
    band.rotation.y = Math.PI;
    band.position.set((hw - hr) / 2, 8.6, -0.36);
    g.add(band);
    const name = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.5), new THREE.MeshBasicMaterial({ map: board('BEAN BAY GP', '', '#17182a', '#ffc21f', 1024, 128) }));
    name.rotation.y = Math.PI;
    name.position.set((hw - hr) / 2, 7.5, -0.37);
    g.add(name);
    // five light pods, hanging facing the grid
    for (let k = 0; k < 5; k++) {
      const x = (hw - hr) / 2 + (k - 2) * 1.5;
      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 0.3).translate(x, 6.1, -0.2), steel);
      g.add(pod);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24), off);
      lamp.rotation.y = Math.PI;
      lamp.position.set(x, 6.1, -0.36);
      pods.push(lamp);
      g.add(lamp);
    }
    b.group.add(g);
  }
  // ---- grandstands
  const crowd: THREE.Matrix4[] = [], shirts: THREE.Color[] = [];
  const stand = (s: number, side: number, len: number, tiers: number, roof: number) => {
    const i = tr.idx(Math.round(s)), wall = side > 0 ? tr.wl[i] : tr.wr[i];
    const f = frame(tr, s, side * (wall + 3.4), 0), g = new THREE.Group();
    g.position.copy(f.p);
    g.quaternion.copy(f.q);
    const conc = new THREE.MeshStandardMaterial({ color: 0xdfe2ea, roughness: 0.8 });
    const seats = new THREE.MeshStandardMaterial({ color: 0x2f6ad8, roughness: 0.6 });
    const parts: THREE.BufferGeometry[] = [], seatG: THREE.BufferGeometry[] = [];
    for (let k = 0; k < tiers; k++) {
      const x = side * (0.5 + k * 1.05), y = 0.8 + k * 0.72;
      parts.push(new THREE.BoxGeometry(1.1, y, len).translate(x, y / 2, 0));
      seatG.push(new THREE.BoxGeometry(0.5, 0.14, len - 0.4).translate(x, y + 0.07, 0));
      // the bean crowd
      for (let z = -len / 2 + 0.6; z < len / 2 - 0.4; z += 0.86) {
        if (r() < 0.14) continue;
        V.set(x + (r() - 0.5) * 0.1, y + 0.1, z + (r() - 0.5) * 0.2).applyQuaternion(f.q).add(f.p);
        crowd.push(new THREE.Matrix4().compose(V.clone(), f.q, new THREE.Vector3(1, 0.85 + r() * 0.3, 1)));
        shirts.push(new THREE.Color().setHSL(r(), 0.75, 0.58));
      }
    }
    const body = new THREE.Mesh(mergeGeometries(parts)!, conc);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    g.add(new THREE.Mesh(mergeGeometries(seatG)!, seats));
    if (roof) {
      const w = tiers * 1.05 + 1.5, top = 0.8 + tiers * 0.72 + 3.2;
      const rf = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, len + 1).translate(side * (w / 2 - 0.6), top, 0), new THREE.MeshPhysicalMaterial({ color: 0xf7f7fa, roughness: 0.35, clearcoat: 0.6 }));
      rf.rotation.z = -side * 0.06;
      rf.castShadow = true;
      g.add(rf);
      for (let z = -len / 2; z <= len / 2; z += len / 4) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, top, 8).translate(side * (w - 1), top / 2, z), new THREE.MeshStandardMaterial({ color: 0x8a92a2, metalness: 0.7, roughness: 0.4 }));
        g.add(col);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len * 0.7, 26), 2), new THREE.MeshBasicMaterial({ map: board(HOARDINGS[Math.floor(r() * 3)][0], '', '#17182a', '#ffffff', 1024, 96) }));
      sign.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      sign.position.set(-side * 0.25, top - 1.1, 0);
      g.add(sign);
    }
    b.group.add(g);
  };
  stand(S0 + 8, -1, 52, 9, 1);
  stand(S0 - 52, -1, 34, 7, 1);
  stand(S0 + 62, -1, 28, 7, 0);
  stand(S0 + 8, 1, 30, 5, 0);
  // the outside of the hairpin and the top of the Bowl
  let hair = 0, best = 0, bowl = 0;
  for (let i = 0; i < tr.n; i++) {
    if (i < 300 && Math.abs(tr.curve[i]) > best) {
      best = Math.abs(tr.curve[i]);
      hair = i;
    }
    if (Math.abs(tr.bank[i]) > Math.abs(tr.bank[bowl])) bowl = i;
  }
  stand(hair, tr.curve[hair] < 0 ? 1 : -1, 26, 7, 0);
  stand(bowl - 26, tr.bank[bowl] > 0 ? -1 : 1, 30, 8, 1);
  stand(bowl + 22, tr.bank[bowl] > 0 ? -1 : 1, 30, 8, 0);
  // the people themselves
  {
    const body = new THREE.CapsuleGeometry(0.26, 0.34, 3, 8).translate(0, 0.45, 0);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;').replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = float(gl_InstanceID) * 0.73;
transformed.y += max(0.0, sin(uT * (3.0 + fract(ph) * 2.0) + ph)) * 0.2;`);
    };
    const im = new THREE.InstancedMesh(body, m, crowd.length);
    crowd.forEach((x, i) => {
      im.setMatrixAt(i, x);
      im.setColorAt(i, shirts[i]);
    });
    im.frustumCulled = false;
    im.castShadow = false;
    b.group.add(im);
  }
  // ---- hoardings along the barriers
  const place = [S0 + 95, S0 + 118, S0 - 28, 250, 330, 470, 610, 720, 885, 1010, 1100];
  place.forEach((s, k) => {
    const side = k % 2 ? 1 : -1, i = tr.idx(s), wall = side > 0 ? tr.wl[i] : tr.wr[i];
    if (tr.tunnel[i] || tr.raised[i]) return;
    const f = frame(tr, s, side * (wall + 0.9), 0.1), h = HOARDINGS[k % HOARDINGS.length];
    const g = new THREE.Group();
    g.position.copy(f.p);
    g.quaternion.copy(f.q);
    g.rotation.y += 0;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshStandardMaterial({ map: board(h[0], h[1], h[2], h[3]), roughness: 0.5 }));
    p.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.position.y = 1.9;
    p.castShadow = true;
    g.add(p);
    for (const z of [-3.6, 3.6]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8).translate(0, 0.9, z), new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.7, roughness: 0.4 })));
    b.group.add(g);
  });
  // ---- the brake boards before the hairpin, and chevrons round its outside
  for (const [d, t] of [[120, '150'], [90, '100'], [60, '50']] as [number, string][]) {
    const s = hair - d + 42, side = 1, i = tr.idx(s);
    const f = frame(tr, s, side * (tr.wl[i] + 0.7), 0);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: board(t, '', '#ffffff', '#e6332f', 256, 256) }));
    p.position.copy(f.p).add(new THREE.Vector3(0, 1.8, 0));
    p.quaternion.copy(f.q);
    p.rotateY(Math.PI);
    b.group.add(p);
  }
  // ---- palms, bushes and rocks
  {
    const trunk = new THREE.CylinderGeometry(0.14, 0.3, 7.5, 7, 5, false).translate(0, 3.75, 0);
    const tp = trunk.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + (tp.getY(i) / 7.5) ** 2 * 1.4);
    trunk.computeVertexNormals();
    const frond = () => {
      const seg = 8, pos: number[] = [], idx: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const u = k / seg, w = 0.5 * Math.sin(u * Math.PI) ** 0.7 + 0.02;
        const x = u * 3.3, y = 0.7 * Math.sin(u * 1.6) - u * u * 2.0;
        pos.push(x, y, -w, x, y + 0.14, 0, x, y, w);
        if (k < seg) {
          const a = k * 3;
          idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const fr: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const g = frond();
      g.rotateY((k / 9) * Math.PI * 2 + (k % 2) * 0.2);
      g.rotateZ(0);
      g.translate(1.4, 7.5, 0);
      fr.push(g);
    }
    const leaves = mergeGeometries(fr)!;
    const spots: { x: number; y: number; z: number; k: number; a: number }[] = [];
    for (let t = 0; t < 16000 && spots.length < 620; t++) {
      const x = -340 + r() * 640, z = -320 + r() * 640, q = land.at(x, z);
      if (q.d < 5 || q.d > 170 || q.h < land.sea + 1.6) continue;
      // (in groves, not a grid)
      if (Math.sin(x * 0.05) * Math.cos(z * 0.06 + 1) + r() * 0.8 < 0.25) continue;
      spots.push({ x, y: q.h - 0.1, z, k: 0.85 + r() * 0.65, a: r() * 6.28 });
    }
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 }), spots.length);
    const lm = new THREE.InstancedMesh(leaves, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), spots.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color();
    spots.forEach((p, i) => {
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a);
      S.setScalar(p.k);
      M.compose(V.set(p.x, p.y, p.z), Q, S);
      tm.setMatrixAt(i, M);
      lm.setMatrixAt(i, M);
      lm.setColorAt(i, C.setHSL(0.27 + r() * 0.07, 0.62, 0.3 + r() * 0.12));
    });
    tm.castShadow = lm.castShadow = true;
    tm.frustumCulled = lm.frustumCulled = false;
    b.group.add(tm, lm);
    // bushes: lumps of green near the fences
    const bush = new THREE.SphereGeometry(1, 14, 10);
    const bp = bush.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const k = 1 + 0.18 * Math.sin(bp.getX(i) * 5 + bp.getZ(i) * 3);
      bp.setXYZ(i, bp.getX(i) * k, bp.getY(i) * k * 0.72, bp.getZ(i) * k);
    }
    bush.computeVertexNormals();
    const bs: THREE.Matrix4[] = [];
    for (let t = 0; t < 9000 && bs.length < 520; t++) {
      const x = -300 + r() * 580, z = -280 + r() * 560, q = land.at(x, z);
      if (q.d < 1.5 || q.d > 60 || q.h < land.sea + 2) continue;
      const k = 0.7 + r() * 1.5;
      bs.push(new THREE.Matrix4().compose(new THREE.Vector3(x, q.h + k * 0.25, z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28).clone(), new THREE.Vector3(k, k, k)));
    }
    const bm = new THREE.InstancedMesh(bush, new THREE.MeshStandardMaterial({ roughness: 0.85 }), bs.length);
    bs.forEach((m, i) => {
      bm.setMatrixAt(i, m);
      bm.setColorAt(i, C.setHSL(0.24 + r() * 0.1, 0.5, 0.24 + r() * 0.12));
    });
    bm.castShadow = true;
    bm.frustumCulled = false;
    b.group.add(bm);
  }
  // ---- tufts and flowers along the verges: nothing says speed like grass going past
  {
    const blade = (a: number, lean: number, h: number) => {
      const g = new THREE.BufferGeometry();
      const c = Math.cos(a) * 0.09, d = Math.sin(a) * 0.09, tx = Math.cos(a + 1.57) * lean, tz = Math.sin(a + 1.57) * lean;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-c, 0, -d, c, 0, d, tx, h, tz], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      return g;
    };
    const tuft = mergeGeometries([0, 1, 2, 3, 4, 5].map((k) => blade(k * 1.05, 0.05 + (k % 3) * 0.05, 0.3 + (k % 2) * 0.16)))!;
    const flower = mergeGeometries([new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4).translate(0, 0.15, 0).toNonIndexed(), new THREE.IcosahedronGeometry(0.07, 0).scale(1, 0.5, 1).translate(0, 0.32, 0)])!;
    const spots: THREE.Vector3[] = [], M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (let t = 0; t < 26000 && spots.length < 12000; t++) {
      const s = r() * tr.n, i = tr.idx(Math.round(s));
      if (tr.tunnel[i] || tr.raised[i]) continue;
      const side = r() < 0.5 ? 1 : -1, wall = side > 0 ? tr.wl[i] : tr.wr[i], a = tr.hw[i] + 1.3, b = wall - (wall - tr.hw[i] > 8 ? 3.3 : 0.2);
      if (b <= a) continue;
      spots.push(tr.point(s, side * (a + (b - a) * r() ** 1.4), -0.02, new THREE.Vector3()));
    }
    const nF = Math.floor(spots.length * 0.14);
    const tm = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), spots.length - nF);
    const fm = new THREE.InstancedMesh(flower, new THREE.MeshStandardMaterial({ roughness: 0.7 }), nF);
    const petals = [0xffffff, 0xffe14a, 0xff7fb0, 0xbfa0ff];
    spots.forEach((p, i) => {
      Q.setFromAxisAngle(up, r() * 6.28);
      S.setScalar(0.7 + r() * 0.8);
      M.compose(p, Q, S);
      if (i < nF) {
        fm.setMatrixAt(i, M);
        fm.setColorAt(i, C.set(petals[Math.floor(r() * 4)]));
      } else {
        tm.setMatrixAt(i - nF, M);
        tm.setColorAt(i - nF, C.setHSL(0.27 + r() * 0.06, 0.62, 0.17 + r() * 0.1));
      }
    });
    tm.frustumCulled = fm.frustumCulled = false;
    tm.receiveShadow = true;
    b.group.add(tm, fm);
  }
  // ---- the funfair, in the loop of the Bowl
  {
    const c = new THREE.Vector3(76, 0, 70), g = new THREE.Group();
    c.y = land.at(c.x, c.z).h;
    g.position.copy(c);
    const R = 21, hub = R + 4;
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf6f6fa, roughness: 0.3, metalness: 0.2, clearcoat: 0.7 });
    for (const z of [-2.4, 2.4])
      for (const x of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, Math.hypot(hub, 10), 10), white);
        leg.position.set(x * 5, hub / 2, z);
        leg.rotation.z = Math.atan2(x * 10, hub);
        leg.castShadow = true;
        g.add(leg);
      }
    const wheel = new THREE.Group();
    wheel.position.y = hub;
    const rim = new THREE.TorusGeometry(R, 0.22, 8, 72);
    for (const z of [-1.3, 1.3]) wheel.add(new THREE.Mesh(rim.clone().translate(0, 0, z), white));
    const lights = new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.09, 6, 72), glowMat(0xffd060, 3));
    wheel.add(lights);
    const cars: THREE.Object3D[] = [];
    const N = 14, colours = [0xff4f8f, 0xffc21f, 0x2fb8ff, 0x22c08a, 0xff6a3d, 0xa36bff];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, R, 6).translate(0, R / 2, 0), white);
      spoke.rotation.z = -a;
      wheel.add(spoke);
      const car = new THREE.Group();
      car.position.set(Math.sin(a) * R, Math.cos(a) * R, 0);
      const pod = new THREE.Mesh(new THREE.SphereGeometry(1.45, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.72).rotateX(Math.PI).translate(0, -1.6, 0), new THREE.MeshPhysicalMaterial({ color: colours[k % 6], roughness: 0.3, clearcoat: 1 }));
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.7, 14).translate(0, -0.25, 0), white);
      pod.castShadow = true;
      car.add(pod, top);
      wheel.add(car);
      cars.push(car);
    }
    g.add(wheel);
    g.rotation.y = 0.9;
    b.group.add(g);
    b.animators.push((t) => {
      wheel.rotation.z = t * 0.12;
      for (const q of cars) q.rotation.z = -t * 0.12;
    });
    // the big top, striped
    const tent = (x: number, z: number, rad: number, hgt: number, a: number, bcol: number) => {
      const y = land.at(x, z).h, gg = new THREE.Group();
      gg.position.set(x, y, z);
      const n = 16, geo: THREE.BufferGeometry[][] = [[], []];
      for (let k = 0; k < n; k++) {
        const seg = new THREE.ConeGeometry(rad, hgt * 0.5, 2, 1, true, (k / n) * Math.PI * 2, (Math.PI * 2) / n).translate(0, hgt * 0.75, 0);
        const wall = new THREE.CylinderGeometry(rad, rad, hgt * 0.5, 2, 1, true, (k / n) * Math.PI * 2, (Math.PI * 2) / n).translate(0, hgt * 0.25, 0);
        geo[k % 2].push(seg, wall);
      }
      gg.add(new THREE.Mesh(mergeGeometries(geo[0])!, new THREE.MeshStandardMaterial({ color: a, roughness: 0.6, side: THREE.DoubleSide })));
      gg.add(new THREE.Mesh(mergeGeometries(geo[1])!, new THREE.MeshStandardMaterial({ color: bcol, roughness: 0.6, side: THREE.DoubleSide })));
      gg.traverse((o) => (o.castShadow = true));
      b.group.add(gg);
    };
    tent(34, 66, 10, 12, 0xe6332f, 0xf8f4ea);
    tent(44, 92, 7, 9, 0x2f6ad8, 0xffc21f);
    tent(96, 84, 6, 8, 0x22c08a, 0xf8f4ea);
  }
  // ---- the lighthouse, on the point
  {
    const x = -250, z = -170, y = land.at(x, z).h, g = new THREE.Group();
    g.position.set(x, y - 1, z);
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(3.4 - (k + 1) * 0.26, 3.4 - k * 0.26, 5, 20).translate(0, 2.5 + k * 5, 0), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xf6f2e8 : 0xe0342f, roughness: 0.6 }));
      s.castShadow = true;
      g.add(s);
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 2.6, 16).translate(0, 31.3, 0), glowMat(0xfff0b0, 3.4)));
    g.add(new THREE.Mesh(new THREE.ConeGeometry(2.2, 2, 16).translate(0, 33.6, 0), new THREE.MeshStandardMaterial({ color: 0x20222e, roughness: 0.4 })));
    b.group.add(g);
  }
  // ---- balloons drifting over the bay
  {
    const list: { g: THREE.Group; x: number; y: number; z: number; p: number }[] = [];
    const cols = [[0xff4f8f, 0xffc21f], [0x2fb8ff, 0xffffff], [0xff6a3d, 0x2f6ad8], [0x22c08a, 0xfff1b0]];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      const a = (k / 4) * 6.28 + 0.6, rad = 240 + k * 34;
      const n = 12, sets: THREE.BufferGeometry[][] = [[], []];
      for (let q = 0; q < n; q++) sets[q % 2].push(new THREE.SphereGeometry(11, 3, 18, (q / n) * Math.PI * 2, (Math.PI * 2) / n).scale(1, 1.2, 1));
      for (let q = 0; q < 2; q++) g.add(new THREE.Mesh(mergeGeometries(sets[q])!, new THREE.MeshStandardMaterial({ color: cols[k][q], roughness: 0.55 })));
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2, 2.8).translate(0, -17, 0), new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.9 }));
      g.add(basket);
      g.traverse((o) => (o.castShadow = true));
      g.position.set(Math.cos(a) * rad, y0 + 62 + k * 16, Math.sin(a) * rad);
      b.group.add(g);
      list.push({ g, x: g.position.x, y: g.position.y, z: g.position.z, p: k * 1.7 });
    }
    b.animators.push((t) => {
      for (const q of list) {
        q.g.position.y = q.y + Math.sin(t * 0.17 + q.p) * 3;
        q.g.position.x = q.x + Math.sin(t * 0.05 + q.p) * 12;
      }
    });
  }
  return {
    lights(n: number, green: boolean) {
      pods.forEach((p, k) => (p.material = green ? greenOn : k < n ? redOn : off));
    },
  };
}
