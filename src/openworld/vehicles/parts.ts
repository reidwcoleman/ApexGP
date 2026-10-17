import * as THREE from 'three';
import { latheX } from './loft.ts';

/**
 * Parts every vehicle shares: wheels (tyre with tread and sidewall lettering, rims in a few
 * styles, brake disc and caliper), glass, lamps, the materials, and the cold-gas thruster
 * plume of the SpaceX-package Roadster.
 */

// ------------------------------------------------------------------------------------ textures

let tyreTex: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
/** tyre: u around the circumference, v across (tread in the middle, sidewalls at the edges) */
function tyreTextures() {
  if (tyreTex) return tyreTex;
  const W = 1024, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1a1b';
  g.fillRect(0, 0, W, H);
  // sidewall lettering (one band at each edge): a light grey script, repeated
  g.fillStyle = '#3a3a3c';
  g.font = 'bold 15px Arial';
  for (let i = 0; i < 4; i++) {
    g.fillText('APEX  P ZERO  275/35 R21', i * 256 + 18, 20);
    g.save();
    g.translate(i * 256 + 18, H - 8);
    g.fillText('APEX  P ZERO  275/35 R21', 0, 0);
    g.restore();
  }
  // normal map: tread grooves (circumferential + angled sipes)
  const n = document.createElement('canvas');
  n.width = W;
  n.height = H;
  const h = n.getContext('2d')!;
  h.fillStyle = 'rgb(128,128,255)';
  h.fillRect(0, 0, W, H);
  const groove = (y: number, w: number) => {
    h.fillStyle = 'rgb(128,90,220)';
    h.fillRect(0, y - w / 2, W, w / 2);
    h.fillStyle = 'rgb(128,166,220)';
    h.fillRect(0, y, W, w / 2);
  };
  for (const y of [40, 56, 72, 88]) groove(y, 6);
  h.strokeStyle = 'rgb(100,128,230)';
  h.lineWidth = 2;
  for (let x = 0; x < W; x += 16) {
    h.beginPath();
    h.moveTo(x, 34);
    h.lineTo(x + 8, 52);
    h.moveTo(x + 4, 76);
    h.lineTo(x + 12, 94);
    h.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normal = new THREE.CanvasTexture(n);
  normal.wrapS = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  tyreTex = { map, normal };
  return tyreTex;
}

let discTex: THREE.CanvasTexture | null = null;
function discTexture() {
  if (discTex) return discTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S / 2);
  grd.addColorStop(0, '#2c2c2e');
  grd.addColorStop(0.55, '#77787b');
  grd.addColorStop(1, '#5b5c5f');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // cross-drilling and the machining rings
  g.fillStyle = '#18181a';
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + r * 0.13;
      const rad = S * (0.3 + r * 0.06);
      g.beginPath();
      g.arc(S / 2 + Math.cos(a) * rad, S / 2 + Math.sin(a) * rad, 3, 0, Math.PI * 2);
      g.fill();
    }
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let r = 60; r < 128; r += 3) {
    g.beginPath();
    g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
    g.stroke();
  }
  discTex = new THREE.CanvasTexture(c);
  discTex.colorSpace = THREE.SRGBColorSpace;
  return discTex;
}

// ------------------------------------------------------------------------------------ materials

const cache = new Map<string, THREE.Material>();
const once = <T extends THREE.Material>(k: string, f: () => T): T => {
  let m = cache.get(k) as T | undefined;
  if (!m) cache.set(k, (m = f()));
  return m;
};

