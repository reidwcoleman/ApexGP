import type { FlareSpec } from './shared.ts';
import { buildLand, sway, type TerrainInfo } from './terrain.ts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LF, applyLF, roomGlass } from './lighting.ts';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, type Box } from './collide.ts';
import { dress } from './dress.ts';
import { Grass } from './grass.ts';
import type { SunInfo } from './sun.ts';

export const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'lastframe/';
/** which map this page is on: picking another reloads the page, so nothing has to be torn down */
const MAP_Q = new URLSearchParams(location.search).get('map');
/** the hospital opens the game; the supermarket is a pick away */
export const DEFAULT_MAP = 'ward';
/** every location is played indoors for now: the cove (out in the open) is kept but not offered, and ?map=cove opens the hospital */
export const OUTDOOR = false;
export const MAP_ID: 'ward' | 'store' = MAP_Q === 'store' ? 'store' : 'ward';
/** the map's own files; textures, guns and gear are shared */
export const MB = BASE + MAP_ID + '/';

/** kit material -> [scan, metres per tile, tint, roughness] for the world-space projection */
const TRIPLANAR: Record<string, [string, number, number[], number]> = {
  lfmud: ['brown_mud_02', 3.2, [0.6, 0.54, 0.48], 0.6],
  lfmud2: ['brown_mud_02', 2.6, [0.46, 0.41, 0.36], 0.35],
  lfrust: ['rusty_metal_02', 1.6, [0.42, 0.34, 0.29], 0.75],
  lfrust2: ['rusty_metal_02', 1.2, [0.3, 0.25, 0.22], 0.8],
  // sacking, caked with the mud it's full of
  lfburlap: ['brown_mud_02', 0.9, [0.62, 0.52, 0.36], 0.95],
  lfburlap2: ['brown_mud_02', 0.8, [0.5, 0.42, 0.3], 0.95],
  lfduck: ['wood_planks_dirt', 1.4, [0.62, 0.55, 0.48], 0.75],
  lfstake: ['wood_planks_dirt', 1.2, [0.5, 0.44, 0.38], 0.8],
  lfwattle: ['wood_planks_dirt', 0.6, [0.42, 0.34, 0.26], 0.9],
  // the shop's fittings: painted steel gone dull, cardboard, labels faded and scuffed, what rotted
  lfshelf: ['painted_plaster_wall', 0.9, [0.86, 0.97, 0.94], 0.6],
  lfshelfd: ['painted_plaster_wall', 0.9, [0.29, 0.35, 0.39], 0.65],
  lfwhitep: ['painted_plaster_wall', 1.3, [1.0, 1.16, 1.16], 0.45],
  lflabo: ['painted_plaster_wall', 0.45, [1.19, 0.54, 0.11], 0.7],
  lflabp: ['painted_plaster_wall', 0.45, [0.48, 0.19, 0.78], 0.7],
  lflabt: ['painted_plaster_wall', 0.45, [0.12, 0.73, 0.75], 0.7],
  lflabk: ['painted_plaster_wall', 0.45, [0.07, 0.08, 0.10], 0.7],
  lflabc: ['painted_plaster_wall', 0.45, [1.31, 1.30, 0.94], 0.7],
  lflabn: ['painted_plaster_wall', 0.45, [0.48, 0.30, 0.14], 0.7],
  lflabm: ['painted_plaster_wall', 0.45, [1.07, 0.16, 0.44], 0.7],
  lflabr: ['painted_plaster_wall', 0.45, [0.81, 0.14, 0.11], 0.7],
  lflabb: ['painted_plaster_wall', 0.45, [0.14, 0.35, 0.83], 0.7],
  lflabg: ['painted_plaster_wall', 0.45, [0.17, 0.59, 0.25], 0.7],
  lflaby: ['painted_plaster_wall', 0.45, [1.07, 0.95, 0.19], 0.7],
  lflabw: ['painted_plaster_wall', 0.45, [1.19, 1.35, 1.28], 0.7],
  lfbluesteel: ['painted_plaster_wall', 0.8, [0.17, 0.35, 0.72], 0.6],
  lforange: ['painted_plaster_wall', 0.8, [1.2, 0.54, 0.125], 0.6],
  lfcardb: ['damaged_plaster', 0.8, [0.8, 0.74, 0.59], 0.92],
  lfcardb2: ['damaged_plaster', 0.8, [1.0, 1.0, 0.82], 0.92],
  lfwrap: ['painted_plaster_wall', 0.7, [0.95, 1.0, 0.92], 0.38],
  lfrot: ['brown_mud_02', 0.5, [1.0, 0.9, 0.7], 0.9],
  lfrot2: ['brown_mud_02', 0.5, [1.8, 1.6, 1.1], 0.85],
  lfmould: ['mossy_stone_wall', 0.4, [2.0, 3.0, 3.0], 1.0],
  lfboard: ['wood_planks_dirt', 0.55, [0.82, 0.8, 0.78], 0.8],
  lfgalv: ['concrete_pavement_02', 1.2, [1.25, 1.5, 1.9], 0.5],
};

/**
 * Packaging is printed: on anything upright a block of small type in rows, broken into words, and on some a band of
 * another ink across the top. Laid out in hand-sized cells of the world so no two facings carry the same, and gone to
 * its average tone before the lines get finer than a pixel.
 */
const PRINT = /* glsl */ `{
  vec3 pan = abs( normalize( vTriN ) );
  if ( pan.y < 0.7 ) {
    vec2 pu = pan.x > pan.z ? vTriP.zy : vTriP.xy;
    float pfw = max( fwidth( pu.x ), fwidth( pu.y ) );
    float pseen = clamp( 1.0 - pfw / 0.0045, 0.0, 1.0 );
    vec2 pc = pu / vec2( 0.11, 0.075 );
    vec2 pb = floor( pc ), pf = fract( pc );
    float ph = fract( sin( dot( pb, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ), ph2 = fract( ph * 37.7 );
    float prow = floor( pf.y * 8.0 );
    float pline = step( 0.42, fract( pf.y * 8.0 ) );
    float pword = step( fract( sin( dot( vec2( floor( pf.x * 18.0 ), prow ) + pb * 7.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ), 0.64 );
    float prows = step( 0.12, pf.x ) * step( pf.x, 0.9 ) * step( 0.5, prow ) * step( prow, 1.5 + floor( ph * 4.0 ) );
    float pband = step( 0.5, ph2 ) * step( 0.74, pf.y ) * step( pf.y, 0.93 );
    vec3 pink = ph > 0.45 ? diffuseColor.rgb * 0.28 : mix( diffuseColor.rgb, vec3( 0.62, 0.6, 0.55 ), 0.8 );
    vec3 pink2 = ph2 > 0.75 ? diffuseColor.rgb * 0.4 : mix( diffuseColor.rgb, vec3( 0.6, 0.58, 0.5 ), 0.6 );
    float pk = pline * pword * prows * 0.85;
    diffuseColor.rgb = mix( diffuseColor.rgb, pink, mix( prows * 0.3, pk, pseen ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, pink2, pband * 0.75 * mix( 0.5, 1.0, pseen ) );
  }
}`;

