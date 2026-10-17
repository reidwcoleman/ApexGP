import * as THREE from 'three';
import type { BuildingsBuild } from './buildings.ts';
import { rng } from './build.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ll, type LandMask } from '../geo.ts';
import type { Solid } from '../sim/collide.ts';

/**
 * The parts of Miami's landmarks a facade can't make, and the things only Miami has:
 *  - Miami Tower's three stepped quarter-round tiers, washed in slowly changing colour at night
 *  - the Freedom Tower's cupola; the Kaseya Center's white roof and its ring of light
 *  - the Pérez Art Museum's canopy on its slender stilts, the hanging gardens under it
 *  - Frost Science's planetarium sphere and the aquarium's cone
 *  - Bayside's SkyViews observation wheel turning over the marina, lit at night
 *  - cruise ships at the PortMiami berths, the gantry cranes and container stacks of the cargo yard
 *  - the lifeguard towers of South Beach, each painted differently
 *  - the neon blade signs of the Ocean Drive hotels
 */

export interface LandmarkBuild {
  group: THREE.Group;
  solids: Solid[];
  update(t: number, night: number): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** a box solid (for the collision world) */
function boxSolid(cx: number, cz: number, w: number, d: number, yaw: number, y0: number, y1: number): Solid {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (x: number, z: number) => ({ x: cx + x * c + z * s, z: cz - x * s + z * c });
  // wound so each edge's (ez, -ex) points out, as the collision world wants
  const poly = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
  return { poly, y0, y1, cx, cz, r: Math.hypot(w, d) / 2, kind: 'building' };
}

function stripes(n: number, base: string, line: string, w = 64, h = 256) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.fillStyle = line;
  for (let i = 0; i < n; i++) g.fillRect(0, Math.round((i / n) * h), w, 3);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a cruise ship's side: rows of balconies and portholes, with a night version (lit cabins) */
function shipSideTextures(seed: number) {
  const W = 1024, H = 256;
  const R = rng(seed);
  const day = document.createElement('canvas');
  const night = document.createElement('canvas');
  day.width = night.width = W;
  day.height = night.height = H;
  const g = day.getContext('2d')!;
  const n = night.getContext('2d')!;
  g.fillStyle = '#f4f5f4';
  g.fillRect(0, 0, W, H);
  n.fillStyle = '#000';
  n.fillRect(0, 0, W, H);
  const rows = 10;
  for (let r = 0; r < rows; r++) {
    const y = (r / rows) * H;
    const rh = H / rows;
    // the deck line
    g.fillStyle = '#c9ced2';
    g.fillRect(0, y + rh - 3, W, 3);
    const cols = 120;
    for (let c = 0; c < cols; c++) {
      const x = (c / cols) * W;
      // balcony glass (dark), rail line
      g.fillStyle = r < 2 ? '#1d2a33' : '#2a3a46';
      g.fillRect(x + 1, y + 4, W / cols - 2, rh - 10);
      g.fillStyle = '#e8eaeb';
      g.fillRect(x, y + rh * 0.55, W / cols, 2);
      if (R() < 0.38) {
        n.fillStyle = R() < 0.7 ? 'rgba(255,214,150,1)' : 'rgba(210,230,255,1)';
        n.fillRect(x + 2, y + 5, W / cols - 4, rh - 13);
      }
    }
  }
  const td = new THREE.CanvasTexture(day);
  const tn = new THREE.CanvasTexture(night);
  for (const t of [td, tn]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { td, tn };
}

/** a neon blade sign: the hotel's name in tall letters down the blade */
function neonTexture(name: string, color: number) {
  const W = 128, H = 512;
  const day = document.createElement('canvas');
  day.width = W;
  day.height = H;
  const g = day.getContext('2d')!;
  const col = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = col;
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.fillStyle = col;
  g.font = `bold ${Math.min(80, Math.floor((H - 40) / name.length))}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const step = (H - 40) / name.length;
  for (let i = 0; i < name.length; i++) g.fillText(name[i], W / 2, 20 + step * (i + 0.5));
  const t = new THREE.CanvasTexture(day);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLandmarks(bld: BuildingsBuild, mask: LandMask, beachX: (z: number) => number): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'Landmarks';
  const solids: Solid[] = [];
  const R = rng(1234);
  const L = bld.landmarks;
  const updates: ((t: number, night: number) => void)[] = [];
  /** parts that move (left out of the static merge) */
  const keep = new Set<THREE.Object3D>();
  const cast = (o: THREE.Object3D) => {
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return o;
  };

  // ---------------------------------------------------------------- Miami Tower's crown
  if (L.miamiTower) {
    const M = L.miamiTower;
    const tiers = new THREE.Group();
    const band = stripes(4, '#e9eef0', '#9aa6ad');
    const mats: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < 3; i++) {
      // a D: flat side west, the quarter-rounds stepping back toward the top
      const w = M.w * (1 - 0.24 * i), d = M.d * (1 - 0.08 * i);
      const sh = new THREE.Shape();
      const r = d / 2;
      sh.moveTo(-w / 2, -r);
      sh.lineTo(w / 2 - r, -r);
      sh.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
      sh.lineTo(-w / 2, r);
      sh.closePath();
      const h = 14;
      const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 24 });
      g.rotateX(-Math.PI / 2);
      const tex = band.clone();
      tex.repeat.set(0.05, 0.25);
      const m = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.35, metalness: 0.25, emissive: 0x000000 });
      mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(M.x - (M.w * 0.24 * i) / 2, M.y + i * h, M.z);
      tiers.add(mesh);
    }
    group.add(cast(tiers));
    updates.push((t, night) => {
      // the colour wash: each tier its own hue, drifting
      mats.forEach((m, i) => {
        const hue = (t * 0.01 + i * 0.12) % 1;
        m.emissive.setHSL(hue, 0.85, 0.5).multiplyScalar(night * 0.95);
      });
    });
  }

  // ---------------------------------------------------------------- the Freedom Tower's cupola
  if (L.freedomTower) {
    const F = L.freedomTower;
    const cream = new THREE.MeshStandardMaterial({ color: 0xe6d4b0, roughness: 0.7 });
    const g = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 4, 12), cream);
    drum.position.set(F.x, F.y + 2, F.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), cream);
    dome.scale.set(1, 1.35, 1);
    dome.position.set(F.x, F.y + 4, F.z);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 3.2, 8), cream);
    lantern.position.set(F.x, F.y + 11, F.z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cream);
    cap.position.set(F.x, F.y + 12.6, F.z);
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 3, 6), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.8, roughness: 0.3 }));
    fin.position.set(F.x, F.y + 15, F.z);
    g.add(drum, dome, lantern, cap, fin);
    group.add(cast(g));
  }

  // ---------------------------------------------------------------- the arena's roof
  if (L.arena) {
    const A = L.arena;
    const roof = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.55 }));
    roof.scale.set(A.w / 2 + 2, 13, A.d / 2 + 2);
    roof.position.set(A.x, A.y, A.z);
    group.add(cast(roof));
    // the band of light round the eaves
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(A.w / 2 + 2.2, A.d / 2 + 2.2, 60);
    ring.position.set(A.x, A.y + 0.4, A.z);
    group.add(ring);
    updates.push((t, night) => {
      const k = 0.15 + night * 3;
      ringMat.color.setRGB(1.0 * k, 0.25 * k, 0.12 * k);
    });
    solids.push({ ...boxSolid(A.x, A.z, A.w * 0.7, A.d * 0.7, 0, A.y, A.y + 12) });
  }

  // ---------------------------------------------------------------- PAMM: the canopy and the gardens
  if (L.pamm) {
    const P = L.pamm;
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xa47c56, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.9 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(P.w, 1.4, P.d), [top, top, top, wood, top, top]);
    canopy.position.set(P.x, P.y, P.z);
    g.add(canopy);
    // the louvres under it (timber slats)
    for (let x = -P.w / 2 + 2; x < P.w / 2; x += 2.2) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, P.d - 2), wood);
      slat.position.set(P.x + x, P.y - 1, P.z);
      g.add(slat);
    }
    const col = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.6 });
    for (let i = 0; i < 26; i++) {
      const x = P.x + (R() - 0.5) * P.w * 0.9, z = P.z + (R() - 0.5) * P.d * 0.9;
      const lean = (R() - 0.5) * 0.25;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, P.y, 8), col);
      c.position.set(x, P.y / 2, z);
      c.rotation.z = lean;
      g.add(c);
    }
    // the hanging gardens: tall cylinders of planting dangling from the canopy
    const green = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 1 });
    for (let i = 0; i < 18; i++) {
      const x = P.x + (R() - 0.5) * P.w * 0.95, z = P.z + (R() < 0.5 ? -1 : 1) * (P.d / 2 - 4 - R() * 10);
      const len = 6 + R() * 7;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.0 + R() * 0.5, 0.7, len, 10, 4), green);
      // shaggy: push the vertices about
      const pos = cyl.geometry.getAttribute('position');
      for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * (0.85 + R() * 0.35), pos.getY(k), pos.getZ(k) * (0.85 + R() * 0.35));
      cyl.geometry.computeVertexNormals();
      cyl.position.set(x, P.y - 0.7 - len / 2, z);
      g.add(cyl);
    }
    group.add(cast(g));
    solids.push(boxSolid(P.x, P.z, P.w, P.d, 0, P.y - 1.2, P.y + 0.8));
  }

  // ---------------------------------------------------------------- Frost: the sphere and the cone
  if (L.frost) {
    const F = L.frost;
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = 512;
      cv.height = 256;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#f1f1ee';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = '#c3c6c8';
      g.lineWidth = 2;
      for (let i = 0; i < 32; i++) {
        g.beginPath();
        g.moveTo((i / 32) * 512, 0);
        g.lineTo((i / 32) * 512, 256);
        g.stroke();
      }
      for (let j = 0; j < 16; j++) {
        g.beginPath();
        g.moveTo(0, (j / 16) * 256);
        g.lineTo(512, (j / 16) * 256);
        g.stroke();
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(F.r, 48, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.15 }));
    sphere.position.set(F.x, F.y, F.z);
    group.add(cast(sphere));
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(13, 5, 16, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x8fb7c4, roughness: 0.25, metalness: 0.4, side: THREE.DoubleSide }));
    cone.position.set(F.x - 34, 24 + 8, F.z + 8);
    group.add(cast(cone));
    solids.push({ poly: [], circle: F.r, y0: F.y - F.r, y1: F.y + F.r, cx: F.x, cz: F.z, r: F.r, kind: 'building' });
  }

  // ---------------------------------------------------------------- SkyViews, the wheel at Bayside
  if (L.bayside) {
    const B = L.bayside;
    // on the bay edge, east of the pavilions
    let wx = B.x + 60;
    for (let x = B.x; x < B.x + 400; x += 4) {
      if (!mask.land(x, B.z + 40)) {
        wx = x - 16;
        break;
      }
    }
    const wz = B.z + 40;
    const Rw = 28, hubY = Rw + 6;
    const wheel = new THREE.Group();
    wheel.position.set(wx, hubY, wz);
    // the wheel turns about the east-west axis (its face to the city and the bay)
    const spin = new THREE.Group();
    spin.rotation.y = Math.PI / 2;
    wheel.add(spin);
    const rot = new THREE.Group();
    spin.add(rot);
    const steel = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.6, roughness: 0.35 });
    for (const zz of [-1.2, 1.2]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(Rw, 0.35, 8, 96), steel);
      rim.position.z = zz;
      rot.add(rim);
    }
    const spokes = 24;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      for (const zz of [-1.2, 1.2]) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, Rw, 4), steel);
        sp.position.set((Math.cos(a) * Rw) / 2, (Math.sin(a) * Rw) / 2, zz * 0.5);
        sp.rotation.z = a - Math.PI / 2;
        rot.add(sp);
      }
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4, 16), steel);
    hub.rotation.x = Math.PI / 2;
    rot.add(hub);
    // the LED ring
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const led = new THREE.Mesh(new THREE.TorusGeometry(Rw + 0.4, 0.18, 6, 128), ledMat);
    rot.add(led);
    // the gondolas: they hang level as the wheel turns (two instanced meshes, set each frame)
    const gMat = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.3, metalness: 0.2 });
    const gGlass = new THREE.MeshStandardMaterial({ color: 0x17303c, roughness: 0.05, metalness: 0.6 });
    const nG = 30;
    const podGeo = new THREE.CapsuleGeometry(1.1, 1.6, 4, 10);
    podGeo.rotateZ(Math.PI / 2);
    podGeo.translate(0, -1.6, 0);
    const roofGeo = new THREE.BoxGeometry(3.6, 0.3, 2.4);
    roofGeo.translate(0, -0.4, 0);
    const pods = new THREE.InstancedMesh(podGeo, gGlass, nG);
    const roofs = new THREE.InstancedMesh(roofGeo, gMat, nG);
    for (const im of [pods, roofs]) {
      im.frustumCulled = false;
      im.castShadow = true;
      rot.add(im);
    }
    const gm = new THREE.Matrix4(), gq = new THREE.Quaternion(), gp = new THREE.Vector3(), g1 = new THREE.Vector3(1, 1, 1), gz = new THREE.Vector3(0, 0, 1);
    const setGondolas = (a: number) => {
      gq.setFromAxisAngle(gz, -a);
      for (let i = 0; i < nG; i++) {
        const b = (i / nG) * Math.PI * 2;
        gm.compose(gp.set(Math.cos(b) * Rw, Math.sin(b) * Rw, 0), gq, g1);
        pods.setMatrixAt(i, gm);
        roofs.setMatrixAt(i, gm);
      }
      pods.instanceMatrix.needsUpdate = true;
      roofs.instanceMatrix.needsUpdate = true;
    };
    setGondolas(0);
    // the legs: an A-frame each side
    for (const zz of [-1, 1]) {
      for (const xx of [-1, 1]) {
        const a = V(0, 0, zz * 1.6);
        const b = V(xx * 16, -hubY, zz * 7);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, a.distanceTo(b), 8), steel);
        leg.position.copy(a).add(b).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
        spin.add(leg);
      }
    }
    mergeStatic(rot, new Set([pods, roofs, led]));
    group.add(cast(wheel));
    keep.add(rot);
    solids.push({ poly: [], circle: 9, y0: 0, y1: hubY * 2, cx: wx, cz: wz, r: 9, kind: 'building' });
    updates.push((t, night) => {
      const a = t * 0.035;
      rot.rotation.z = a;
      setGondolas(a);
      const hue = (t * 0.05) % 1;
      ledMat.color.setHSL(hue, 0.9, 0.55).multiplyScalar(0.2 + night * 3);
    });
  }

  // ---------------------------------------------------------------- PortMiami: cruise ships
  {
    // the north side of Dodge Island: the cruise terminals
    const berths = [-80.1755, -80.1700, -80.1645, -80.1590];
    const liveries = [
      { band: 0x1d3c8a, funnel: 0xd8202a },
      { band: 0x0b5fa5, funnel: 0x0b5fa5 },
      { band: 0x1a1a1a, funnel: 0xf2c230 },
      { band: 0x2aa6b8, funnel: 0xffffff },
    ];
    berths.forEach((lon, k) => {
      // walk north off the island to the water, then out a ship's half-beam
      const p0 = ll(25.770, lon);
      let z = p0.z;
      // north onto the island, then on north to its far shore
      let i = 0;
      while (i++ < 300 && !mask.land(p0.x, z)) z -= 4;
      let found = false;
      for (; i < 600; i++, z -= 4) {
        if (!mask.land(p0.x, z) && !mask.land(p0.x, z - 30)) {
          found = true;
          break;
        }
      }
      if (!found) return;
      const quayZ = z;
      // the quay's direction from two shore points either side
      const shore = (x: number) => {
        let zz = quayZ + 120;
        for (let k = 0; k < 200; k++, zz -= 4) if (!mask.land(x, zz)) return zz;
        return zz;
      };
      const za = shore(p0.x - 120), zb = shore(p0.x + 120);
      const yaw = Math.atan2(240, zb - za);
      const cx = p0.x, cz = z - 26;
      const ship = buildCruiseShip(liveries[k % liveries.length], 77 + k);
      ship.group.position.set(cx, -1.1, cz);
      ship.group.rotation.y = yaw;
      group.add(cast(ship.group));
      updates.push((_t, night) => ship.setNight(night));
      solids.push(boxSolid(cx, cz, 36, 290, yaw, -2, 18));
      solids.push(boxSolid(cx, cz, 30, 230, yaw, 18, 58));
      // the terminal on the quay behind it: a long glass hall under a white wave of a roof
      const tz = quayZ + 50;
      const term = new THREE.Group();
      term.position.set(cx, 0, tz);
      term.rotation.y = yaw;
      const hall = new THREE.Mesh(new THREE.BoxGeometry(44, 14, 170), new THREE.MeshStandardMaterial({ color: 0x31434e, roughness: 0.08, metalness: 0.7 }));
      hall.position.y = 7;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 176, 24, 1, false, -0.6, 1.2), new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5, side: THREE.DoubleSide }));
      roof.rotation.x = Math.PI / 2;
      roof.rotation.y = Math.PI / 2;
      roof.position.y = 14 - 30 * Math.cos(0.6) + 2;
      const bridgeW = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 26), new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.5 }));
      bridgeW.position.set(0, 16, -34);
      bridgeW.rotation.y = Math.PI / 2;
      term.add(hall, roof, bridgeW);
      group.add(cast(term));
      solids.push(boxSolid(cx, tz, 44, 170, yaw, 0, 18));
    });
  }

  // ---------------------------------------------------------------- PortMiami: cranes and boxes
  {
    const cranes = [-80.1560, -80.1535, -80.1510, -80.1485, -80.1460];
    const craneMat = new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 0.5, roughness: 0.45 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8202a, metalness: 0.4, roughness: 0.45 });
    const house = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6 });
    const yard: { x: number; z: number }[] = [];
    for (const lon of cranes) {
      const p0 = ll(25.7735, lon);
      // the south quay: walk south to the water
      let z = p0.z;
      let found = false;
      for (let i = 0; i < 200; i++, z += 4) {
        if (!mask.land(p0.x, z)) {
          found = true;
          break;
        }
      }
      if (!found) continue;
      const qx = p0.x, qz = z - 14;
      const g = new THREE.Group();
      g.position.set(qx, 0, qz);
      const leg = (x: number, zz: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 46, 1.4), craneMat);
        m.position.set(x, 23, zz);
        g.add(m);
      };
      leg(-9, -12);
      leg(9, -12);
      leg(-9, 12);
      leg(9, 12);
      // portal beams
      for (const zz of [-12, 12]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(20, 2.2, 1.6), craneMat);
        b.position.set(0, 44, zz);
        g.add(b);
      }
      // the boom out over the water (south, +z), the back reach over the yard
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 110), craneMat);
      boom.position.set(0, 48, 18);
      g.add(boom);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1, 24), red);
      stripe.position.set(0, 48, 64);
      g.add(stripe);
      const mh = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 12), house);
      mh.position.set(0, 52, -24);
      g.add(mh);
      const apex = new THREE.Mesh(new THREE.BoxGeometry(1.2, 18, 1.2), craneMat);
      apex.position.set(0, 58, -6);
      g.add(apex);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), red);
      cab.position.set(0, 44.5, 22);
      g.add(cab);
      group.add(cast(g));
      solids.push(boxSolid(qx, qz, 20, 26, 0, 40, 50));
      for (const [x, zz] of [[-9, -12], [9, -12], [-9, 12], [9, 12]]) solids.push({ poly: [], circle: 1, y0: 0, y1: 46, cx: qx + x, cz: qz + zz, r: 1, kind: 'pole' });
      yard.push({ x: qx, z: qz - 60 });
    }
    // container stacks behind the cranes
    const boxes: { x: number; y: number; z: number; c: THREE.Color }[] = [];
    const cols = [0xc8202a, 0x1f5bd6, 0x2b8a3e, 0xe8a317, 0x7a7f86, 0xf2f2f2, 0x9a3d2a, 0x0b6b7a];
    for (const y0 of yard) {
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 4; c++) {
          const x = y0.x - 18 + c * 13, z = y0.z - r * 3.2;
          if (!mask.land(x - 7, z) || !mask.land(x + 7, z)) continue;
          const h = 1 + Math.floor(R() * 4);
          for (let k = 0; k < h; k++) boxes.push({ x, y: 1.3 + k * 2.6, z, c: new THREE.Color(cols[Math.floor(R() * cols.length)]) });
        }
    }
    if (boxes.length) {
      const geo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 }), boxes.length);
      const m4 = new THREE.Matrix4();
      boxes.forEach((b, i) => {
        im.setMatrixAt(i, m4.makeTranslation(b.x, b.y, b.z));
        im.setColorAt(i, b.c);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // ---------------------------------------------------------------- South Beach lifeguard towers
  {
    const hut = new THREE.BoxGeometry(3.4, 2.6, 3.0);
    hut.translate(0, 4.3, 0);
    const roofG = new THREE.ConeGeometry(2.8, 1.4, 4);
    roofG.rotateY(Math.PI / 4);
    roofG.translate(0, 6.3, 0);
    const deckG = new THREE.BoxGeometry(5, 0.25, 4.4);
    deckG.translate(0, 2.9, 0);
    const stiltG = new THREE.CylinderGeometry(0.12, 0.12, 3, 6);
    stiltG.translate(0, 1.5, 0);
    const rampG = new THREE.BoxGeometry(1.4, 0.15, 6.5);
    rampG.rotateX(0.42);
    rampG.translate(0, 1.45, -5.2);
    const towers: { x: number; z: number; yaw: number; c: THREE.Color; r: THREE.Color }[] = [];
    const pastel = [0xf26d8f, 0x5ad1c4, 0xffcf4a, 0x8f7cf2, 0xff8a4c, 0x4cc3ff, 0x9be15d, 0xff5fd2];
    const z0 = ll(25.7965, 0).z, z1 = ll(25.7690, 0).z;
    for (let z = z0; z < z1; z += 150 + R() * 40) {
      const x = beachX(z) - 38 - R() * 8;
      if (!mask.land(x, z)) continue;
      towers.push({ x, z, yaw: Math.PI / 2 + (R() - 0.5) * 0.3, c: new THREE.Color(pastel[Math.floor(R() * pastel.length)]), r: new THREE.Color(pastel[Math.floor(R() * pastel.length)]) });
    }
    if (towers.length) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1), p = V(0, 0, 0), e = new THREE.Euler();
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, colorOf?: (t: (typeof towers)[number]) => THREE.Color) => {
        const im = new THREE.InstancedMesh(geo, mat, towers.length);
        towers.forEach((t, i) => {
          q.setFromEuler(e.set(0, t.yaw, 0));
          im.setMatrixAt(i, m4.compose(p.set(t.x, 0.1, t.z), q, one));
          if (colorOf) im.setColorAt(i, colorOf(t));
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      };
      const paint = new THREE.MeshStandardMaterial({ roughness: 0.6 });
      const whiteWood = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 });
      mk(hut, paint, (t) => t.c);
      mk(roofG, paint, (t) => t.r);
      mk(deckG, whiteWood);
      mk(rampG, whiteWood);
      // four stilts: four instanced meshes offset
      for (const [sx, sz] of [[-2, -1.8], [2, -1.8], [-2, 1.8], [2, 1.8]]) {
        const g2 = stiltG.clone();
        g2.translate(sx, 0, sz);
        mk(g2, whiteWood);
      }
    }
  }

  // ---------------------------------------------------------------- Ocean Drive's neon
  {
    const mats: { m: THREE.MeshStandardMaterial; c: THREE.Color }[] = [];
    for (const s of bld.decoSigns) {
      const tex = neonTexture(s.name, s.color);
      const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x000000, roughness: 0.5 });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, s.h * 0.55, 1.8), [m, m, m, m, m, m]);
      blade.position.set(s.x, s.y + s.h * 0.3, s.z);
      blade.rotation.y = s.yaw - Math.PI / 2;
      group.add(blade);
      mats.push({ m, c: new THREE.Color(s.color) });
    }
    updates.push((t, night) => {
      for (let i = 0; i < mats.length; i++) {
        const { m, c } = mats[i];
        // the odd one flickers
        const fl = i % 5 === 2 && Math.sin(t * 23 + i) > 0.92 ? 0.3 : 1;
        m.emissive.copy(c).multiplyScalar(night * 1.6 * fl);
      }
    });
  }

  // one draw per material for everything that stands still
  mergeStatic(group, keep);
  return {
    group,
    solids,
    update(t, night) {
      for (const u of updates) u(t, night);
    },
  };
}

/** merge the static single-material meshes under `root` (in root's space), one mesh per material */
function mergeStatic(root: THREE.Object3D, keep: Set<THREE.Object3D>) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const done: THREE.Mesh[] = [];
  let cast = false;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep.has(p)) return;
    let g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    g.morphAttributes = {};
    let l = byMat.get(m.material);
    if (!l) byMat.set(m.material, (l = []));
    l.push(g);
    done.push(m);
    cast ||= m.castShadow;
  });
  for (const m of done) m.removeFromParent();
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/** a ~290 m cruise ship: hull, the stacked decks with their balconies, the funnel, lifeboats, the pool deck */
function buildCruiseShip(liv: { band: number; funnel: number }, seed: number) {
  const group = new THREE.Group();
  const R = rng(seed);
  const L = 290, Bm = 36;
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f7f6, roughness: 0.45 });
  const hullDark = new THREE.MeshStandardMaterial({ color: liv.band, roughness: 0.5 });
  // the hull: a pointed bow, a flat transom (a box with its bow faces brought in)
  const hull = new THREE.BoxGeometry(Bm, 16, L, 1, 2, 12);
  const pos = hull.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), x = pos.getX(i), y = pos.getY(i);
    const f = z / (L / 2);
    // the bow: narrow over the last 18% and rake forward at the top
    if (f > 0.64) {
      const k = (f - 0.64) / 0.36;
      pos.setX(i, x * (1 - k * k * 0.97));
      pos.setZ(i, z + (y + 8) * 0.35 * k);
    }
    if (f < -0.9) pos.setX(i, x * 0.94);
  }
  hull.computeVertexNormals();
  const hullMesh = new THREE.Mesh(hull, white);
  hullMesh.position.y = 8;
  group.add(hullMesh);
  // the dark band along the waterline and the livery stripe
  const band = new THREE.Mesh(hull.clone(), hullDark);
  band.scale.set(1.004, 0.32, 1.002);
  band.position.y = 2.6;
  group.add(band);
  // the superstructure: tiers of balcony decks
  const { td, tn } = shipSideTextures(seed);
  const sideMat = new THREE.MeshStandardMaterial({ map: td, emissiveMap: tn, emissive: 0x000000, roughness: 0.35, metalness: 0.1 });
  const tiers = [
    { y0: 16, h: 18, l: 236, b: Bm - 1, z: -12 },
    { y0: 34, h: 14, l: 210, b: Bm - 4, z: -22 },
    { y0: 48, h: 6, l: 150, b: Bm - 10, z: -30 },
  ];
  for (const t of tiers) {
    const tex = td.clone();
    tex.repeat.set(t.l / 120, t.h / 18);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    const ntex = tn.clone();
    ntex.repeat.copy(tex.repeat);
    ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
    ntex.needsUpdate = true;
    const m = sideMat.clone();
    m.map = tex;
    m.emissiveMap = ntex;
    const box = new THREE.Mesh(new THREE.BoxGeometry(t.b, t.h, t.l), [m, m, white, white, m, m]);
    box.position.set(0, t.y0 + t.h / 2, t.z);
    group.add(box);
    group.userData.sides = [...(group.userData.sides ?? []), m];
  }
  // the bridge wings and the rounded front of the decks
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(Bm + 6, 3, 8), white);
  bridge.position.set(0, 44, 100);
  group.add(bridge);
  const brGlass = new THREE.Mesh(new THREE.BoxGeometry(Bm + 6.1, 1.4, 8.1), new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.05, metalness: 0.7 }));
  brGlass.position.set(0, 44.6, 100);
  group.add(brGlass);
  // the funnel (a raked whale-tail-ish stack in the line's colour)
  const fun = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 16, 16), new THREE.MeshStandardMaterial({ color: liv.funnel, roughness: 0.4 }));
  fun.scale.set(1, 1, 2.2);
  fun.rotation.x = -0.22;
  fun.position.set(0, 60, -92);
  group.add(fun);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 1.6, 16), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }));
  cap.scale.set(1, 1, 2.2);
  cap.rotation.x = -0.22;
  cap.position.set(0, 68, -94);
  group.add(cap);
  // lifeboats along both sides (orange), under the first tier
  const boatMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
  const lb = new THREE.CapsuleGeometry(1.6, 7, 4, 10);
  lb.rotateX(Math.PI / 2);
  for (const sx of [-1, 1])
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(lb, boatMat);
      b.position.set(sx * (Bm / 2 + 1.2), 24, -80 + i * 17);
      group.add(b);
    }
  // the pool deck: pools, the water slides' coloured tubes
  const pool = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 22), new THREE.MeshStandardMaterial({ color: 0x2bb5c8, roughness: 0.05, emissive: 0x0a5a66, emissiveIntensity: 0.3 }));
  pool.position.set(0, 48.2, 10);
  group.add(pool);
  const slideCols = [0xff3f8e, 0xffd84d, 0x3db7ff];
  for (let i = 0; i < 3; i++) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 30; k++) {
      const a = k * 0.45 + i * 2;
      pts.push(V(Math.cos(a) * (6 + i), 70 - k * 0.7, -40 + i * 14 + Math.sin(a) * (6 + i)));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.8, 8), new THREE.MeshStandardMaterial({ color: slideCols[i], roughness: 0.3 }));
    group.add(tube);
  }
  void R;
  const sides = group.userData.sides as THREE.MeshStandardMaterial[];
  return {
    group,
    setNight(n: number) {
      for (const m of sides) m.emissive.setScalar(n * 1.2);
    },
  };
}