export const MAT = {
  rubber: () => once('rubber', () => {
    const t = tyreTextures();
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.88, metalness: 0 });
  }),
  rimSilver: () => once('rimSilver', () => new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1 })),
  rimDark: () => once('rimDark', () => new THREE.MeshPhysicalMaterial({ color: 0x2a2b2e, metalness: 0.85, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.15 })),
  rimSteel: () => once('rimSteel', () => new THREE.MeshStandardMaterial({ color: 0x8a8c90, metalness: 0.7, roughness: 0.45 })),
  disc: () => once('disc', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: discTexture(), metalness: 0.75, roughness: 0.42 })),
  caliperRed: () => once('calRed', () => new THREE.MeshPhysicalMaterial({ color: 0xc8141c, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 })),
  caliperGrey: () => once('calGrey', () => new THREE.MeshStandardMaterial({ color: 0x3c3d40, metalness: 0.5, roughness: 0.45 })),
  blackTrim: () => once('blackTrim', () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.1, roughness: 0.55 })),
  gloss: () => once('gloss', () => new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 })),
  carbon: () =>
    once('carbon', () => {
      const S = 64;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d')!;
      for (let y = 0; y < S; y += 8)
        for (let x = 0; x < S; x += 8) {
          g.fillStyle = (x / 8 + y / 8) % 2 ? '#1c1d20' : '#0d0e10';
          g.fillRect(x, y, 8, 8);
        }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(30, 30);
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 });
    }),
  chrome: () => once('chrome', () => new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1, roughness: 0.05 })),
  interior: () => once('interior', () => new THREE.MeshStandardMaterial({ color: 0x17171a, metalness: 0, roughness: 0.85 })),
  interiorLight: () => once('interiorL', () => new THREE.MeshStandardMaterial({ color: 0xd9d4cc, metalness: 0, roughness: 0.8 })),
  wellLiner: () => once('liner', () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0, roughness: 0.95, side: THREE.DoubleSide })),
  nozzle: () => once('nozzle', () => new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 1, roughness: 0.28 })),
  /** tinted glass that shows the cabin a little: dark from outside, see-through from inside */
  glassDark: () =>
    once('glassDark', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0x0b0f12, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.72, clearcoat: 1, clearcoatRoughness: 0.0, side: THREE.FrontSide });
      m.envMapIntensity = 1.6;
      return m;
    }),
  /** the Roadster's gold visor glass (Apollo-suit visor): a metallic gold mirror from outside */
  glassGold: () =>
    once('glassGold', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0xffd27a, metalness: 0.92, roughness: 0.07, transparent: true, opacity: 0.88, clearcoat: 1, clearcoatRoughness: 0, side: THREE.FrontSide });
      m.envMapIntensity = 1.4;
      return m;
    }),
};

/** an emissive lamp material (one per vehicle so brake lights can be driven) */
export function lampMaterial(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.2, metalness: 0 });
}

/** car paint: clearcoated, a slight metallic flake */
export function paintMaterial(color: THREE.ColorRepresentation, metallic = 0.45, rough = 0.32): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, metalness: metallic, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.035 });
}

// ------------------------------------------------------------------------------------ wheels

export type RimStyle = 'aero' | 'spoke5' | 'multi' | 'steel' | 'truck' | 'mesh';

export interface WheelSpec {
  radius: number;
  width: number;
  rim: number;
  style: RimStyle;
  rimMat?: THREE.Material;
  caliper?: THREE.Material;
  /** spokes count */
  spokes?: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const geo = (k: string, f: () => THREE.BufferGeometry) => {
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = f()));
  return g;
};

/**
 * A wheel: `steer` (rotates about y for steering) holding `spin` (rotates about x) with the tyre
 * and rim; the brake disc spins, the caliper stays with the hub. Built for the left side
 * (outer face toward +x); mirror with `side = -1`.
 */