const WELD_CELL = 40;
interface Weld {
  mat: THREE.Material;
  small: boolean;
  parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4; tint: number[] }[];
}
/** many small meshes of one material, in place, as one: positions and normals in the world's own space, each one's tint in its colours */
function weld(w: Weld) {
  let nv = 0, ni = 0;
  for (const p of w.parts) {
    nv += p.geo.attributes.position.count;
    ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const useColor = (w.mat as THREE.MeshStandardMaterial).vertexColors;
  const useUv = w.parts.some((p) => !!p.geo.attributes.uv);
  const pos = new Float32Array(nv * 3), nor = new Int16Array(nv * 4), colr = useColor ? new Uint8Array(nv * 4) : null, uvs = useUv ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const p of w.parts) {
    const P = p.geo.attributes.position, N = p.geo.attributes.normal, C = p.geo.attributes.color, U = p.geo.attributes.uv;
    nm.getNormalMatrix(p.m);
    const n = P.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(p.m);
      const o = (vo + i) * 3;
      pos[o] = v.x;
      pos[o + 1] = v.y;
      pos[o + 2] = v.z;
      if (N) {
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        const k = (vo + i) * 4;
        nor[k] = Math.round(v.x * 32767);
        nor[k + 1] = Math.round(v.y * 32767);
        nor[k + 2] = Math.round(v.z * 32767);
      }
      if (colr) {
        const k = (vo + i) * 4;
        colr[k] = Math.min(255, Math.round((C ? C.getX(i) : 1) * p.tint[0] * 255));
        colr[k + 1] = Math.min(255, Math.round((C ? C.getY(i) : 1) * p.tint[1] * 255));
        colr[k + 2] = Math.min(255, Math.round((C ? C.getZ(i) : 1) * p.tint[2] * 255));
        colr[k + 3] = 255;
      }
      if (uvs && U) {
        uvs[(vo + i) * 2] = U.getX(i);
        uvs[(vo + i) * 2 + 1] = U.getY(i);
      }
    }
    // a mirrored module is inside out until its triangles are turned round
    const flip = p.m.determinant() < 0;
    const I = p.geo.index, c = I ? I.count : n;
    for (let i = 0; i < c; i += 3) {
      const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, d = I ? I.getX(i + 2) : i + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? d : b);
      idx[io++] = vo + (flip ? b : d);
    }
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 4, true));
  if (colr) g.setAttribute('color', new THREE.BufferAttribute(colr, 4, true));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, w.mat);
  mesh.matrixAutoUpdate = false;
  mesh.name = 'weld';
  return mesh;
}