export function makeWheel(s: WheelSpec, side: 1 | -1): { steer: THREE.Group; spin: THREE.Group } {
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);
  const R = s.radius, W = s.width, r = s.rim;
  const key = `${R.toFixed(3)}:${W.toFixed(3)}:${r.toFixed(3)}`;
  // the tyre: a lathe profile (outer face toward +x)
  const tyre = geo('tyre' + key, () => {
    const hw = W / 2;
    const prof: [number, number][] = [
      [r - 0.005, -hw + 0.02],
      [r + 0.02, -hw],
      [R - 0.045, -hw - 0.006],
      [R - 0.016, -hw + 0.012],
      [R, -hw + 0.04],
      [R, hw - 0.04],
      [R - 0.016, hw - 0.012],
      [R - 0.045, hw + 0.006],
      [r + 0.02, hw],
      [r - 0.005, hw - 0.02],
    ];
    const g = latheX(prof.map(([a, b]) => [a, b]), 48);
    // uv: u around, v across
    const p = g.getAttribute('position');
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getY(i));
      uv[i * 2] = (a / (Math.PI * 2) + 0.5) * 4;
      uv[i * 2 + 1] = (p.getX(i) + hw) / W;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  });
  const tm = new THREE.Mesh(tyre, MAT.rubber());
  tm.castShadow = true;
  spin.add(tm);
  // the rim barrel and lip
  const barrel = geo('barrel' + key, () =>
    latheX(
      [
        [r * 0.55, -W / 2 + 0.03],
        [r - 0.01, -W / 2 + 0.02],
        [r, W / 2 - 0.035],
        [r + 0.012, W / 2 - 0.012],
        [r - 0.006, W / 2 + 0.002],
        [r - 0.03, W / 2 - 0.01],
      ],
      40,
    ),
  );
  const rimMat = s.rimMat ?? MAT.rimSilver();
  const bm = new THREE.Mesh(barrel, rimMat);
  spin.add(bm);
  // the face
  const face = geo(`face:${s.style}:${s.spokes ?? 0}:${key}`, () => rimFace(s));
  const fm = new THREE.Mesh(face, rimMat);
  fm.castShadow = true;
  spin.add(fm);
  // brake disc (inside the rim) and caliper (fixed to the hub: on steer, not spin)
  const disc = geo('disc' + key, () => {
    const g = new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.03, 36, 1);
    g.rotateZ(Math.PI / 2);
    g.translate(-0.02, 0, 0);
    return g;
  });
  spin.add(new THREE.Mesh(disc, MAT.disc()));
  const cal = geo('cal' + key, () => {
    const g = new THREE.BoxGeometry(0.07, 0.16, 0.22);
    g.translate(-0.01, r * 0.66, -0.04);
    return g;
  });
  const cm = new THREE.Mesh(cal, s.caliper ?? MAT.caliperGrey());
  cm.rotation.x = -0.55;
  steer.add(cm);
  if (side < 0) {
    steer.scale.x = -1;
  }
  return { steer, spin };
}

function rimFace(s: WheelSpec): THREE.BufferGeometry {
  const r = s.rim, W = s.width;
  const x0 = W / 2 - 0.03;
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(r * 0.22, r * 0.26, 0.05, 24);
  hub.rotateZ(Math.PI / 2);
  hub.translate(x0 - 0.01, 0, 0);
  parts.push(hub);
  const n = s.spokes ?? (s.style === 'aero' ? 10 : s.style === 'spoke5' ? 5 : s.style === 'multi' ? 7 : s.style === 'truck' ? 6 : 10);
  if (s.style === 'aero') {
    // Tesla-style turbine aero face: a near-flat disc with twisted slots
    const ring = new THREE.RingGeometry(r * 0.24, r * 0.98, 40, 1);
    ring.rotateY(Math.PI / 2);
    ring.translate(x0 - 0.005, 0, 0);
    parts.push(ring);
    for (let i = 0; i < n; i++) {
      const b = new THREE.BoxGeometry(0.02, r * 0.68, 0.035);
      b.translate(0, r * 0.6, 0);
      b.rotateY(0.25);
      b.rotateX((i / n) * Math.PI * 2);
      b.translate(x0 + 0.004, 0, 0);
      parts.push(b);
    }
  } else if (s.style === 'steel') {
    const ring = new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.02, 32, 1, true);
    ring.rotateZ(Math.PI / 2);
    ring.translate(x0 - 0.03, 0, 0);
    parts.push(ring);
    const disc = new THREE.RingGeometry(r * 0.25, r * 0.95, 32);
    disc.rotateY(Math.PI / 2);
    disc.translate(x0 - 0.04, 0, 0);
    parts.push(disc);
  } else {
    // spokes: pairs for 'multi', wide for 'spoke5', chunky for 'truck', fine lattice for 'mesh'
    const pair = s.style === 'multi';
    const wide = s.style === 'spoke5' ? 0.075 : s.style === 'truck' ? 0.09 : s.style === 'mesh' ? 0.018 : 0.04;
    const count = s.style === 'mesh' ? 20 : n;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      for (const off of pair ? [-0.12, 0.12] : [0]) {
        const b = new THREE.BoxGeometry(0.045, r * 0.76, wide);
        b.translate(0, r * 0.6, 0);
        // dish: the spoke leans in toward the hub
        b.rotateZ(0.08);
        b.rotateX(a + off);
        b.translate(x0 - 0.02, 0, 0);
        parts.push(b);
      }
    }
  }
  return mergeBasic(parts);
}

/** merge geometries keeping only position + normal */
export function mergeBasic(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (let g of parts) {
    if (!g.getIndex()) g = g.toNonIndexed();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** a wheel-well liner: the dark half-drum inside an arch (left side, outer face +x) */
export function wellLiner(z: number, y: number, r: number, x0: number, x1: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, x1 - x0, 24, 1, true, -0.25, Math.PI + 0.5);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  return new THREE.Mesh(g, MAT.wellLiner());
}

// ------------------------------------------------------------------------------------ thrusters

/** a cold-gas nozzle bell, pointing along +y (orient it after) */
export function nozzleGeometry(scale = 1): THREE.BufferGeometry {
  return geo('nozzle' + scale, () => {
    const pts = [
      [0.045, 0.06],
      [0.03, 0.03],
      [0.026, 0.0],
      [0.04, -0.035],
      [0.065, -0.07],
      [0.07, -0.075],
    ].map(([r, y]) => new THREE.Vector2(r * scale, y * scale));
    const g = new THREE.LatheGeometry(pts, 20);
    g.computeVertexNormals();
    return g;
  });
}

const PLUME_V = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * normal );
  vFace = abs( dot( n, normalize( -mv.xyz ) ) );
  gl_Position = projectionMatrix * mv;
}`;
const PLUME_F = /* glsl */ `
uniform float uThrust;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying float vFace;
float hh( float x ) { return fract( sin( x * 91.7 + uSeed ) * 43758.5 ); }
void main() {
  // v: 0 at the nozzle, 1 at the plume's end
  float v = vUv.y;
  // shock diamonds near the nozzle, turbulent condensate further out
  float diamonds = 0.5 + 0.5 * sin( v * 38.0 - uTime * 60.0 );
  float flick = 0.75 + 0.25 * hh( floor( uTime * 40.0 ) + v * 3.0 );
  float core = pow( vFace, 2.0 ) * ( 1.0 - v ) * ( 0.7 + 0.3 * diamonds * ( 1.0 - v ) );
  float a = core * flick * uThrust;
  vec3 c = mix( vec3( 0.75, 0.85, 1.0 ), vec3( 1.0 ), v );
  gl_FragColor = vec4( c * a * 0.9, a * 0.35 );
}`;

/** the visible cold-gas jet: a cone with an additive, flickering shader (length scales with thrust) */
export function plumeMesh(len: number, radius: number): { mesh: THREE.Mesh; u: { uThrust: { value: number }; uTime: { value: number } } } {
  const g = geo(`plume${len}:${radius}`, () => {
    const c = new THREE.CylinderGeometry(radius * 0.35, radius, len, 16, 6, true);
    // uv.y 0 at the nozzle end (top), 1 at the far end
    c.translate(0, -len / 2, 0);
    const uv = c.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    return c;
  });
  const u = { uThrust: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 } };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: PLUME_V,
    fragmentShader: PLUME_F,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9000;
  return { mesh, u };
}