/** a map sampled from world position, blended over the three axes by the surface's facing */
function triplanar(m: THREE.MeshStandardMaterial, scale: number, local = false, print = false) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriP;\nvarying vec3 vTriN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 triP = vec4( transformed, 1.0 );
        vec3 triN = objectNormal;
        #ifdef USE_INSTANCING
          triP = instanceMatrix * triP;
          triN = mat3( instanceMatrix ) * triN;
        #endif
        vTriP = ${local ? 'triP.xyz' : '( modelMatrix * triP ).xyz'};
        vTriN = ${local ? 'triN' : 'mat3( modelMatrix ) * triN'};`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriP;\nvarying vec3 vTriN;')
      .replace(
        '#include <map_fragment>',
        `vec3 triW = pow( abs( normalize( vTriN ) ), vec3( 4.0 ) );
        triW /= triW.x + triW.y + triW.z + 1e-5;
        vec3 tq = vTriP / ${scale.toFixed(2)};
        vec4 triC = texture2D( map, tq.zy ) * triW.x + texture2D( map, tq.xz ) * triW.y + texture2D( map, tq.xy ) * triW.z;
        diffuseColor *= triC;
        ${print ? PRINT : ''}`,
      );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + '|tri' + scale + (local ? 'L' : '') + (print ? 'P' : '');
}

export interface MapData {
  mats: { mat: string; verts: number; tris: number; pos: number; nor: number; uv: number; lm: number; idx: number }[];
  materials: Record<string, { tex: string; scale: number; tint: number[]; rough: number; wet: number; metal: number; nrm: number; emit: number[] | null; mono?: number }>;
  textures: string[];
  colliders: [number, number, number, number, number, number, number, string, string][];
  props: { id: string; pos: number[]; rot: number; s: number; tilt?: number; loose?: { kg: number; surf: string; shape: string; half: number[] } }[];
  doors: { axis: string; hinge: number[]; w: number; h: number; sign: number; swing: number; kind: string; t: number }[];
  glass: { axis: string; c: number; a: number; b: number; z0: number; z1: number }[];
  spawns: { a: number[][]; b: number[][]; ffa: number[][] };
  hold: number[][];
  zones: { a: number[]; b: number[]; kind: string }[];
  lights: { kind: string; pos: number[]; color: number[]; power: number; flicker?: number; size?: number[]; reach?: number; aim?: number[] }[];
  rooms: { name: string; a: number[]; b: number[] }[];
  lm: { logr: number; k: number; size: number };
  /** facade modules: id, where, and which tile of the second lightmap (none: a far building) */
  units: { id: string; pos: number[]; rot: number; sc: number[]; tint: number[]; tile?: number[]; float?: number }[];
  /** a map on real ground */
  terrain?: TerrainInfo;
  /** planted things: no collision, no lightmap */
  veg?: { id: string; pos: number[]; rot: number; s: number }[];
  /** the volume capture's grid, where it isn't the block's */
  volume?: { step: number[]; min: number[]; dim: number[] };
  /** a map in the dark: lights start on, old blood on the walls */
  night?: number;
  stains?: number[][];
  weather?: { key?: number; day?: number; shade?: number[]; rain: number; wet: number; fog: number; sky: number[]; wb: number[]; sun?: SunInfo; dim?: number; sunK?: number; skyTint?: number[]; expMax?: number; sat?: number };
  /** what spawns face, and the shot behind the menu */
  centre?: number[];
  attract?: number[][];
  /** star shells over an open field */
  flares?: FlareSpec | null;
  /** each side has its own ground: spawns stay on it, and the sides swap round now and then */
  sides?: number;
}

/** a lamp that comes and goes: how far down it is now (k), and when it next changes its mind */
export interface Flicker {
  l: MapData['lights'][number];
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
  k: number;
  t: number;
  off: number;
  /** the thing that glows */
  mesh: THREE.Mesh;
  /** shot out: dark until the next match. dying is the last sputter on the way */
  dead: boolean;
  dying: number;
  /** a tube lies along x or z: half its length each way, for whoever is aiming at it */
  half: [number, number];
}

/** a steel door's little window: wired glass gone grey with dirt */
const DOOR_GLASS = applyLF(new THREE.MeshStandardMaterial({ color: 0x1c2224, roughness: 0.15, metalness: 0.2 }));

export class Door {
  want = 0;
  dir = 1;
  /** radians off the frame, and how fast */
  ang = 0;
  w = 0;
  moving = true;
  readonly pivot = new THREE.Group();
  readonly box: Box;
  readonly centre = new THREE.Vector3();
  readonly width: number;
  readonly height: number;
  readonly alongX: boolean;
  readonly leafCentre = new THREE.Vector3();
  readonly leafQuat = new THREE.Quaternion();
  /** it hit its frame or its stop */
  onThud: ((d: Door, v: number) => void) | null = null;
  private axisRot: number;
  private sign: number;
  private up = new THREE.Vector3(0, 1, 0);
  constructor(readonly id: number, private d: MapData['doors'][number], mat: THREE.Material, handle: THREE.Material) {
    const [hx, hy, hz] = d.hinge;
    this.width = d.w;
    this.height = d.h;
    this.sign = d.sign;
    this.alongX = d.axis === 'x';
    this.pivot.position.set(hx, hy, hz);
    const g = new THREE.BoxGeometry(d.w - 0.02, d.h - 0.02, d.t);
    g.translate((d.w / 2) * d.sign, d.h / 2, 0);
    // along x in the map runs along +x in the world; along y (north) runs along -z
    this.axisRot = this.alongX ? 0 : Math.PI / 2;
    const leaf = new THREE.Mesh(g, mat);
    const inner = new THREE.Group();
    inner.rotation.y = this.axisRot;
    inner.add(leaf);
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10), handle);
      k.rotation.x = Math.PI / 2;
      k.position.set((d.w - 0.1) * d.sign, 1.02, s * (d.t / 2 + 0.05));
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.02), handle);
      l.position.set((d.w - 0.16) * d.sign, 1.02, s * (d.t / 2 + 0.09));
      inner.add(k, l);
    }
    // what a used door has: hinges, a kick plate scuffed by boots, raised panels on a wooden one, a wired window in a steel one
    const metal: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [];
    const part = (list: THREE.BufferGeometry[], w: number, h: number, t: number, x: number, y: number, z: number) => {
      const b = new THREE.BoxGeometry(w, h, t);
      b.translate(x * d.sign, y, z);
      list.push(b);
    };
    for (const y of [0.24, d.h * 0.5, d.h - 0.24]) {
      const c = new THREE.CylinderGeometry(0.011, 0.011, 0.1, 8);
      c.translate(0.004 * d.sign, y, 0);
      metal.push(c);
    }
    const steel = d.kind === 'steel';
    for (const s of [-1, 1]) {
      const z = s * (d.t / 2 + 0.002);
      part(metal, d.w - 0.12, 0.22, 0.004, d.w / 2, 0.14, z);
      if (!steel) {
        // two panels, each a frame of mouldings standing proud of the leaf
        for (const [y0, y1] of [[0.38, 0.95], [1.15, d.h - 0.14]] as const) {
          const zz = s * (d.t / 2 + 0.005);
          part(wood, d.w - 0.24, 0.035, 0.01, d.w / 2, y0, zz);
          part(wood, d.w - 0.24, 0.035, 0.01, d.w / 2, y1, zz);
          part(wood, 0.035, y1 - y0, 0.01, 0.12, (y0 + y1) / 2, zz);
          part(wood, 0.035, y1 - y0, 0.01, d.w - 0.12, (y0 + y1) / 2, zz);
        }
      } else {
        part(metal, 0.26, 0.04, 0.012, d.w / 2, 1.18, z);
        part(metal, 0.26, 0.04, 0.012, d.w / 2, 1.74, z);
        part(metal, 0.04, 0.6, 0.012, d.w / 2 - 0.13, 1.46, z);
        part(metal, 0.04, 0.6, 0.012, d.w / 2 + 0.13, 1.46, z);
      }
    }
    inner.add(new THREE.Mesh(mergeGeometries(metal), handle));
    if (wood.length) inner.add(new THREE.Mesh(mergeGeometries(wood), mat));
    if (steel) {
      const pane = new THREE.BoxGeometry(0.22, 0.52, d.t + 0.004);
      pane.translate((d.w / 2) * d.sign, 1.46, 0);
      inner.add(new THREE.Mesh(pane, DOOR_GLASS));
    }
    this.pivot.add(inner);
    this.box = { min: [hx, hy, hz], max: [hx, hy + d.h, hz], pen: true, tag: 'door', mat: 'door', id, slab: { x: hx, z: hz, ux: 1, uz: 0, len: d.w, t: 0.045 }, bump: (px, pz, vx, vz) => this.bump(px, pz, vx, vz) };
    this.place();
    const s = this.box.slab!;
    this.centre.set(hx + s.ux * d.w * 0.5, hy + 1, hz + s.uz * d.w * 0.5);
  }

  /** the leaf's own frame and bounds, from the angle */
  private place() {
    const phi = this.axisRot + this.ang;
    const ux = Math.cos(phi) * this.sign, uz = -Math.sin(phi) * this.sign;
    const b = this.box, s = b.slab!;
    s.ux = ux;
    s.uz = uz;
    const [hx, hy, hz] = this.d.hinge;
    const ex = hx + ux * this.width, ez = hz + uz * this.width, t = s.t + 0.01;
    b.min = [Math.min(hx, ex) - t, hy, Math.min(hz, ez) - t];
    b.max = [Math.max(hx, ex) + t, hy + this.height, Math.max(hz, ez) + t];
    this.leafCentre.set(hx + ux * this.width * 0.5, hy + this.height * 0.5, hz + uz * this.width * 0.5);
    this.leafQuat.setFromAxisAngle(this.up, phi);
    this.pivot.rotation.y = this.ang;
  }

  /** where the leaf wants to be: -dir*sign means dir>0 swings toward +z (or +x) */
  private target() {
    return this.want > 0 ? -this.dir * this.sign * 1.72 : 0;
  }

  /** swing away from whoever opened it */
  toggle(from: THREE.Vector3 | null, force?: number) {
    if (force !== undefined) {
      this.want = force ? 1 : 0;
      if (force) this.dir = force;
      return;
    }
    if (this.want > 0) {
      this.want = 0;
      return;
    }
    this.want = 1;
    if (from) {
      const side = this.alongX ? Math.sign(from.z - this.centre.z) : Math.sign(from.x - this.centre.x);
      this.dir = -(side || 1);
    }
  }

  /** a force at the leaf, as a change of swing speed */
  kick(dw: number) {
    this.w += dw;
    this.moving = true;
  }

  /** how a push along (vx, vz), a fraction of the way along the leaf, turns it */
  private turn(vx: number, vz: number) {
    const phi = this.axisRot + this.ang;
    return this.sign * (-Math.sin(phi) * vx - Math.cos(phi) * vz);
  }

  /** a round through the leaf */
  shot(dx: number, dz: number, k: number) {
    if (this.ang === 0 && this.want === 0) return;
    this.kick(this.turn(dx, dz) * k);
  }

  private bump(_px: number, _pz: number, vx: number, vz: number) {
    if (this.ang === 0 && this.want === 0) return;
    this.kick(this.turn(vx, vz) * 0.14);
  }

  blown(dir: number, k: number) {
    this.want = 1;
    this.dir = dir;
    this.kick(-dir * this.sign * (5 + k * 9));
  }

  update(dt: number) {
    const to = this.target();
    if (!this.moving && to === this.ang) return;
    // a door closer more than a motor: quick to get there, a little overshoot on the stop
    const k = this.want > 0 ? 24 : 15, c = this.want > 0 ? 7 : 5.4;
    const n = 2, h = dt / n;
    for (let i = 0; i < n; i++) {
      this.w += (k * (to - this.ang) - c * this.w) * h;
      const before = this.ang;
      this.ang += this.w * h;
      // the latch: coming back through the frame it stops dead
      if (this.want === 0 && before * this.ang <= 0 && before !== 0) {
        if (Math.abs(this.w) > 0.9) this.onThud?.(this, Math.abs(this.w));
        this.ang = 0;
        this.w = 0;
      }
      const stop = 1.98;
      if (Math.abs(this.ang) > stop) {
        if (Math.abs(this.w) > 1.5) this.onThud?.(this, Math.abs(this.w) * 0.6);
        this.ang = Math.sign(this.ang) * stop;
        this.w *= -0.3;
      }
    }
    if (Math.abs(this.w) < 0.004 && Math.abs(to - this.ang) < 0.002) {
      this.ang = to;
      this.w = 0;
      this.moving = false;
    } else this.moving = true;
    this.place();
  }
}

export class Pane {
  broken = false;
  /** what stays in the frame */
  teeth: THREE.Mesh | null = null;
  constructor(readonly id: number, readonly mesh: THREE.Mesh, readonly box: Box, readonly along: 'x' | 'y') {}

  /** jagged glass left in the putty, on all four sides */
  breakTeeth(mat: THREE.Material) {
    const g = this.mesh.geometry as THREE.BoxGeometry;
    const p = g.parameters;
    const w = this.along === 'x' ? p.width : p.depth, h = p.height;
    const pos: number[] = [];
    const edge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      const L = Math.hypot(bx - ax, by - ay);
      let t = 0;
      while (t < L) {
        const s = 0.06 + Math.random() * 0.26;
        const e = Math.min(L, t + s);
        const tip = (t + e) / 2 + (Math.random() - 0.5) * s;
        const d = Math.random() < 0.3 ? 0.012 : 0.03 + Math.random() ** 2 * 0.3;
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        pos.push(ax + ux * t, ay + uy * t, 0, ax + ux * e, ay + uy * e, 0, ax + ux * tip + nx * d, ay + uy * tip + ny * d, 0);
        t = e;
      }
    };
    edge(-w / 2, -h / 2, w / 2, -h / 2, 0, 1);
    edge(w / 2, h / 2, -w / 2, h / 2, 0, -1);
    edge(-w / 2, h / 2, -w / 2, -h / 2, 1, 0);
    edge(w / 2, -h / 2, w / 2, h / 2, -1, 0);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.computeVertexNormals();
    const m = new THREE.Mesh(bg, mat);
    m.position.copy(this.mesh.position);
    if (this.along === 'y') m.rotation.y = Math.PI / 2;
    m.renderOrder = 4;
    this.mesh.parent?.add(m);
    this.teeth = m;
  }

  mend() {
    this.teeth?.removeFromParent();
    this.teeth?.geometry.dispose();
    this.teeth = null;
  }
}

export interface Loaded {
  group: THREE.Group;
  world: World;
  map: MapData;
  doors: Door[];
  panes: Pane[];
  sky: THREE.Texture;
  /** the props nobody bolted down, ready to be given bodies */
  loose: { obj: THREE.Object3D; def: NonNullable<MapData['props'][number]['loose']>; x: number; y: number; z: number; rot: number }[];
  glassMat: THREE.Material;
  /** what the street's reflection never needs to draw */
  indoors: THREE.Object3D[];
  grass: Grass | null;
  /** boats at their moorings: each rides the swell */
  floats: { mesh: THREE.InstancedMesh; base: THREE.Matrix4[]; x: number[]; z: number[]; yaw: number[] }[];
  /** planted blocks, and how far off each is still worth drawing */
  vegCells: { mesh: THREE.InstancedMesh; x: number; z: number; reach: number }[];
  /** lamps that flicker */
  flicks: Flicker[];
}

function makeSky(tex: THREE.Texture, lm: MapData['lm'], tint = [0.62 * 0.36, 0.62 * 0.62, 0.62 * 1.05]) {
  const geo = new THREE.SphereGeometry(400, 32, 20);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    defines: LF.sunOn ? { DAY: 1 } : {},
    uniforms: { t: { value: tex }, k: LF.lmK, tint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) }, sunD: LF.sunDir, sunC: LF.sunC, disc: LF.disc, flash: LF.skyFlash },
    vertexShader: 'varying vec3 d; void main(){ d = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position,1.); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 d; uniform sampler2D t; uniform vec2 k; uniform vec3 tint, sunD, sunC; uniform float disc, flash;
      void main(){ vec3 n = normalize(d);
      #ifdef DAY
      vec3 s = n; s.y = max(s.y, 0.004); s = normalize(s);
      float u = atan(s.z, s.x) / 6.2831853 + 0.5; float v = asin(clamp(s.y,-1.,1.)) / 3.14159265 + 0.5;
      #else
      float u = atan(n.z, n.x) / 6.2831853 + 0.5; float v = asin(clamp(n.y,-1.,1.)) / 3.14159265 + 0.5;
      #endif
      vec3 e = texture2D(t, vec2(u, v)).rgb; vec3 c = min((exp2(e*k.x)-1.)/k.y*tint, vec3(9.));
      #ifdef DAY
      float a = dot(n, sunD);
      // the disc itself and the glare round it: the picture had them clipped out for the bake
      c += sunC * disc * (smoothstep(0.99991, 0.99996, a) * 24.0 + pow(max(a, 0.0), 900.0) * 1.1 + pow(max(a, 0.0), 60.0) * 0.1);
      #endif
      c += vec3(0.62, 0.68, 0.85) * flash * (0.35 + 0.65 * clamp(n.y * 1.5, 0., 1.)) * (0.6 + 0.4 * e.g * 4.);
      gl_FragColor = vec4(c,1.); }`,
  });
  const s = new THREE.Mesh(geo, m);
  s.frustumCulled = false;
  s.renderOrder = -1;
  s.name = 'sky';
  return s;
}

export async function loadWorld(r: THREE.WebGLRenderer, progress: (f: number, what: string) => void): Promise<Loaded> {
  // everything at once: the geometry and the props start down the wire while the textures do
  const binP = fetch(MB + 'world.bin').then((r) => r.arrayBuffer());
  const propsP = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(MB + 'props.glb');
  const map: MapData = await (await fetch(MB + 'map.json')).json();
  // a baked sun: where it is and how bright a spot must be to be lying in it, for the shadows of whoever walks through
  const shade = map.weather?.shade;
  LF.shadeOn = !!shade;
  if (shade) LF.shade.value.set(shade[0], shade[1], shade[2], shade[3] ?? 42);
  LF.lmK.value.set(map.lm.logr, map.lm.k);
  if (map.weather?.sun) LF.skyK.value = map.weather.sun.sky;
  const bin = await binP;
  // decoded off the main thread, already the right way up: an <img> is decoded on the spot when it's uploaded, which
  // was most of the load
  const bmp = typeof createImageBitmap === 'function' ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null;
  const tl = new THREE.TextureLoader();
  const loadTex = async (url: string): Promise<THREE.Texture> => {
    if (!bmp) return tl.loadAsync(url);
    const b = await bmp.loadAsync(url);
    const t = new THREE.Texture(b as unknown as HTMLImageElement);
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  const aniso = Math.min(4, r.capabilities.getMaxAnisotropy());
  const texs = new Map<string, THREE.Texture>();
  const need: [string, boolean][] = [];
  for (const t of map.textures) need.push([`tex/${t}_c.webp`, true], [`tex/${t}_n.webp`, false], [`tex/${t}_a.webp`, false]);
  need.push(['lm.webp', false], ['lm2.webp', false], ['sky.webp', false]);
  // what is printed on the shop's stock: one sheet for every box, tin and case
  if (MAP_ID === 'store') need.push(['tex/lf_pack_c.webp', true]);
  // and the scans the modelled kit is projected with: the map's own list only has what its walls and floors use
  for (const n of new Set(Object.values(TRIPLANAR).map((t) => t[0]))) if (MAP_ID === 'store' && !map.textures.includes(n) && !/mud|rusty/.test(n)) need.push([`tex/${n}_c.webp`, true]);
  if (map.terrain) {
    need.push(['lm3.webp', false], ['splat.webp', false], ['near.webp', false]);
    for (const n of ['leafy_grass', 'seaside_rock']) need.push([`tex/${n}_c.webp`, true], [`tex/${n}_n.webp`, false]);
    for (const n of ['coast_sand_rocks_02', 'clean_pebbles', 'worn_asphalt', 'lichen_rock']) need.push([`tex/${n}_c.webp`, true]);
  }
  let done = 0;
  await Promise.all(need.map(async ([f, srgb]) => {
    const t = await loadTex((f.startsWith('tex/') ? BASE : MB) + f).catch(() => null);
    done++;
    progress(0.1 + 0.6 * (done / need.length), 'Textures');
    if (!t) return;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    texs.set(f, t);
  }));
  const lm = texs.get('lm.webp')!;
  lm.wrapS = lm.wrapT = THREE.ClampToEdgeWrapping;
  lm.generateMipmaps = false;
  lm.minFilter = THREE.LinearFilter;
  lm.anisotropy = 1;
  lm.flipY = !bmp;
  lm.needsUpdate = true;
  LF.lm.value = lm;
  const lm2 = texs.get('lm2.webp');
  if (lm2) {
    lm2.wrapS = lm2.wrapT = THREE.ClampToEdgeWrapping;
    lm2.generateMipmaps = false;
    lm2.minFilter = THREE.LinearFilter;
    lm2.anisotropy = 1;
    lm2.flipY = !bmp;
    lm2.needsUpdate = true;
    LF.lm2.value = lm2;
  }
  const skyT = texs.get('sky.webp')!;
  skyT.generateMipmaps = false;
  skyT.minFilter = THREE.LinearFilter;
  skyT.wrapS = THREE.RepeatWrapping;
  LF.sky.value = skyT;

  const group = new THREE.Group();
  group.add(makeSky(skyT, map.lm, map.weather?.sky));
  const mats = new Map<string, THREE.Material>();
  const makeMat = (name: string) => {
    let m = mats.get(name);
    if (m) return m;
    const d = map.materials[name];
    if (d.emit) m = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.emit[0], d.emit[1], d.emit[2]).multiplyScalar(0.5) });
    else {
      const st = new THREE.MeshStandardMaterial({
        map: texs.get(`tex/${d.tex}_c.webp`) ?? null, normalMap: texs.get(`tex/${d.tex}_n.webp`) ?? null, roughnessMap: texs.get(`tex/${d.tex}_a.webp`) ?? null, aoMap: texs.get(`tex/${d.tex}_a.webp`) ?? null,
        color: new THREE.Color(d.tint[0], d.tint[1], d.tint[2]), roughness: d.rough, metalness: d.metal,
      });
      st.aoMapIntensity = 1.3;
      st.normalScale.set(d.nrm, d.nrm);
      if (st.aoMap) st.aoMap.channel = 0;
      if (d.mono) st.defines = { ...st.defines, LF_MONO: d.mono.toFixed(3) };
      m = applyLF(st, { lightmap: true, wet: d.wet, outdoor: !!map.terrain });
    }
    mats.set(name, m);
    return m;
  };
  for (const e of map.mats) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, e.pos, e.verts * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin, e.nor, e.verts * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, e.uv, e.verts * 2), 2));
    g.setAttribute('uvLM', new THREE.BufferAttribute(new Float32Array(bin, e.lm, e.verts * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, e.idx, e.tris * 3), 1));
    const mesh = new THREE.Mesh(g, makeMat(e.mat));
    mesh.name = e.mat;
    mesh.userData.arch = true;
    // after the furniture: its depth is already down, so whatever a shelf covers is never shaded as wall first
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  progress(0.72, 'Props');
  const gl = await propsP;
  // compression moves each mesh into a quantised box and puts the way back on its node: nothing here may drop a node's matrix
  gl.scene.updateMatrixWorld(true);
  // glass that refracts makes three draw the whole scene twice a frame: plain see-through glass instead
  gl.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
    if (m && 'transmission' in m && m.transmission > 0) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.32;
      m.depthWrite = false;
    }
  });
  const byId = new Map<string, THREE.Object3D>();
  for (const c of gl.scene.children) {
    byId.set(c.name, c);
  }
  const placed = new Map<string, MapData['props']>();
  const loose: Loaded['loose'] = [];
  for (const p of map.props) {
    if (p.loose) continue;
    const l = placed.get(p.id);
    if (l) l.push(p);
    else placed.set(p.id, [p]);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const indoors: THREE.Object3D[] = [];
  const insideZone = (p: number[]) => map.zones.some((z) => p[0] > z.a[0] && p[0] < z.b[0] && p[2] > z.a[2] && p[2] < z.b[2]);
  const vegCells: Loaded['vegCells'] = [];
  const prepared = new Set<THREE.Material>();
  const prep = (mat: THREE.MeshStandardMaterial, id = '') => {
    if (prepared.has(mat)) return;
    prepared.add(mat);
    // the cubes are coarser than the corners these stand in: pale things would glow
    mat.color.multiplyScalar(/cardboard|rollershutter/.test(id) ? 0.5 : /crate|shelves|barrier/.test(id) ? 0.72 : 0.85);
    applyLF(mat, { leaf: /shrub|fern|nettle|tree|grass|sorrel/.test(id) });
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = 4;
    // scans with holes in them (chain link, grates): cut, don't blend
    if (mat.transparent || mat.alphaTest > 0) {
      mat.transparent = false;
      mat.alphaTest = 0.5;
      mat.side = THREE.DoubleSide;
    }
  };
  for (const [id, list] of placed) {
    const src = byId.get(id) ?? byId.get(id.replace(/[.\s]/g, '_'));
    if (!src) {
      console.warn('[lastframe] no prop', id);
      continue;
    }
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      prep(mat, id);
      // a block of the map each, so what's behind the camera or across the block isn't drawn three times over
      const cells = new Map<string, MapData['props']>();
      for (const p of list) {
        const k = `${Math.floor(p.pos[0] / 18)},${Math.floor(p.pos[2] / 18)},${insideZone(p.pos) ? 1 : 0}`;
        const c = cells.get(k);
        if (c) c.push(p);
        else cells.set(k, [p]);
      }
      const local = mesh.matrixWorld.clone();
      for (const part of cells.values()) {
        const inst = new THREE.InstancedMesh(mesh.geometry, mat, part.length);
        part.forEach((p, i) => {
          q.setFromAxisAngle(UP, p.rot);
          if (p.tilt) q.multiply(q2.setFromAxisAngle(RIGHT, p.tilt));
          mtx.compose(v.set(p.pos[0], p.pos[1], p.pos[2]), q, sc.setScalar(p.s)).multiply(local);
          inst.setMatrixAt(i, mtx);
        });
        inst.computeBoundingSphere();
        group.add(inst);
        const inside = insideZone(part[0].pos);
        if (inside) indoors.push(inst);
        // a thing the size of a tin can is nothing from across the street, and nothing indoors shows from far off at all
        mesh.geometry.computeBoundingSphere();
        const size = mesh.geometry.boundingSphere!.radius * local.getMaxScaleOnAxis() * part[0].s;
        const reach = size < 0.22 ? 30 : size < 0.6 ? 55 : size < 1.5 ? 105 : 1e4;
        const bs = inst.boundingSphere!;
        vegCells.push({ mesh: inst, x: bs.center.x, z: bs.center.z, reach: (inside ? Math.min(reach, 34) : reach) + bs.radius });
      }
    });
  }
  const floats: Loaded['floats'] = [];
  // ---- the kit: instanced by module, in blocks of the map, each instance on its own lightmap tile
  {
    const glass = roomGlass();
    const near = new Map<THREE.Material, THREE.Material>(), far = new Map<THREE.Material, THREE.Material>();
    const matFor = (m0: THREE.MeshStandardMaterial, tiled: boolean) => {
      if (/glass/i.test(m0.name)) return glass;
      const table = tiled ? near : far;
      let m = table.get(m0);
      if (!m) {
        const c = m0.clone();
        c.transparent = false;
        c.alphaTest = 0;
        c.side = THREE.FrontSide;
        for (const t of [c.map, c.normalMap, c.roughnessMap]) if (t) t.anisotropy = 4;
        // plaster takes more light than the scans round it
        if (!map.terrain) c.color.multiplyScalar(tiled ? 0.74 : 0.8);
        // the modelled earth, rust and timber have no UVs: give them the scans the world is made of, projected from the
        // three axes in world space, so a crater's bowl is the same mud as the ground round it
        const tri = TRIPLANAR[m0.name];
        const tt = tri && texs.get(`tex/${tri[0]}_c.webp`);
        if (tri && tt) {
          c.map = tt;
          c.color.setRGB(tri[2][0], tri[2][1], tri[2][2]);
          c.roughness = tri[3];
        }
        // polished tube a finger thick is a string of white sparks through this lens, one for every pixel it crosses:
        // what's been standing here for years is dull anyway
        if (c.metalness > 0.5 && m0.name !== 'lfpool') {
          c.roughness = Math.max(c.roughness, 0.62);
          c.metalness = 0.55;
          c.color.multiplyScalar(0.7);
        }
        // standing water: black, and what it reflects blurred by the rain on it
        if (m0.name === 'lfpool') {
          c.color.setRGB(0.006, 0.0055, 0.005);
          c.roughness = 0.3;
          c.metalness = 0;
        }
        // paper on a floor is the palest thing on it: lit from the cubes it came out darker than the tiles under it
        if (/^lfpaper/.test(m0.name)) c.color.multiplyScalar(1.5);
        // printed card and paper, by its own UVs: matt, and the sheet is already as faded as it should be
        if (m0.name === 'lfpack') {
          const pk = texs.get('tex/lf_pack_c.webp');
          if (pk) {
            c.map = pk;
            c.color.setRGB(0.92, 0.92, 0.9);
            c.roughness = 0.82;
          }
        }
        // the volume's light is from all round: in black water only a little of the sky should show
        m = applyLF(c, tiled ? { lightmap: true, tile: true, wet: 0.25 } : m0.name === 'lfpool' ? { spec: 0.22 } : {});
        if (tri && tt) triplanar(m as THREE.MeshStandardMaterial, tri[1], false, /^lflab/.test(m0.name));
        table.set(m0, m);
      }
      return m;
    };
    // shopping trolleys are not furniture: each is its own object on its own wheels, for the physics to push about
    const cartMats = new Map<THREE.Material, THREE.Material>();
    const cartMat = (m0: THREE.MeshStandardMaterial) => {
      let m = cartMats.get(m0);
      if (!m) {
        const c = m0.clone();
        c.side = THREE.DoubleSide;
        const tri = TRIPLANAR[m0.name];
        const tt = tri && texs.get(`tex/${tri[0]}_c.webp`);
        if (tri && tt) {
          c.map = tt;
          c.color.setRGB(tri[2][0], tri[2][1], tri[2][2]);
          c.roughness = tri[3];
        }
        if (c.metalness > 0.5) {
          c.roughness = Math.max(c.roughness, 0.62);
          c.metalness = 0.55;
          c.color.multiplyScalar(0.7);
        }
        m = applyLF(c, {});
        if (tri && tt) triplanar(m as THREE.MeshStandardMaterial, tri[1], true);
        cartMats.set(m0, m);
      }
      return m;
    };
    const isCart = (id: string) => /\|cart_\d+$/.test(id);
    for (const u of map.units ?? []) {
      if (!isCart(u.id)) continue;
      const src = byId.get(u.id) ?? byId.get(u.id.replace(/[.\s|+]/g, '_')) ?? byId.get(u.id.replace(/[.\s|+]/g, ''));
      if (!src) continue;
      const body = new THREE.Group();
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const c = new THREE.Mesh(mesh.geometry, cartMat(mesh.material as THREE.MeshStandardMaterial));
        c.applyMatrix4(mesh.matrixWorld);
        body.add(c);
      });
      const bb = new THREE.Box3().setFromObject(body), ctr = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      // the pivot at the middle of its box, the model hung from it
      body.position.set(-ctr.x, -ctr.y, -ctr.z);
      const obj = new THREE.Group();
      obj.add(body);
      const cs = Math.cos(u.rot), sn = Math.sin(u.rot);
      loose.push({ obj, def: { kg: 26, surf: 'cart', shape: 'box', half: [sz.x / 2, sz.z / 2, sz.y / 2] }, x: u.pos[0] + ctr.x * cs + ctr.z * sn, y: u.pos[1] + bb.min.y, z: u.pos[2] - ctr.x * sn + ctr.z * cs, rot: u.rot });
      // and nothing invisible left standing where it was parked
      map.colliders = map.colliders.filter((c) => !(c[7] === 'inv' && c[3] - c[0] < 1.3 && c[5] - c[2] < 1.3 && u.pos[0] > c[0] && u.pos[0] < c[3] && u.pos[2] > c[2] && u.pos[2] < c[5]));
    }
    const byCell = new Map<string, MapData['units']>();
    for (const u of map.units ?? []) {
      if (isCart(u.id)) continue;
      const k = `${u.id}@${Math.floor(u.pos[0] / 48)},${Math.floor(u.pos[2] / 48)}${u.float ? 'f' : ''}`;
      const c = byCell.get(k);
      if (c) c.push(u);
      else byCell.set(k, [u]);
    }
    const col = new THREE.Color();
    // a module that stands in one or two places gains nothing from instancing, and costs a draw call for every material
    // in it, in the picture and again in every shadow map. Those are welded, per material and per block of the map
    const welds = new Map<string, Weld>();
    const box3 = new THREE.Box3(), size3 = new THREE.Vector3();
    for (const [key, list] of byCell) {
      const id = key.split('@')[0];
      const src = byId.get(id) ?? byId.get(id.replace(/[.\s|+]/g, '_')) ?? byId.get(id.replace(/[.\s|+]/g, ''));
      if (!src) {
        console.warn('[lastframe] no unit', id);
        continue;
      }
      const tiled = !!list[0].tile;
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m0 = mesh.material as THREE.MeshStandardMaterial;
        const local = mesh.matrixWorld.clone();
        const geo = new THREE.BufferGeometry();
        geo.index = mesh.geometry.index;
        for (const [n, a] of Object.entries(mesh.geometry.attributes)) geo.setAttribute(n, a);
        if (tiled && mesh.geometry.getAttribute('uv1')) geo.setAttribute('uvLM', mesh.geometry.getAttribute('uv1'));
        const mat = matFor(m0, tiled);
        // what is flat on a wall or lying on the floor throws no shadow anyone would miss
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box3.copy(mesh.geometry.boundingBox!).applyMatrix4(local).getSize(size3);
        const u0 = list[0];
        const ext = [size3.x * u0.sc[0], size3.y * u0.sc[2], size3.z * u0.sc[1]];
        const small = Math.min(ext[0], ext[1], ext[2]) < 0.06 || Math.max(ext[0], ext[1], ext[2]) < 0.3;
        const std = mat as THREE.MeshStandardMaterial;
        if (!tiled && !u0.float && list.length < 5 && std.isMeshStandardMaterial && !std.transparent && (std.vertexColors || list.every((u) => u.tint[0] === 1 && u.tint[1] === 1 && u.tint[2] === 1))) {
          for (const u of list) {
            const wk = `${mat.uuid}@${Math.floor(u.pos[0] / WELD_CELL)},${Math.floor(u.pos[2] / WELD_CELL)}${small ? 's' : ''}`;
            let w = welds.get(wk);
            if (!w) welds.set(wk, (w = { mat, small, parts: [] }));
            q.setFromAxisAngle(UP, u.rot);
            w.parts.push({ geo: mesh.geometry, m: new THREE.Matrix4().compose(v.set(u.pos[0], u.pos[1], u.pos[2]), q, sc.set(u.sc[0], u.sc[2], u.sc[1])).multiply(local), tint: u.tint });
          }
          return;
        }
        const tiles = new Float32Array(list.length * 4);
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        inst.name = id;
        inst.userData.small = small;
        list.forEach((u, i) => {
          q.setFromAxisAngle(UP, u.rot);
          // sc is along the module, out of it, up it
          mtx.compose(v.set(u.pos[0], u.pos[1], u.pos[2]), q, sc.set(u.sc[0], u.sc[2], u.sc[1])).multiply(local);
          inst.setMatrixAt(i, mtx);
          inst.setColorAt(i, col.setRGB(u.tint[0], u.tint[1], u.tint[2]));
          if (u.tile) tiles.set(u.tile, i * 4);
        });
        if (tiled) geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 4));
        inst.computeBoundingSphere();
        group.add(inst);
        if (list[0].float) {
          inst.frustumCulled = false;
          const base = list.map((_, i) => { const b = new THREE.Matrix4(); inst.getMatrixAt(i, b); return b; });
          floats.push({ mesh: inst, base, x: list.map((u) => u.pos[0]), z: list.map((u) => u.pos[2]), yaw: list.map((u) => u.rot) });
        }
      });
    }
    for (const w of welds.values()) {
      const mesh = weld(w);
      mesh.userData.small = w.small;
      // what stands on a shelf is in the shelf's own shadow from any lamp that matters: it takes shadows and throws none
      if (/^lf(pack|tin|can|jar|bottle|lab)/.test(w.mat.name)) mesh.userData.stock = true;
      group.add(mesh);
      const bs = mesh.geometry.boundingSphere!;
      // the small stuff is nothing from the far end of the building
      if (w.small) vegCells.push({ mesh: mesh as unknown as THREE.InstancedMesh, x: bs.center.x, z: bs.center.z, reach: 38 + bs.radius });
    }
  }
  // what's planted: blocks of the map, each drawn only when it's in view, swaying
  {
    const swayed = new Set<THREE.Material>();
    const byPlant = new Map<string, NonNullable<MapData['veg']>>();
    for (const p of map.veg ?? []) {
      const k = `${p.id}@${Math.floor(p.pos[0] / 24)},${Math.floor(p.pos[2] / 24)}`;
      const c = byPlant.get(k);
      if (c) c.push(p);
      else byPlant.set(k, [p]);
    }
    for (const [key, list] of byPlant) {
      const id = key.split('@')[0];
      const src = byId.get(id) ?? byId.get(id.replace(/[.\s]/g, '_'));
      if (!src) continue;
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!swayed.has(mat) && !/rock|boulder/.test(id)) {
          swayed.add(mat);
          sway(mat, /tree/.test(id) ? 0.0016 : 0.03);
        }
        prep(mat, id);
        const local = mesh.matrixWorld.clone();
        // scanned rock comes at whatever size it was captured: for these, s is metres across
        mesh.geometry.computeBoundingSphere();
        const unit = /rock/.test(id) ? 0.5 / (mesh.geometry.boundingSphere!.radius * local.getMaxScaleOnAxis()) : 1;
        const inst = new THREE.InstancedMesh(mesh.geometry, mat, list.length);
        list.forEach((p, i) => {
          q.setFromAxisAngle(UP, p.rot);
          mtx.compose(v.set(p.pos[0], p.pos[1], p.pos[2]), q, sc.setScalar(p.s * unit)).multiply(local);
          inst.setMatrixAt(i, mtx);
        });
        inst.computeBoundingSphere();
        inst.name = 'veg';
        group.add(inst);
        // past a certain distance a plant is less than a pixel of the hillside: stop paying for it
        const reach = /tree/.test(id) ? 300 : /rock/.test(id) ? 1e4 : /shrub/.test(id) ? 150 : 48;
        const bs = inst.boundingSphere!;
        vegCells.push({ mesh: inst, x: bs.center.x, z: bs.center.z, reach: reach + bs.radius });
      });
    }
  }
  for (const p of map.props) {
    if (!p.loose) continue;
    const src = byId.get(p.id) ?? byId.get(p.id.replace(/[.\s]/g, '_'));
    if (!src) continue;
    // a pivot at the middle of its box: the model hangs below it
    const obj = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(src.clone());
    inner.position.set(0, -p.loose.half[2], 0);
    inner.scale.setScalar(p.s);
    inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      prep(m.material as THREE.MeshStandardMaterial, p.id);
      m.castShadow = true;
    });
    obj.add(inner);
    loose.push({ obj, def: p.loose, x: p.pos[0], y: p.pos[1], z: p.pos[2], rot: p.rot });
  }
  progress(0.85, 'Collision');
  const world = new World();
  let grass: Grass | null = null;
  if (map.terrain) {
    const T = map.terrain;
    const h = new Float32Array(await (await fetch(MB + 'height.bin')).arrayBuffer());
    world.terrain = { x0: T.x0, y0: T.y0, step: T.step, nx: T.nx, ny: T.ny, h };
    world.limit = T.limit as [number, number, number, number];
    const lm3 = texs.get('lm3.webp')!, splat = texs.get('splat.webp')!;
    for (const t of [lm3, splat]) {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.flipY = !bmp;
      t.needsUpdate = true;
    }
    LF.lm3.value = lm3;
    const near = texs.get('near.webp') ?? null;
    if (near) {
      near.wrapS = near.wrapT = THREE.ClampToEdgeWrapping;
      near.generateMipmaps = false;
      near.minFilter = THREE.LinearFilter;
      near.flipY = !bmp;
      near.needsUpdate = true;
    }
    // the heights as a texture: the sea and the grass read them on the GPU
    const hd = new Uint16Array(h.length);
    for (let i = 0; i < h.length; i++) hd[i] = THREE.DataUtils.toHalfFloat(h[i]);
    const hTex = new THREE.DataTexture(hd, T.nx, T.ny, THREE.RedFormat, THREE.HalfFloatType);
    hTex.minFilter = hTex.magFilter = THREE.LinearFilter;
    hTex.wrapS = hTex.wrapT = THREE.ClampToEdgeWrapping;
    hTex.needsUpdate = true;
    group.add(buildLand(world.terrain, T, (n) => texs.get(`tex/${n}.webp`) ?? null, splat, hTex, near));
    grass = new Grass(world.terrain, hTex, splat, lm3);
    group.add(grass.group);
  }
  for (const c of map.colliders) world.add({ min: [c[0], c[1], c[2]], max: [c[3], c[4], c[5]], pen: !!c[6], tag: c[7], mat: c[8] });

  const doorMat = {
    wood: applyLF(new THREE.MeshStandardMaterial({ map: texs.get('tex/distressed_painted_planks_c.webp'), normalMap: texs.get('tex/distressed_painted_planks_n.webp'), roughness: 0.8, color: 0x9a8f7c })),
    steel: applyLF(new THREE.MeshStandardMaterial({ map: texs.get('tex/green_metal_rust_c.webp'), normalMap: texs.get('tex/green_metal_rust_n.webp'), roughness: 0.7, color: 0xa0a8a4 })),
    street: applyLF(new THREE.MeshStandardMaterial({ map: texs.get('tex/distressed_painted_planks_c.webp'), normalMap: texs.get('tex/distressed_painted_planks_n.webp'), roughness: 0.7, color: 0x5a3a2a })),
  };
  const handle = applyLF(new THREE.MeshStandardMaterial({ color: 0x8a8378, metalness: 0.9, roughness: 0.4 }));
  const doors = map.doors.map((d, i) => {
    const door = new Door(i, d, doorMat[d.kind as keyof typeof doorMat] ?? doorMat.wood, handle);
    group.add(door.pivot);
    world.dyn.push(door.box);
    return door;
  });
  const glassMat = applyLF(new THREE.MeshStandardMaterial({ color: 0x223034, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.26, depthWrite: false }));
  const panes = map.glass.map((g, i) => {
    const w = g.b - g.a, h = g.z1 - g.z0;
    const geo = new THREE.BoxGeometry(g.axis === 'x' ? w : 0.012, h, g.axis === 'x' ? 0.012 : w);
    const mesh = new THREE.Mesh(geo, glassMat);
    const cx = g.axis === 'x' ? (g.a + g.b) / 2 : g.c, cz = g.axis === 'x' ? -g.c : -(g.a + g.b) / 2;
    mesh.position.set(cx, (g.z0 + g.z1) / 2, cz);
    mesh.renderOrder = 4;
    group.add(mesh);
    const box: Box = {
      min: g.axis === 'x' ? [g.a, g.z0, -g.c - 0.03] : [g.c - 0.03, g.z0, -g.b],
      max: g.axis === 'x' ? [g.b, g.z1, -g.c + 0.03] : [g.c + 0.03, g.z1, -g.a], pen: true, tag: 'glass', mat: 'glass', id: i,
    };
    world.dyn.push(box);
    return new Pane(i, mesh, box, g.axis as 'x' | 'y');
  });
  // what glows: tube covers and bulbs, so the bloom has something to hold on to
  const tube = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.5, 2.8) });
  const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 2.5, 1.5) });
  const sodium = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4.6, 1.7) });
  const flicks: Flicker[] = [];
  for (const l of map.lights) {
    let mesh: THREE.Mesh;
    if (l.kind === 'area') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.02, 0.08), tube);
      // layout y runs north, which is the game's -z
      mesh.rotation.y = l.size && l.size[1] > l.size[0] ? Math.PI / 2 : 0;
      mesh.position.set(l.pos[0], l.pos[1] - 0.03, l.pos[2]);
    } else if (l.kind === 'spot') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(l.pos[1] > 6.3 ? 0.14 : 0.07, 10, 8), l.pos[1] > 6.3 ? sodium : bulb);
      mesh.position.set(l.pos[0], l.pos[1] - 0.04, l.pos[2]);
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bulb);
      mesh.position.set(l.pos[0], l.pos[1], l.pos[2]);
    }
    if (l.power > 0.01) {
      // its own glow, so it can go out on its own: a tube on its last legs, or any lamp someone puts a round through
      const mat = (mesh.material as THREE.MeshBasicMaterial).clone();
      mesh.material = mat;
      if (l.flicker && l.kind !== 'area') mesh.scale.setScalar(l.power < 3 ? 0.5 : 1);
      const alongZ = l.kind === 'area' && !!l.size && l.size[1] > l.size[0];
      flicks.push({ l, mat, base: mat.color.clone(), k: 0, t: Math.random() * 4, off: 0, mesh, dead: false, dying: 0, half: l.kind === 'area' ? (alongZ ? [0, 0.6] : [0.6, 0]) : [0, 0] });
      group.add(mesh);
    }
  }
  const deco = new THREE.Group();
  group.add(deco);
  progress(0.92, 'Light');
  return { group, world, map, doors, panes, sky: skyT, loose, glassMat, indoors, grass, floats, vegCells, flicks };
}

/** the ambient cubes; flat until a capture has been shipped */
export async function loadVolume(): Promise<void> {
  let dim = [2, 2, 2], min = [0, 0, 0], max = [1, 1, 1];
  let data: Uint8Array | null = null;
  try {
    const meta = await (await fetch(MB + 'volume.json')).json();
    dim = meta.dim;
    min = meta.min;
    max = meta.max;
    data = new Uint8Array(await (await fetch(MB + 'volume.bin')).arrayBuffer());
  } catch {
    /* no capture yet */
  }
  if (!data || data.length !== dim[0] * dim[1] * dim[2] * 6 * 4) {
    data = new Uint8Array(dim[0] * dim[1] * dim[2] * 6 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 110;
      data[i + 1] = 112;
      data[i + 2] = 122;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.Data3DTexture(data, dim[0], dim[1], dim[2] * 6);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  LF.vol.value = t;
  // the mean of the six faces, for the air: decoded, averaged, encoded again
  const [dx, dy, dz] = dim;
  const cells = dx * dy * dz;
  const avg = new Uint8Array(cells * 4);
  const R = LF.lmK.value.x, K = LF.lmK.value.y;
  const dec = (e: number) => (2 ** ((e / 255) * R) - 1) / K;
  const enc = (v: number) => (Math.log2(1 + v * K) / R) * 255;
  for (let i = 0; i < cells; i++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let f = 0; f < 6; f++) s += dec(data[(f * cells + i) * 4 + c]);
      avg[i * 4 + c] = Math.min(255, enc(s / 6) + 0.5);
    }
    avg[i * 4 + 3] = 255;
  }
  const a = new THREE.Data3DTexture(avg, dx, dy, dz);
  a.format = THREE.RGBAFormat;
  a.type = THREE.UnsignedByteType;
  a.minFilter = a.magFilter = THREE.LinearFilter;
  a.wrapS = a.wrapT = a.wrapR = THREE.ClampToEdgeWrapping;
  a.unpackAlignment = 1;
  a.needsUpdate = true;
  LF.volAvg.value = a;
  LF.volMin.value.set(min[0], min[1], min[2]);
  LF.volInv.value.set(1 / (max[0] - min[0]), 1 / (max[1] - min[1]), 1 / (max[2] - min[2]));
  LF.volDim.value.set(dim[0], dim[1], dim[2]);
}
